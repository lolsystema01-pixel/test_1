# 置き配写真POD v0（delivery_photos表 ＋ Storage delivery-photos ＋ 記録口 attach_delivery_photo／clear_delivery_photos）

要件定義 **8.5（撮影ガイド文言）**／設計書 `docs/superpowers/specs/2026-07-16-driver-app-native-mvp-design.md` **§10.5（第1.5弾）**。
管理要望「置き配がどこに置かれたか見たい」。GPS精度5〜15mでは2件並びの識別は不可能＝**隣家識別の証拠は写真のみ**、という結論に基づく。

**2026-07-18 LOL確定＋監査対応（MED-3）**：写真は**1配達につき最大3枚**・**6ヶ月保存**・**2回目訪問（日内再訪）は入れ替え**。
`photo_path` 単数列（v0初版）はこの要件を表現できないため、本版で `delivery_photos`（複数行テーブル）に置き換えた。
併せて、パス検証を「driver_idの前方一致」から「`{driver_id}/{tracking_number}/{seq}.jpg` の**完全一致**」に強化（MED-3＝別配達の写真を誤って紐付けられる余地を塞ぐ）。

対になるアプリ側実装: `apps/driver_native_v0`（CompletionModal の置き配フロー＝実カメラ撮影→アップロード→attach）。

## ファイル（コピペ実行の順）

| ファイル | 役割 |
| --- | --- |
| `delivery_photo_v0.sql` | `delivery_photos` 表（複数枚正規化・最大3枚）＋ Storage `delivery-photos` バケット・RLS（INSERT/SELECTのみ） ＋ 記録口 `attach_delivery_photo`／`clear_delivery_photos` |
| `check_delivery_photo_v0.sql` | 主張=検証1:1（begin…rollbackで自己完結）＋範囲外拒否の実証 |
| `pglite_test.mjs` | E2E検証（rpc・table部分のみ。storage.objectsの実効性はpgliteの対象外＝下記参照） |
| `確認結果メモ.md` | pglite結果の記録。**storageポリシーの実機検証が必要な旨を明記** |

## 実行順（実機・【人】がSQL Editorで）

1. 前提: `dbschema_v0`・`rls_v0`（profiles/my_*ヘルパ/deliveries）・`status_log_v0`・**`delivery_result_v0`**（`delivery_results` 表・`record_delivery_result`・`my_depot_drivers()`）が適用済みであること。
2. `delivery_photo_v0.sql`（旧版を既に適用済みの環境があれば、本ファイル冒頭で `delivery_results.photo_path` 列を自動的にdropして`delivery_photos`表へ移行する）
3. `check_delivery_photo_v0.sql`

## 設計判断

