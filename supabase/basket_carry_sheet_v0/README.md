# かご持出表PDF v0（ドライバー別・かご記号×担当個数）

指示書 `shijisho/shijisho_basket_carry_sheet_v0_1.docx` の成果物。要件定義 **6.9 帳票出力（かご持出表PDF）**。
自営業所×対象日を、**ドライバー別（1ドライバー＝1枚）** の持出表PDFに出力する。本体＝**かご記号・各かごの担当個数・合計**。フッター＝**積込開始時間・アルコールチェックの記入欄（手書き）**。

## 配車表PDF（dispatch_sheet）と同じ土台

- PDFは**クライアント側で html2canvas＋jsPDF**（DOMを画像化）＝**日本語フォント埋め込み不要**。1ドライバー＝1ページ（改ページ）。
- 出力先は**ダウンロード＋Supabase Storage**（バケット `carry-sheets`）。アップロードは**anonキー＋areaのJWT＋Storage RLS**で行う＝**service_role 不要**。
- ポップアップ非依存（同一タブの `/carry` ルート）。
- フロントは **T1営業所アプリ `apps/sort_nav_v0`**（仕分けナビ）に同居。配車表PDF `/sheet` の隣に `/carry` を追加。

## 成果物 / 実行順（SQL Editor）

| # | ファイル | 役割 |
|---|---------|------|
| 1 | `basket_carry_sheet_v0.sql` | 持出表データのビュー2本（明細＝ドライバー×かご記号×担当個数／サマリ＝かご数・合計）。**security_invoker=on** で area RLS継承 |
| 2 | `check_basket_carry_sheet_v0.sql` | ドライバー別件数・担当個数・合計・RLS自営業所のみ の確認 |
| 3 | `storage_setup_v0.sql` | `carry-sheets` バケット（private・PDFのみ・50MB）＋ insert/select ポリシー |

フロント：`apps/sort_nav_v0/src/routes/carry/`（`+page.server.ts` ＝ area RLSでビュー取得／`+page.svelte` ＝ 表示・PDF・Storage）。ホーム右上に「かご持出表PDF」導線。

## 前提

- **配車 v0.5 ＋ 採番一式 v0.5 を実機実行済み**（`deliveries` に `driver_id`・`basket_code`・`delivery_order`）。
- area ロールのT1営業所ログイン（`promote_test_area_v0.sql`／配車表PDF・仕分けナビと共通）。
- `storage_setup_v0.sql` を実行して `carry-sheets` バケットを用意（配車表PDFの `dispatch-sheets` と同じ導線）。

## 合格条件（→ `確認結果メモ.md`）

- 自営業所×対象日で、ドライバー別（1ドライバー＝1枚）のかご持出表PDFが出る。
- 各ドライバーの かご記号・担当個数・合計個数 が**採番結果と一致**。
- ヘッダ（日付・営業所・ドライバー）＋フッター（積込開始時間・アルコールチェックの記入欄）。
- area RLSで**自営業所のみ・他営業所は0件**。
- PDFがダウンロードでき、Supabase Storage に保存される。ポップアップ非依存。

## やらないこと（範囲外）

- 配車表PDF／GoDoor用CSV（別項目・別指示書）。配車・配達順・かご記号の計算（本書は deliveries を読むだけ）。
- 点呼・アルコールの実データ連携（8.8・T3）。本書はフッター記入欄まで。ラベル印刷（6.8）。書き込み系RLS（読み取りのみ）。

## 事前検証（このリポジトリで実施済み）

| 検証 | 結果 |
|---|---|
| `apps/sort_nav_v0` `npm run check` / `build` | 0 errors / 成功 |
| pglite：ビュー＋RLS（rls_v0 seed・2026-06-09） | **15/15 PASS** |

pglite で実証：明細 A01/DRV001=かごA×2・DRV002=かごA×1・C01/DRV003=かごM01×2／サマリ かご数・合計／`driver_name` 解決／**area A01 は A01 のみ・C01 範囲外0件**／area C01 同様／**担当個数＝deliveries 生集計と一致**。

> PDF生成・Storage保存はブラウザ＋Supabase実機での確認（配車表PDFと同方式）。`確認結果メモ.md` に記録。
