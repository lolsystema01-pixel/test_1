# GoDoor用CSV出力 v0.2（T1継続・GoDoor Ver4.0 様式）

指示書 `shijisho/shijisho_godoor_csv_v0_2.docx` の成果物。要件定義 **6.9 帳票出力（GoDoor用CSV）／第10章**。
自営業所×対象日の **仕分済** の荷物を、**GoDoor Ver4.0 様式（21列・UTF-8 BOM）** で出力する。**全体ファイル＋ドライバー別ファイル**を1回で生成。
様式・整形・並び・フィルタは現行GAS **27_godoor_csv_export.js** 準拠。

## 配車表PDF / かご持出表PDF と同じ土台

- フロントは **T1営業所アプリ `apps/sort_nav_v0`**（仕分けナビ）に同居。`/godoor` ルート。ホーム右上に「GoDoor CSV」導線。
- 抽出は **security_invoker ビュー**（area RLSで自営業所のみ）。**service_role 不要**。
- 出力は **クライアント側**（純文字列＋BOM）＝CSV組み立て。**ダウンロード＋Supabase Storage**（バケット `godoor-csv`・anon＋areaのJWT＋Storage RLS・日付サブフォルダ）。

## 成果物 / 実行順（SQL Editor）

| # | ファイル | 役割 |
|---|---------|------|
| 1 | `godoor_csv_v0.sql` | 抽出ビュー（自営業所×対象日×**仕分済**×有効ドライバー、driver_name解決）。security_invoker=on |
| 2 | `storage_setup_v0.sql` | `godoor-csv` バケット（private・CSV・50MB）＋ insert/select ポリシー |
| 3 | `check_godoor_csv_v0.sql` | 仕分済のみ・無効ドライバー除外・件数・RLS自営業所のみ の確認 |
| — | （再利用）`../dispatch_sheet_v0/seed_sort_status_v0.sql` | 検証用に一部を `status='仕分済'` に（対象日＝current_date の A01/DRV001） |

フロント：`apps/sort_nav_v0/src/routes/godoor/`（`+page.server.ts` ＝ ビュー取得／`+page.svelte` ＝ 生成・DL・Storage）。
整形ロジック：`apps/sort_nav_v0/src/lib/godoor.ts`（21列マッピング・サニタイズ・並び・CRLF。**純関数＝単体テスト済み**）。

## GoDoor Ver4.0 21列マッピング（GAS27準拠）

| # | 列 | 値 |
|---|---|---|
| 1 | 担当ドライバー | `driver_name`（無ければ driver_id＝仮ドライバー等） |
| 2 | 住所 | `address` |
| 3-5 | 部屋番号/テナント名/階層 | 空 |
| 6 | 伝票番号 | `tracking_number` |
| 7 | 届け先名１ | 氏名＋「 様」（既に様なら付けない／空なら「様」のみ） |
| 8 | 届け先名２ | `basket_code` ＋ `delivery_order`（区切り無し連結。例 西-5+1→西-51） |
| 9 | 電話番号 | 空（deliveriesに電話列なし） |
| 10 | 配達状況 | 「配達」（固定） |
| 11 | 時間指定 | `time_window`（空なら「指定なし」） |
| 12 | 荷物メモ | 空 |
| 13-20 | 梱包/種類/色/サイズ/個口数/代金徴収/置き配/宅配BOX | ダンボール/指定なし/茶/中/1/なし/不可/不可（固定） |
| 21 | Ver4.0 | データ行は空・**ヘッダ最終列のみ "Ver4.0"** |

- 全フィールド**ダブルクオート囲み**、データ内**カンマ（半角/全角）・改行→スペース**、`"`→`""`、行末 **CRLF**、文字コード **UTF-8 BOM**。
- 並び：全体＝**担当ドライバー名 昇順 → 配達順 昇順**（配達順は数値・空は末尾／Unicodeコードポイント順）。ドライバー別＝配達順昇順。
- 1ファイル**10000件超**で WARNING（全体・各ドライバー別とも）。

## 合格条件（→ `確認結果メモ.md`）

- ヘッダ行＋21列・UTF-8 BOM・CRLF・各フィールドダブルクオート囲み。
- **仕分済**かつドライバー有効のみ（未仕分・未割当は出ない）。
- 全体＝ドライバー名昇順→配達順昇順／ドライバー別（×人数）も同時生成。
- 届け先名２＝かご記号＋配達順、届け先名１＝氏名＋様、伝票番号＝問合番号、固定列がGAS既定値。
- データ内カンマ・改行がスペース置換。10000件超で WARNING。
- area RLSで自営業所のみ。Supabase Storage（日付サブフォルダ）に保存＋ダウンロード。

## やらないこと（範囲外）

- 配車表PDF・かご持出表PDF／問合Index全件CSV（Shift_JIS・別物）。ルート最適化（GoDoor/ZENRIN側）。
- 仕分済 status の書き込み（仕分けナビ＋書き込みRLS）。本書は status を読むのみ（検証は seed）。
- バッグ番号（Ver4.0行では未使用＝廃止）。本番データ・現行GAS。

## 事前検証（このリポジトリで実施済み）

| 検証 | 結果 |
|---|---|
| `godoor.ts` 単体（21列・サニタイズ・届け先名・並び・CRLF・BOM想定） | **28/28 PASS** |
| pglite：ビュー＋RLS（rls_v0 seed・一部仕分済） | **9/9 PASS** |
| `apps/sort_nav_v0` `npm run check` / `build` | 0 errors / 成功 |

pglite で実証：**仕分済のみ**（非仕分済混入0）／**未割当除外**／driver_name解決／**area A01はA01のみ・C01範囲外0件**／C01は仕分済なしで0件。

> CSVダウンロード・Storage保存・実際の21列ファイルはブラウザ＋Supabase実機で確認（可能なら現行GAS出力と1行突合）。`確認結果メモ.md` に記録。