- **`delivery_photos` テーブルへの正規化（1配達=複数行・最大3）**：`photo_paths text[]` 案も検討したが、1枚ずつの行ロック・冪等判定（同一seqへの再送等）を素直に書けるテーブル正規化を採用した。`delivery_results` 側のスキーマを触らずに済む＝写真モジュールの変更が `delivery_result_v0` に波及しない（モジュール境界を保つ）。RLS（SELECTのみ・書込みは関数一本化）は `delivery_results_select` と全く同じ判定式（`my_depot_drivers()`/`my_office_drivers()`）を複製し、可視範囲の齟齬が生まれないようにした。
- **パス運用（2階層に変更）**：`{driver_id}/{tracking_number}/{seq}.jpg`（seq=1〜3）。旧版は `{driver_id}/{tracking_number}.jpg` の1階層だった。Storageの書込/読取スコープ判定（`storage_own_driver_folder`/`storage_driver_visible`）は先頭フォルダ（`storage.foldername(name)[1]`＝driver_id）だけを見るため、階層が増えてもロジック変更は不要だった。
- **書込スコープはdriver限定・自フォルダのみ**：`storage_own_driver_folder(name)` は `my_role()='driver' and (storage.foldername(name))[1] = my_driver()` のみ true。hq/depot/area/shipperは書けない（写真を撮るのは配達したドライバー本人のみという業務上の制約と一致）。
- **読取スコープは delivery_results の可視範囲を流用**：`storage_driver_visible(name)` は hq=全件／depot=配下営業所所属ドライバー分（`my_depot_drivers()`）／area=自営業所所属ドライバー分（`my_office_drivers()`）／driver=自分のみ。
- **UPDATEポリシーはあえて付けない（差分: 他モジュールとの違い）**：`carry-sheets`/`dispatch-sheets`/`godoor-csv` は `upsert:true` の帳票再保存に対応するためUPDATEポリシーを追加しているが、置き配写真は**証跡（配達現場の事実）**であり、後日の差し替え（撮り直し・すり替え）を防ぎたい。そのためStorageオブジェクトのUPDATE/DELETEは**default-denyのまま**にし、アプリ側は `upload(..., { upsert: false })` を使う設計にした。再送で「既に存在」エラーが返った場合は、前回試行でアップロード自体は成功していたとみなし、そのまま次段の `attach_delivery_photo` へ進む（アプリ側 `apps/driver_native_v0/src/lib/photoQueue.ts` 参照）。
- **記録口 `attach_delivery_photo` は `record_delivery_result` と同型**：認可（`auth.uid() is not null and my_role()='driver' and my_driver() is not null`）・エラーコードの使い分け（`42501`=認可/パス偽装・`23514`=入力検証・`P0002`=対象行なし）を揃えた。シグネチャは `attach_delivery_photo(p_tracking_number, p_seq, p_photo_path)` に変更（`p_seq` を明示引数化し、パス内のseqと突き合わせることでseq偽装も検出できるようにした）。
- **対象行は「最新の delivery_results 行」**：`tracking_number` に一意制約は無い（`delivery_result_v0` の設計＝日内再訪に備えて意図的に外している）。`attach_delivery_photo` は `order by id desc limit 1 for update` で最新行を対象にする＝直前に記録した完了/不在に写真が紐付く。
- **冪等・上書き拒否は23505を使わない**：同一パスの再送は `{"result":"already"}` で無害。既に**別の**写真が記録されている場合は上書きせず、`raise exception`（デフォルトSQLSTATE `P0001`）で明示的に拒否する。ただし後述のMED-3パス厳密一致により、この分岐が通常のRPC経路で到達することは実質的に無い（防御的分岐として維持。pgliteテストではデータ不整合を模擬して検証している）。
- **MED-3対応：パスは完全一致を要求**：旧版は `p_photo_path` が `my_driver()||'/'` で始まることしか検証しておらず、同じdriverの**別tracking_numberフォルダの写真パスを紐付けられる**余地があった（誤紐付け・使い回し）。本版は `p_photo_path = my_driver()||'/'||p_tracking_number||'/'||p_seq||'.jpg'` の**完全一致**を要求する（前方一致ではなく `<>` での厳密比較）。これにより「自分のフォルダだが別配達／別seqを指すパス」を紐付けようとする呼び出しも `42501` で拒否できる。
- **1配達最大3枚**：`seq smallint check (seq between 1 and 3)` ＋ `unique(result_id, seq)` ＋ 関数内の枚数カウントガード（3重）。`p_seq` が範囲外なら `23514`。

## 6ヶ月保存の運用（LOL確定・スコープ外の自動化）

Storageのライフサイクル削除（6ヶ月経過後の自動削除）は、**Supabase側にSQLだけでは完結する自動化手段が無い**（バケットのライフサイクルルールはSupabase Dashboard GUI、または別途スケジュールジョブ〔Edge Function + pg_cron等〕での実装が必要）。本v0の範囲では実装しない。
【人】が以下いずれかで運用すること:
1. Supabase Dashboard → Storage → `delivery-photos` → ライフサイクルルール（対応バージョンであれば）で6ヶ月後削除を設定。
2. 定期実行のクリーンアップジョブ（`recorded_at < now() - interval '6 months'` の `delivery_photos` 行とその Storage オブジェクトを消す）を別途用意する。

## 日内再訪（2回目訪問）の写真入れ替え：`clear_delivery_photos`

- パス（`{driver_id}/{tracking_number}/{seq}.jpg`）は **tracking_number単位で決定的**（`result_id` 非依存）。そのため日内再訪（`delivery_result_v0` の不在→再配達）で新しい写真を撮っても、旧オブジェクトを消さないまま同じパスへ`upsert:false`でアップロードすると衝突する。
- `clear_delivery_photos(p_tracking_number)` は、対象荷物の Storage オブジェクト（該当プレフィックス）と `delivery_photos` 行をまとめて削除する専用口。**本人限定**かつ**対象荷物が現在`不在`のときのみ**呼べる（完了済み配達の証跡をドライバー自身が消せてしまう＝改ざんを防ぐ安全装置）。
- **既知の制約（SQLレベルの限界）**：`clear_delivery_photos` の `delete from storage.objects` は**メタデータ行の削除**であり、Supabase Storageの実バックエンド（S3互換オブジェクトストレージ）上の実ファイルが同時に消える保証はSQL単体では担保できない（本来はStorage REST APIの `DELETE` エンドポイント経由が実体削除も伴う正規の方法）。本v0はメタデータ削除により「同一パスへの再アップロードがブロックされない」実用上の効果を狙う設計とした。実ファイルの完全消去保証が必要になった場合は、次弾でEdge Function等からStorage REST APIを呼ぶ設計に切り替えることをここに明記する。

## 既知の制約（実機検証待ち）

