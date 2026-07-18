# 置き配写真POD v0（photo_path ＋ Storage delivery-photos ＋ 記録口 attach_delivery_photo）

要件定義 **8.5（撮影ガイド文言）**／設計書 `docs/superpowers/specs/2026-07-16-driver-app-native-mvp-design.md` **§10.5（第1.5弾）**。
管理要望「置き配がどこに置かれたか見たい」。GPS精度5〜15mでは2件並びの識別は不可能＝**隣家識別の証拠は写真のみ**、という結論に基づく。

対になるアプリ側実装: `apps/driver_native_v0`（CompletionModal の置き配フロー＝実カメラ撮影→アップロード→attach）。

## ファイル（コピペ実行の順）

| ファイル | 役割 |
| --- | --- |
| `delivery_photo_v0.sql` | `delivery_results.photo_path` 列 ＋ Storage `delivery-photos` バケット・RLS（INSERT/SELECTのみ） ＋ 記録口 `attach_delivery_photo` |
| `check_delivery_photo_v0.sql` | 主張=検証1:1（begin…rollbackで自己完結）＋範囲外拒否の実証 |
| `pglite_test.mjs` | E2E検証（rpc・column部分のみ。storage.objectsの実効性はpgliteの対象外＝下記参照。22アサーション・22/22 PASS） |
| `確認結果メモ.md` | pglite結果の記録。**storageポリシーの実機検証が必要な旨を明記** |

## 実行順（実機・【人】がSQL Editorで）

1. 前提: `dbschema_v0`・`rls_v0`（profiles/my_*ヘルパ/deliveries）・`status_log_v0`・**`delivery_result_v0`**（`delivery_results` 表・`record_delivery_result`・`my_depot_drivers()`）が適用済みであること。
2. `delivery_photo_v0.sql`
3. `check_delivery_photo_v0.sql`

## 設計判断

- **既存パターンの流用**：Storageの営業所別prefix制限（`auth_rls_remaining_v1/storage_rls_all_buckets_v0.sql` の `storage_office_allowed(name)`＝`(storage.foldername(name))[1]` × `my_*` ヘルパ）と同じ形を、office_code ではなく **driver_id** で行った。パス運用は `<driver_id>/<tracking_number>.jpg`。
- **書込スコープはdriver限定・自フォルダのみ**：`storage_own_driver_folder(name)` は `my_role()='driver' and (storage.foldername(name))[1] = my_driver()` のみ true。hq/depot/area/shipperは書けない（写真を撮るのは配達したドライバー本人のみという業務上の制約と一致）。
- **読取スコープは delivery_results の可視範囲を流用**：`storage_driver_visible(name)` は hq=全件／depot=配下営業所所属ドライバー分（`my_depot_drivers()`）／area=自営業所所属ドライバー分（`my_office_drivers()`）／driver=自分のみ。`delivery_results_select`（`delivery_result_v0.sql`）と全く同じ判定式を使い、可視範囲の齟齬が生まれないようにした。
- **UPDATEポリシーはあえて付けない（差分: 他モジュールとの違い）**：`carry-sheets`/`dispatch-sheets`/`godoor-csv` は `upsert:true` の帳票再保存に対応するためUPDATEポリシーを追加しているが、置き配写真は**証跡（配達現場の事実）**であり、後日の差し替え（撮り直し・すり替え）を防ぎたい。そのためStorageオブジェクトのUPDATE/DELETEは**default-denyのまま**にし、アプリ側は `upload(..., { upsert: false })` を使う設計にした。再送で「既に存在」エラーが返った場合は、前回試行でアップロード自体は成功していたとみなし、そのまま次段の `attach_delivery_photo` へ進む（アプリ側 `apps/driver_native_v0/src/lib/photoQueue.ts` 参照）。
  - 一方、**`delivery_results.photo_path`列自体は attach_delivery_photo という一つの記録口経由でのみ書ける**ため表側の整合性は保たれる。ただしStorageオブジェクト側にUPDATE手段が無い設計は、**同一 tracking_number への2回目の配達（再配達）で写真パスが衝突する**という既知の制約を生む（次項参照）。
- **記録口 `attach_delivery_photo` は `record_delivery_result` と同型**：認可（`auth.uid() is not null and my_role()='driver' and my_driver() is not null`）・エラーコードの使い分け（`42501`=認可/パス偽装・`23514`=入力検証・`P0002`=対象行なし）を揃えた。
- **対象行は「最新の delivery_results 行」**：`tracking_number` に一意制約は無い（`delivery_result_v0` の設計＝将来の再配達に備えて意図的に外している）。`attach_delivery_photo` は `order by id desc limit 1 for update` で最新行を対象にする＝直前に記録した完了/不在に写真が紐付く。
- **冪等・上書き拒否は23505を使わない**：同一パスの再送は `{"result":"already"}` で無害。既に**別の**写真が記録されている場合は上書きせず、`raise exception`（デフォルトSQLSTATE `P0001`）で明示的に拒否する（指示書どおり `23505` 系の制約違反コードは使わない＝意図的な業務ルールとしてのエラーであることを明確にするため）。
- **パス検証はStorageポリシーと二重**：`p_photo_path` が `my_driver()||'/'` で始まることを関数内でも検証する。Storage側のINSERTポリシーで既にブロックされる想定だが、`attach_delivery_photo` は記録口として独立に呼べる（例えば後からパスだけ渡して紐付け直す運用）ため、関数側でも同じ検証を行い「他人のフォルダのパスを紐付けさせない」を二重に保証した。

