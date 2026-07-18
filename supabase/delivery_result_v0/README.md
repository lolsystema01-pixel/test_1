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
| `pglite_test.mjs` | E2E検証（13ケース・58アサーション・58/58 PASS。11-13が日内再訪＋MED-2の追加ケース） |
| `確認結果メモ.md` | pglite結果の記録（実機は未実施） |

## 実行順（実機・【人】がSQL Editorで）

1. 前提: `dbschema_v0`・`rls_v0`（profiles/my_*ヘルパ/deliveries）・`status_log_v0`（`delivery_status_log`＋`record_status_transition`）が適用済みであること。
2. `delivery_result_v0.sql`
3. `seed_delivery_result_v0.sql`（DRV001ダミーUUID `00000000-…-d1` で疑似ログインし記録口を呼ぶ。rls_v0/seed_accounts_v0.sql が適用済みで、そのUUIDが `profiles` にある前提）
4. `check_delivery_result_v0.sql`

## 設計判断

- **driver専用口**：`record_delivery_result` は `auth.uid() is not null and my_role()='driver' and my_driver() is not null` を必須にした。管理側による訂正（誤タップの巻き戻し等）は本関数の対象外＝`record_status_transition` を別途直接呼ぶ運用とする。
- **`record_status_transition` を再利用**：遷移検証（線形順序）・`deliveries.status` 更新・`delivery_status_log` 記録は既存の記録口に**委譲**し、二重実装しない。`record_delivery_result` は「仕分済なら配送中を自動経由してから結果へ」の**手順**だけを足す薄いラッパー。未配車/配車済など線形外の状態から呼ばれた場合は、内側の `record_status_transition` がそのまま23514で弾く（＝状態機械の一貫性は１箇所だけが知っている）。
- **不在→再配達（日内再訪・LOL確定2026-07-18）**：`不在` は終端ではなく再処理可能な状態にした。冪等ガードは「`完了`のみ`already`」に変更し、`不在`の荷物に再度 `record_delivery_result` を呼ぶと `不在→配送中→完了/不在` の2遷移で記録し直せる（同一 `tracking_number` に `delivery_results` 2行目が積み増される・1行目は履歴として残る）。遷移そのものは `record_status_transition_internal`（`status_log_v0/record_status_transition_v0.sql`）の許可リストに `('不在','配送中')` を1本追加しただけで、`完了` からの戻し遷移は追加していない＝`完了` は引き続き終端。
- **MED-2対応（2026-07-18監査）**：本関数は内部の状態遷移呼び出し先を `record_status_transition`（公開ラッパー・authenticatedへgrant）ではなく非公開の `record_status_transition_internal`（authenticatedへgrant無し）に変更した。これにより「driverが `record_status_transition` を直接RPC呼び出しして完了/不在へ到達する」経路を公開ラッパー側で拒否しつつ、`record_delivery_result`（本関数）からの内部呼び出しだけは所有者権限で通る＝完了/不在の記録口は事実上この関数一本に固定される。設計の詳細・根拠は `status_log_v0/README.md`「MED-2対応」節を参照。
- **GPS null許容**：`lat`/`lng` は NULL 許容。位置情報取得の拒否/失敗でも「完了/不在」の記録自体は止めない（MVPの命綱＝タップが必ずDBに残る）。戻り値 `gps` フィールド（true/false）でアプリ側が取得成否を判別できるようにした。
- **冪等**：既に `完了`/`不在` の荷物に再度同じ関数を呼んでも `{"result":"already"}` を返すだけで行は増えない（二度押し・オフライン再送キューからの再送も無害）。**並行呼び出し**（同時二度押し・オフライン再送の同時到達）も同じ結果になるよう、`deliveries` の対象行を `select … for update` で行ロックしてから読む。敗者は勝者のcommitまで待機し、その後は終端status（完了/不在）を読んで冪等ガードに落ちる＝レースでも二重遷移・二重記録が起きない。
- **`delivery_results` に一意制約はあえて付けない**：`(tracking_number)` や `(tracking_number, result)` へのUNIQUE制約は将来の「再配達（不在→再訪で同一問合番号に2件目の実績が付く）」を妨げるため入れていない。二重INSERTは一意制約ではなく、上記の行ロック＋`deliveries.status`の冪等ガード（既に完了/不在なら`record_status_transition`を呼ばずINSERTもしない）で防ぐ。
- **戻り値の契約**：`recorded`（新規記録）は `id`/`gps` を含むが、`already`（冪等ヒット）は `result`/`tracking_number`/`status` のみで `id`/`gps` を**含まない**。クライアントは `result` フィールドで分岐すること（`already` も呼び出しとしては成功=例外なし。UI上はどちらも「記録済み」として扱ってよい）。
- **第1.5弾（本v0の範囲外）**：`photo_path`（置き配写真POD）・常時位置追跡・不在理由コード・バーコード照合（8.5）は次弾で追加予定。`delivery_results` 表に列を足す形で拡張できるよう、記録口の戻り値は `jsonb` にして将来のフィールド追加に備えている。

