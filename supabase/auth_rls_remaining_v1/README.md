# 認証・権限 残課題 v1.1（RLS残課題3点）

指示書 `shijisho/shijisho_auth_rls_remaining_v1_1.docx` の成果物。
骨格（全テーブルRLS ON／読取ロール別可視範囲／書込DEFINER関数のみ／my_*ヘルパー）は**実装済み・無変更**。本モジュールは残課題3点の差分のみ。

## 実行順（Supabase SQL Editor・手動コピペ）

| # | ファイル | 内容 |
|---|---|---|
| ① | `storage_rls_all_buckets_v0.sql` | 3バケット（carry-sheets／dispatch-sheets／godoor-csv）を **office_code prefix × my_*** で制限。hq=全office／depot=配下／area=自営業所／他=拒否。select＋insert＋**update**（upsert上書き用・従来は上書き保存が通らない潜在バグ） |
| ② | `audit_address_master_v0.sql` | **調査のみ（全文SELECT・副作用なし）**。参照関数の検出＋語彙ゲート。**dropはしない**（下記） |
| ③ | `verify_rls_scope_v0.sql` | 機微テーブル×ロールの「範囲外0件」証明。`set local role authenticated`＋JWTクレームで**SQL EditorでもRLSを実際に効かせる**（rollbackで副作用なし）。範囲内>0と対で検証 |
| ③ | `verify_rls_scope_checklist_v0.md` | 実機（ログイン）サインオフ用チェックリスト（Storage API実経路含む） |

## ② address_master を drop しない理由（重要）

指示書の条件は「**参照が無いことを確認 → 無ければ** policy ごと drop」。独立コード監査（Fable）の結果、**参照が有る**ため条件不成立：

- `zone_rank`（配車の同一市判定）／`dispatch_build`（**配車エンジン本体**）／`delivery_status_public`（**anon公開のステータスAPI**）が address_master を参照。
- **落とし穴**: Postgres は関数本体内のテーブル参照を pg_depend に記録しないため、`drop table` は**エラー無しで成功**し、次の配車実行・顧客照会で初めて壊れる（時限爆弾）。参照確認は `pg_proc.prosrc` の全文検索で行うこと（audit §1）。
- **単純置換も不可**: 新旧で共通IDの**番号体系が別物**（例: 箱柳町 旧`OKZ_C_01_08`／新`OKZ_C_01_06`）。旧語彙の行は lookup が NULL → エラー無しで市名欠落・同一市判定不成立という**静かな劣化**になる。

**次のステップ（別指示書）**: audit の語彙ゲート（§2〜§4）全合格を確認 → 3関数を area_master 参照へ書換（`is_valid` フィルタ＋`order by priority asc nulls last` で決定化）→ pglite回帰＋実機 → その後に drop。

## 検証
- `node supabase/auth_rls_remaining_v1/pglite_test_storage.mjs` … **26/26 PASS**（3バケット×hq/depot/area/driver：読取範囲外0件・書込拒否・prefix無し拒否・upsert上書き）
- `node supabase/auth_rls_remaining_v1/pglite_test_audit.mjs` … **9/9 PASS**（参照3関数の検出・pg_dependでは0件の実証・旧語彙/隣接未知ID/municipality非一意の検出・読むだけ保証）

## 前提・注意
- Storageパスは既に `<office_code>/<日付>/…` で保存されている（carry/sheet/godoor 各画面）→ **フロント改修不要**。
- ①適用後、**ルート直下など office prefix の無いパスへは誰も書けなくなる**（意図どおり）。
- 範囲外0件の最終サインオフは実機ログインで（SQL Editor は postgres＝バイパスのため、なりすましブロックの外では証明にならない）。
