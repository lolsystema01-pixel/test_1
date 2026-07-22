# 配達実績の記録口（ステータス遷移）v0

要件定義 **6.10 第1項**。ステータス変更を**一貫した記録口（関数1本）**に通し、`deliveries.status` の更新と**遷移ログ**を不可分に記録する。

## 状態機械（線形＋日内再訪・6.10／2026-07-18確定）

```
未配車 → 配車済 → 仕分済 → 配送中 → 完了
                            ↑  └→ 不在
                            └────┘
```
- 上記以外（順序飛ばし・逆行・同一・保留がらみ）は**拒否**（許可外遷移）。
- **不在→配送中**（日内再訪）はLOL確定（2026-07-18）で許可。同日中の再配達で「不在」から配送を再開できる。
- `完了` からの戻し遷移は追加していない＝**完了は引き続き終端**。

## ファイル（コピペ実行）

| ファイル | 役割 |
| --- | --- |
| `status_log_v0.sql` | `delivery_status_log` 表（from/to/changed_at/changed_by/actor/source/note）＋RLS（**deliveries継承**・SELECTのみ） |
| `record_status_transition_v0.sql` | **公開ラッパー** `record_status_transition(tracking_number, to_status, source, note)` ＋ **非公開の実体** `record_status_transition_internal`（同シグネチャ）。実体側で①遷移検証 ②status更新 ③ログ記録 を不可分に実行。**SECURITY DEFINER＋関数内scope認可** |
| `dispatch_status_hook_v0.sql` | 配車v0.5 §B の `status='配車済'` 直UPDATE を**記録口呼び出しへ寄せ替え**（driver_id付与は直、status遷移はログ付き） |
| `check_status_log_v0.sql` | 確認（全遷移通る／許可外拒否／status一致／RLS） |
| `pglite_test.mjs` | E2E検証 |

## 設計（書き込みRLSとの関係）

- **status の書き込み口を関数1本に限定**。`delivery_status_log` にも `deliveries.status` にも**書き込みRLSポリシーを置かず**、`record_status_transition`（公開ラッパー・SECURITY DEFINER）だけが書ける。
- 関数内で**scope認可**：呼び出し元のロール／帰属（`my_role()/my_office()/my_driver()/my_shipper()/my_depot_offices()`）で「その荷物に触れてよいか（＝deliveries で見える範囲か）」を判定。範囲外は拒否。`auth.uid()` なし（SQL Editor／配車バッチ）は system 扱いで許可。
- ＝ **status の書き込みについては「書き込みRLS整備」の代替**。仕分けナビの『仕分済』も T3 の『完了／不在』も、この口を呼べば安全に書ける（書き込みRLS全体整備を待たない）。
- `delivery_status_log` の **SELECT は deliveries RLS をそのまま継承**（サブクエリで deliveries の5ロールRLSが効く）＝見える荷物のログだけ見える。

## MED-2対応（2026-07-18監査：記録口迂回の封鎖）

**課題**：`record_status_transition` は元々「呼び出し元が見える荷物」なら誰でも任意の許可遷移を実行できたため、driverロールが本関数を**直接**RPC呼び出しして `配送中→完了/不在` に到達でき、`record_delivery_result`（GPS記録・driver本人限定・冪等ガード込み）を**迂回**できてしまっていた。

**選んだ対策**：session GUCやnonceのような「呼び出し経路を実行時に印づけて追跡する」仕組みは複雑さの割に取り回しが悪い（トランザクション境界・再入・エラー処理での漏れが起きやすい）ため採用せず、**関数を2段に分離**する現実解を採った。

1. `record_status_transition_internal`（実体・非公開）：従来どおりのフル実装（scope認可・線形遷移検証・status更新・ログ記録）。**`authenticated` へ GRANT しない**＝RPC経由で外部から直接呼べない。
2. `record_status_transition`（公開ラッパー・シグネチャ不変）：`authenticated` へ GRANT。driverロールからの呼び出しだけ追加チェックを行う：
   - `to_status in ('完了','不在')` は **`42501`で拒否**（「記録口(record_delivery_result)経由必須」のメッセージ）。
   - それ以外の許可遷移（例: 仕分済→配送中）は通すが、**`source` を常に `'配達'` に上書き**（クライアントが渡した値を無視＝ログのsource詐称を防ぐ）。
   - driver以外（system/hq/depot/area/shipper）はガード無しでそのまま `_internal` に委譲＝既存の管理訂正運用・配車バッチ等は無変更で動く。
3. `record_delivery_result`（`delivery_result_v0.sql`）は**公開ラッパーを経由せず** `record_status_transition_internal` を直接呼ぶ。これは同じ Postgres 実行主体（本ファイル群を適用したロール＝所有者）が作成した SECURITY DEFINER関数同士の内部呼び出しであり、**関数の所有者は REVOKE FROM PUBLIC 後もオブジェクトの所有権に基づき自分の関数を暗黙にEXECUTEできる**（Postgres標準のオブジェクト所有権の性質。GRANT/REVOKEはPUBLIC・他ロール向けのACL操作であり、所有者自身の権利はそれとは別に常に残る）。この性質により、`authenticated` ロール（driverを含む）からの直接RPC呼び出しだけを`42501`で塞ぎつつ、`record_delivery_result`内部からの呼び出しは無条件に通る。

**効果**：完了/不在への書き込みは事実上 `record_delivery_result` 1経路に固定される（GPS記録・二度押し安全・冪等ガードを必ず通る）。`record_status_transition` は「完了/不在以外の遷移」および「非driverロールによる訂正」の記録口として引き続き機能する。

## 実行順（実機）

1. `status_log_v0.sql` → `record_status_transition_v0.sql`（`record_status_transition_internal` → `record_status_transition` の順に定義される。1ファイルで両方適用される）
2. `dispatch_status_hook_v0.sql`（配車を寄せ替え。**従来の §B 直UPDATEは使わない**）
3. `check_status_log_v0.sql`（④のRLSは sub を自分の area UUIDに置換）

## 用語（用語集v0.1・実値）

未配車・配車済・仕分済・配送中・完了・不在（`deliveries.status` の text 実値に一致）。