- **Storageポリシーの実効性は実機でのみ完全に証明できる**：`check_delivery_photo_v0.sql` はSQL Editorのロール切替（`set local role authenticated`）で `attach_delivery_photo`/`clear_delivery_photos`（rpc・テーブル側）までは検証できるが、**実際のファイルアップロード（Storage REST API・マルチパート）を伴う `storage.objects` への書込み拒否**は、SQL Editorから `storage.objects` に直接INSERTしても代替にならない（本物のアップロード経路を通らないため）。実機確認手順は下記。
- **`clear_delivery_photos` の実ファイル削除保証**：上記「日内再訪の写真入れ替え」節を参照。

## pglite テストケース（rpc・table部分のみ）

`storage.objects` はpgliteに（Supabase Storage実装として）存在しないため、`pglite_test.mjs` では以下の最小スタブのみ用意している（`auth_rls_remaining_v1/pglite_test_storage.mjs` と同方式）:
- `storage.buckets`（id/name/public/file_size_limit/allowed_mime_types）
- `storage.objects`（id/bucket_id/name）
- `storage.foldername(name)`（Supabaseと同じ意味のフォルダ抽出関数）

これにより **`delivery_photo_v0.sql` の全文がエラー無く適用できる**こと（バケットINSERT・2ポリシーのCREATE POLICYを含む）を確認したうえで、以降のテストは **rpc（`attach_delivery_photo`／`clear_delivery_photos`）と `delivery_photos` テーブルの振る舞いのみ**を対象にしている。Storageポリシーの実効性（実際のオブジェクトへのINSERT/SELECTが拒否されるか）はpgliteでは検証していない。`clear_delivery_photos` の `storage.objects` DELETEは、テスト内で直接INSERTした行（実アップロードの代役）に対してSQLレベルのDELETEが効くことのみ確認している。

0. `delivery_photo_v0.sql` が例外なく適用できる（Storageスタブ込み）／旧`photo_path`列が消えている／`delivery_photos`表とRLS・Storageポリシー2件の登録確認
1. 本人紐付けOK：DRV001が自分のフォルダ配下・厳密一致のパスをattach（seq=1,2,3） → `recorded`
2. 冪等：同一seq×同一パスの再送 → `already`・値は変わらない
3. 既に別の写真がある枠(seq)への上書き拒否（`P0001`＝明示エラー・`23505`ではない。データ不整合を模擬して検証）
4. 枚数上限：`seq`は1〜3のみ（0や4は`23514`で拒否）
5. 他人拒否：DRV001がDRV002所有の `delivery_results` 行にattach → `42501`
6. **MED-3対応**：パス厳密一致検証（他人のフォルダ・ルート直下・★自分のフォルダだが別tracking_numberを指すパス・★パス内seqと引数`p_seq`の不一致）→ すべて`42501`
7. 非driver拒否：area/hq/shipper/anon は呼べない → `42501`（anonはGRANT未付与）
8. `delivery_results` 未存在の問合番号 → `P0002`
9. `clear_delivery_photos`：日内再訪（不在）時のみ許可（完了状態は`42501`）・他人拒否（`42501`）・未存在拒否（`P0002`）・成功時にStorageオブジェクト（自バケット内一致分のみ・紛らわしい別名は残る）と`delivery_photos`行が消える・clear後の同一パス再attachは「新規3枠」として`recorded`になる（衝突しない＝旧行が本当に消えている証拠）

## 実機確認手順（【人】向け・未実施）

1. `delivery_photo_v0.sql` → `check_delivery_photo_v0.sql` の順でSupabase SQL Editorにブロック単位で貼り付けてRun。
2. `check_delivery_photo_v0.sql` の②③でrpcレベルの主張=検証・範囲外拒否を数値/エラーコードで突合。
3. **Storage実効性（アプリ or REST APIで）**：
   - DRV001としてログイン（Expo Goの実機 or `curl`＋anon key＋DRV001のJWT）→ `delivery-photos` バケットの `DRV001/900000000901/1.jpg` へアップロード → 成功。
   - 同じDRV001で `DRV002/900000000901/1.jpg` へアップロードを試みる → 失敗（403）。
   - area(A01)としてログイン → `DRV001/…`（配下ドライバー）をダウンロード → 成功。`DRV003`（C01所属＝他営業所）のパスをダウンロード → 失敗（0件/403）。
   - hqとしてログイン → 全ドライバー分をダウンロードできる。
   - **日内再訪**：不在→再配達で `clear_delivery_photos` を呼んだ後、同じパス（`DRV001/900000000901/1.jpg`）へ再アップロード → 成功（旧オブジェクトが消えているため衝突しない）。
4. 結果をこのメモの「実機確認結果」節に追記（現時点は空欄＝未実施）。

## 用語（用語集v0.1・実値）

問合番号(tracking_number)・置き配（要件8.5）。POD（Proof of Delivery）はプロジェクト内の英略称（用語集には未収載・指示書内定義）。
