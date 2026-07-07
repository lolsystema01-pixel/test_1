# 配車表PDF（仕分前／仕分後）v0

指示書 `shijisho/shijisho_dispatch_sheet_v0_2.docx` の成果物。要件定義 **6.9 帳票出力**（配車表PDF：日付×ドライバー／仕分済・未仕分／仕分前・仕分後）に対応。

**範囲**: 配車・採番済みの荷物を、ドライバー別×配達順の配車表PDFに出力（読み取りのみ）。
GoDoor用CSV／かご持出表／ラベル印刷は範囲外（別指示書）。

## ファイル

| ファイル | 役割 |
|---|---|
| `dispatch_sheet_v0.sql` | 配車表データのビュー `dispatch_sheet`（明細：ドライバー×配達順）＋ `dispatch_sheet_summary`（ドライバー別 総数/仕分済/未仕分）。area RLS・`security_invoker` |
| `seed_sort_status_v0.sql` | 検証用：一部を `status=仕分済` に立てる（§1）＋配車済みへ戻す（§3クリーンアップ）。冪等 |
| `check_dispatch_sheet_v0.sql` | 件数・仕分済/未仕分・配達順の並び・総量整合の確認 |
| `storage_setup_v0.sql` | Supabase Storage バケット `dispatch-sheets`（private）＋ポリシー |
| 出力画面（フロント） | `apps/sort_nav_v0/src/routes/sheet/`（T1営業所＝仕分けナビと共通の土台） |

## 実行順

1. （前提）配車 v0.5 → 採番一式 v0.5 を実機実行（deliveries に配達順・かご記号・ステータス）
2. `dispatch_sheet_v0.sql` … ビュー作成
3. `storage_setup_v0.sql` … Storageバケット＋ポリシー
4. フロント：`apps/sort_nav_v0` を起動（area ログイン）→ ホーム右上「配車表PDF」→ `/sheet`
   - 対象日・**仕分前／仕分後**を選び、**PDF保存**（ダウンロード＋Storage `dispatch-sheets/<office>/<date>/<mode>.pdf`）
5. `seed_sort_status_v0.sql` §1 … 一部を仕分済に → 仕分後モードで件数を実証 → §3で戻す
6. `check_dispatch_sheet_v0.sql` … 確認

## モードと出力

- **仕分前(pre)**：配車直後の予定一覧（総数のみ）。
- **仕分後(post)**：仕分済を反映し、ドライバー別ヘッダに **総数／仕分済／未仕分**、明細に「仕分」列（済/—）。
- 両モードとも並びは**配達順**。ドライバーごとに1セクション＝PDFは**1ドライバー1ページ**（改ページ）。

## PDF生成の方式（日本語対応）

- **html2canvas＋jsPDF**：ドライバーセクションのDOMを画像化して1ページずつPDF化。
  - 日本語フォントの埋め込み不要（ブラウザ描画を画像として取り込むため文字化けしない）。
  - ダウンロード（`配車表_<office>_<date>_<mode>.pdf`）＋ Supabase Storage `dispatch-sheets` へアップロード。
  - 画像ベースPDF（テキスト選択不可）だが v0 の帳票用途には十分。テキストPDF化はCJKフォント資産が要るため後続検討。

## 設計メモ

- `dispatch_sheet` / `dispatch_sheet_summary` は `security_invoker=on`＝**area が自営業所のみ**（他営業所は0件）。対象日は フロントが `delivery_date` で絞る。
- 仕分後の検証は**検証seed（postgres＝RLSバイパス）で一部を仕分済**にして行う。実運用の仕分済反映（スキャン→保存）は **仕分けナビ＋書き込みRLS整備**後（本書は status を読むのみ）。
- `recipient_name` 列は csv_import_v0 由来。未ロードでも動くよう §0 で `add column if not exists`。

## 検証状況

- SQL（ビュー・seed・集計）は **pglite で実行検証済み**：仕分前=全 sorted:0 ／ seed後=DRV001 sorted:30・unsorted:130 ／ 総量 summary=sheet=800一致。
- フロント `/sheet`：svelte-check 0エラー・build成功・ガード（未ログイン→/login）確認。実機のPDF描画・Storage保存は `確認結果メモ.md` に記録。
