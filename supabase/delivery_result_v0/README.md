# 配達実績 v0（delivery_results ＋ 記録口 record_delivery_result）

要件定義 **8.11（配達実績の取得・最小スライス）**。ドライバーが「完了/不在」をタップ→実GPS付きで記録。
実装計画: `docs/superpowers/plans/2026-07-17-driver-mvp-wiring.md` Task 1。
指示書ドラフト: `docs/shijisho_drafts/shijisho_driver_result_v0_1_draft.md`（承認前・非公式）。

## ファイル（コピペ実行の順）

| ファイル | 役割 |
| --- | --- |
| `delivery_result_v0.sql` | `delivery_results` 表（tracking_number/driver_id/result/lat/lng/recorded_at/created_by）＋RLS（SELECTのみ）＋記録口 `record_delivery_result` |
| `seed_delivery_result_v0.sql` | DRV001（愛知A01）の当日仕分済ダミー5件を作り、記録口経由で完了3/不在2にする |
| `check_delivery_result_v0.sql` | 主張=検証1:1（内訳・行数一致）＋範囲外0件（shipper/他営業所/anon）の実証 |
| `pglite_test.mjs` | E2E検証（10ケース・40アサーション・40/40 PASS） |
| `確認結果メモ.md` | pglite結果の記録（実機は未実施） |

## 実行順（実機・【人】がSQL Editorで）

1. 前提: `dbschema_v0`・`rls_v0`（profiles/my_*ヘルパ/deliveries）・`status_log_v0`（`delivery_status_log`＋`record_status_transition`）が適用済みであること。
2. `delivery_result_v0.sql`
3. `seed_delivery_result_v0.sql`（DRV001ダミーUUID `00000000-…-d1` で疑似ログインし記録口を呼ぶ。rls_v0/seed_accounts_v0.sql が適用済みで、そのUUIDが `profiles` にある前提）
4. `check_delivery_result_v0.sql`

## 設計判断

- **driver専用口**：`record_delivery_result` は `auth.uid() is not null and my_role()='driver' and my_driver() is not null` を必須にした。管理側による訂正（誤タップの巻き戻し等）は本関数の対象外＝`record_status_transition` を別途直接呼ぶ運用とする。
- **`record_status_transition` を再利用**：遷移検証（線形順序）・`deliveries.status` 更新・`delivery_status_log` 記録は既存の記録口に**委譲**し、二重実装しない。`record_delivery_result` は「仕分済なら配送中を自動経由してから結果へ」の**手順**だけを足す薄いラッパー。未配車/配車済など線形外の状態から呼ばれた場合は、内側の `record_status_transition` がそのまま23514で弾く（＝状態機械の一貫性は１箇所だけが知っている）。
- **不在＝当日終端**：`不在` は状態機械の終端として扱い、`不在→配送中` の戻し遷移（日内再訪）は本v0の**範囲外**（現場慣行が未確認・LOL確認事項）。再訪が要る場合は次弾で `record_status_transition` 側に遷移を追加する想定。
- **GPS null許容**：`lat`/`lng` は NULL 許容。位置情報取得の拒否/失敗でも「完了/不在」の記録自体は止めない（MVPの命綱＝タップが必ずDBに残る）。戻り値 `gps` フィールド（true/false）でアプリ側が取得成否を判別できるようにした。
- **冪等**：既に `完了`/`不在` の荷物に再度同じ関数を呼んでも `{"result":"already"}` を返すだけで行は増えない（二度押し・オフライン再送キューからの再送も無害）。
- **第1.5弾（本v0の範囲外）**：`photo_path`（置き配写真POD）・常時位置追跡・不在理由コード・バーコード照合（8.5）は次弾で追加予定。`delivery_results` 表に列を足す形で拡張できるよう、記録口の戻り値は `jsonb` にして将来のフィールド追加に備えている。

## セキュリティ観点

- **本人限定**：`deliveries.driver_id`（記録口内で自前取得）と `my_driver()` の不一致は `42501` で拒否。他ドライバーの荷物には触れない。
- **入力検証**：`p_result` は `完了`/`不在` のみ（`23514`）。緯度 `[-90,90]`・経度 `[-180,180]` を関数内 and 表の `check` 制約の**二重**で検証（`23514`）。
- **書込みポリシー無し＝関数一本化**：`delivery_results` に INSERT/UPDATE/DELETE の RLS ポリシーは置かない。書込みは `record_delivery_result`（`SECURITY DEFINER`・`set search_path = public`固定）のみが行える。`revoke execute … from public` → `grant … to authenticated` のみ。
- **RLS（SELECT）**：hq=全件／depot=配下営業所所属ドライバー分／area=自営業所所属ドライバー分（`my_office_drivers()`）／driver=自分のみ／**shipperとanonは0件**（shipperは `case` にこの表専用の分岐を作らず `else false` に落とす＝構造的に不可視。荷主向けの状況照会は既存の非PII口 `delivery_status_public` に一本化する設計と整合）。
- **PII/機微**：`lat`/`lng` は COMMENT で機微明示。将来 `photo_path` を足す際も同じ扱いにする。

## pglite テストケース（10本・40アサーション）

1. driver本人が仕分済の自担当荷物に「完了」→2遷移（仕分済→配送中→完了）＋`delivery_results`1行（lat/lng保存）
2. 「不在」→同様に2遷移＋result=不在
3. 配送中の荷物に「完了」→1遷移のみ
4. 既に完了済みへ再度「完了」→`{"result":"already"}`・行が増えない（冪等）
5. 他ドライバーの荷物→`42501`
6. area/hq/shipper/anonロール→`42501`（driver専用口。anonは`GRANT`未付与による権限エラー）
7. `p_result='破棄'`等→`23514`
8. `lat=91`/`lng=181`→`23514`／`lat`/`lng`=null は成功（GPS失敗でも止めない）
9. 未配車/配車済の荷物への「完了」→拒否（線形遷移が守られる。未配車=担当不一致で`42501`、配車済=`record_status_transition`側の線形検証で`23514`）
10. RLS：`delivery_results` を hq=全件・area=自営業所分・driver=自分のみ・shipper=0件・anon=権限エラー

## 用語（用語集v0.1・実値）

問合番号(tracking_number)・配達順(delivery_order)・完了/不在（`deliveries.status` の実値）。

## LOL確認事項（未決）

- 日内再訪（不在→再配達）の現場慣行の有無 → あれば戻し遷移を第2弾で追加。
- 荷主の時間指定の入れ口（当面は再配達受付=reception_requests.time_slot を源泉とする想定）。
- 第1.5弾（勤務中限定の常時追跡・置き配写真POD）の実施順。