## セキュリティ観点

- **本人限定**：`deliveries.driver_id`（記録口内で自前取得）と `my_driver()` の不一致は `42501` で拒否。他ドライバーの荷物には触れない。
- **入力検証**：`p_result` は `完了`/`不在` のみ（`23514`）。緯度 `[-90,90]`・経度 `[-180,180]` を関数内 and 表の `check` 制約の**二重**で検証（`23514`）。
- **書込みポリシー無し＝関数一本化**：`delivery_results` に INSERT/UPDATE/DELETE の RLS ポリシーは置かない。書込みは `record_delivery_result`（`SECURITY DEFINER`・`set search_path = public`固定）のみが行える。`revoke execute … from public` → `grant … to authenticated` のみ。
- **RLS（SELECT）**：hq=全件／depot=配下営業所所属ドライバー分（`my_depot_drivers()`）／area=自営業所所属ドライバー分（`my_office_drivers()`）／driver=自分のみ／**shipperとanonは0件**（shipperは `case` にこの表専用の分岐を作らず `else false` に落とす＝構造的に不可視。荷主向けの状況照会は既存の非PII口 `delivery_status_public` に一本化する設計と整合）。
  - **depot分岐は `public.drivers` を直接参照しない**：`public.drivers` には hq/area/driver本人のSELECTポリシーしかなく（`rls_v0.sql`・機微テーブルのため）depot用ポリシーが無い。ポリシーの `using` 節内で `drivers` をそのまま `where d.office_code = any(...)` のように直接引くと、depotロールはRLSでfail-closedにより常に0件になる。`my_office_drivers()` と同じ「RLSを跨ぐSECURITY DEFINERヘルパー」パターンで `my_depot_drivers()` を新設し、depot分岐はこれ経由に統一した。
- **PII/機微**：`lat`/`lng` は COMMENT で機微明示。将来 `photo_path` を足す際も同じ扱いにする。

## pglite テストケース（10本・43アサーション）

1. driver本人が仕分済の自担当荷物に「完了」→2遷移（仕分済→配送中→完了）＋`delivery_results`1行（lat/lng保存）
2. 「不在」→同様に2遷移＋result=不在
3. 配送中の荷物に「完了」→1遷移のみ
4. 既に完了済みへ再度「完了」→`{"result":"already"}`・行が増えない（冪等）
5. 他ドライバーの荷物→`42501`
6. area/hq/shipper/anonロール→`42501`（driver専用口。anonは`GRANT`未付与による権限エラー）
7. `p_result='破棄'`等→`23514`
8. `lat=91`/`lng=181`→`23514`／`lat`/`lng`=null は成功（GPS失敗でも止めない）
9. 未配車/配車済の荷物への「完了」→拒否（線形遷移が守られる。未配車=担当不一致で`42501`、配車済=`record_status_transition`側の線形検証で`23514`）
10. RLS：`delivery_results` を hq=全件・**depot=配下営業所(A01)所属ドライバー分**・area=自営業所分・driver=自分のみ・shipper=0件・anon=権限エラー。depotテストは `drivers` にhq/area/driver本人のみのRLSポリシー（depot分岐無し）を再現したうえで `my_depot_drivers()` 経由の可視性を検証＝旧実装（`drivers`直接参照）に戻すと depot が0件に落ちて失敗することを確認済み。
11. **日内再訪（LOL確定2026-07-18）**：`不在`の荷物に再度「完了」→冪等ガードに阻まれず2巡目として記録（`不在→配送中→完了`の2遷移が追加され、ログ計4行・`delivery_results`に2行目が積み増される＝1行目は履歴として残る）。
12. **完了は引き続き終端**：完了済みへ再度呼んでも`{"result":"already"}`・行は増えない（不在への巻き戻しはしない）。
13. **MED-2**：driverが `record_status_transition`（公開ラッパー）を直接呼んでも完了へは到達できない（`42501`）。`record_delivery_result`経由なら正規に完了できることも確認＝完了/不在の記録口が事実上この関数一本に固定されていることの実証。

## 用語（用語集v0.1・実値）

問合番号(tracking_number)・配達順(delivery_order)・完了/不在（`deliveries.status` の実値）。

## LOL確認事項（未決）

- 荷主の時間指定の入れ口（当面は再配達受付=reception_requests.time_slot を源泉とする想定）。
- 第1.5弾（勤務中限定の常時追跡）の実施順。

## 確定事項（2026-07-18）

- **日内再訪（不在→再配達）**：現場慣行あり＝LOL確定。`不在→配送中` の戻し遷移を追加済み（上記「設計判断」参照）。
- **写真POD（置き配証跡）**：`delivery_photo_v0/` で実装（最大3枚・6ヶ月保存・入替時clear）。
