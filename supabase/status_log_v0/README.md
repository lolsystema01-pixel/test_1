# 配達実績の記録口（ステータス遷移）v0

要件定義 **6.10 第1項**。ステータス変更を**一貫した記録口（関数1本）**に通し、`deliveries.status` の更新と**遷移ログ**を不可分に記録する。

## 状態機械（線形・6.10）

```
未配車 → 配車済 → 仕分済 → 配送中 → 完了
                                  └→ 不在
```
- 上記以外（順序飛ばし・逆行・同一・保留がらみ）は**拒否**（許可外遷移）。
- 再配達での再オープン等は**範囲外（要確認）**。

## ファイル（コピペ実行）

| ファイル | 役割 |
| --- | --- |
| `status_log_v0.sql` | `delivery_status_log` 表（from/to/changed_at/changed_by/actor/source/note）＋RLS（**deliveries継承**・SELECTのみ） |
| `record_status_transition_v0.sql` | **記録口関数** `record_status_transition(tracking_number, to_status, source, note)`：①遷移検証 ②status更新 ③ログ記録 を不可分。**SECURITY DEFINER＋関数内scope認可** |
| `dispatch_status_hook_v0.sql` | 配車v0.5 §B の `status='配車済'` 直UPDATE を**記録口呼び出しへ寄せ替え**（driver_id付与は直、status遷移はログ付き） |
| `check_status_log_v0.sql` | 確認（全遷移通る／許可外拒否／status一致／RLS） |
| `pglite_test.mjs` | E2E検証（23/23 PASS） |

## 設計（書き込みRLSとの関係）

- **status の書き込み口を関数1本に限定**。`delivery_status_log` にも `deliveries.status` にも**書き込みRLSポリシーを置かず**、`record_status_transition`（SECURITY DEFINER）だけが書ける。
- 関数内で**scope認可**：呼び出し元のロール／帰属（`my_role()/my_office()/my_driver()/my_shipper()/my_depot_offices()`）で「その荷物に触れてよいか（＝deliveries で見える範囲か）」を判定。範囲外は拒否。`auth.uid()` なし（SQL Editor／配車バッチ）は system 扱いで許可。
- ＝ **status の書き込みについては「書き込みRLS整備」の代替**。仕分けナビの『仕分済』も T3 の『完了／不在』も、この口を呼べば安全に書ける（書き込みRLS全体整備を待たない）。
- `delivery_status_log` の **SELECT は deliveries RLS をそのまま継承**（サブクエリで deliveries の5ロールRLSが効く）＝見える荷物のログだけ見える。

## 実行順（実機）

1. `status_log_v0.sql` → `record_status_transition_v0.sql`
2. `dispatch_status_hook_v0.sql`（配車を寄せ替え。**従来の §B 直UPDATEは使わない**）
3. `check_status_log_v0.sql`（④のRLSは sub を自分の area UUIDに置換）

## 用語（用語集v0.1・実値）

未配車・配車済・仕分済・配送中・完了・不在（`deliveries.status` の text 実値に一致）。