## 既知の制約（LOL確認事項）

- **再配達時のパス衝突**：`<driver_id>/<tracking_number>.jpg` は決定的なパスのため、同一 `tracking_number` に対する2回目の配達（不在→再配達で別日に完了）で新しい写真を撮っても、Storage側にUPDATE権限が無いため上書きアップロードができない。再配達運用が実際に発生する場合は、パスに `recorded_at` または試行回数を含める（例: `<driver_id>/<tracking_number>-<epoch>.jpg`）設計変更が必要。`delivery_result_v0/README.md` の「日内再訪の現場慣行」確認事項と合わせて要相談。
- **Storageポリシーの実効性は実機でのみ完全に証明できる**：`check_delivery_photo_v0.sql` はSQL Editorのロール切替（`set local role authenticated`）で `attach_delivery_photo`（rpc・テーブル側）までは検証できるが、**実際のファイルアップロード（Storage REST API・マルチパート）を伴う `storage.objects` への書込み拒否**は、SQL Editorから `storage.objects` に直接INSERTしても代替にならない（本物のアップロード経路を通らないため）。実機確認手順は下記。

## pglite テストケース（rpc・column部分のみ・8ブロック・22アサーション）

`storage.objects` はpgliteに（Supabase Storage実装として）存在しないため、`pglite_test.mjs` では以下の最小スタブのみ用意している（`auth_rls_remaining_v1/pglite_test_storage.mjs` と同方式）:
- `storage.buckets`（id/name/public/file_size_limit/allowed_mime_types）
- `storage.objects`（id/bucket_id/name）
- `storage.foldername(name)`（Supabaseと同じ意味のフォルダ抽出関数）

これにより **`delivery_photo_v0.sql` の全文がエラー無く適用できる**こと（バケットINSERT・2ポリシーのCREATE POLICYを含む）を確認したうえで、以降のテストは **rpc（`attach_delivery_photo`）と column（`photo_path`）の振る舞いのみ**を対象にしている。Storageポリシーの実効性（実際のオブジェクトへのINSERT/SELECTが拒否されるか）はpgliteでは検証していない。

1. `delivery_photo_v0.sql` が例外なく適用できる（Storageスタブ込み）
2. `photo_path` 列の存在・Storageポリシー2件（insert/select）の登録
3. 本人紐付けOK：DRV001が自分のフォルダ配下のパスをattach → `recorded`
4. 冪等：同一パスの再送 → `already`・値は変わらない
5. 既に別の写真がある行への上書き拒否（`P0001`＝明示エラー・`23505`ではない）
6. 他人拒否：DRV001がDRV002所有の `delivery_results` 行にattach → `42501`
7. パス接頭辞検証：他人のフォルダ・ルート直下（フォルダ無し）のパス → `42501`
8. 入力検証：300文字超のパス → `23514`
9. 非driver拒否：area/hq/shipper/anon は呼べない → `42501`（anonはGRANT未付与）
10. `delivery_results` 未存在の問合番号 → `P0002`

## 実機確認手順（【人】向け・未実施）

1. `delivery_photo_v0.sql` → `check_delivery_photo_v0.sql` の順でSupabase SQL Editorにブロック単位で貼り付けてRun。
2. `check_delivery_photo_v0.sql` の②③でrpcレベルの主張=検証・範囲外拒否を数値/エラーコードで突合。
3. **Storage実効性（アプリ or REST APIで）**：
   - DRV001としてログイン（Expo Goの実機 or `curl`＋anon key＋DRV001のJWT）→ `delivery-photos` バケットの `DRV001/test.jpg` へアップロード → 成功。
   - 同じDRV001で `DRV002/test.jpg` へアップロードを試みる → 失敗（403）。
   - area(A01)としてログイン → `DRV001/test.jpg`（配下ドライバー）をダウンロード → 成功。`DRV003`（C01所属＝他営業所）のパスをダウンロード → 失敗（0件/403）。
   - hqとしてログイン → 全ドライバー分をダウンロードできる。
4. 結果をこのメモの「実機確認結果」節に追記（現時点は空欄＝未実施）。

## 用語（用語集v0.1・実値）

問合番号(tracking_number)・置き配（要件8.5）。POD（Proof of Delivery）はプロジェクト内の英略称（用語集には未収載・指示書内定義）。
