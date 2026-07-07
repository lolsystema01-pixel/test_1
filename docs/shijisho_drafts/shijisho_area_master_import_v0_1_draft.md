# 指示書（ドラフト）：エリアマスタ取込（集約master・ゾーン番号/共通IDのみ）v0.1

対象：現行エリアマスタ「集約master」を検証Supabaseに取込む。**親バッグ・バッグ番号・ユニット番号は廃止**（かご記号一本化＝採番v0.5方針／配達順v0.3でユニット廃止）。②共通ID付与 v0.3 と ⑤配達順 v0.3（zone_no順）の**前提データ**を整える。
起票：業務A　／　承認：LOL　／　状態：☐ 承認待ち　☐ 承認済み　☐ 実行済み
※本書は「取込」まで。付与ロジック（②）・配達順（⑤）は別書。

## A. 固定の前提（毎回これを先頭に貼る）
- 新基盤（Supabase ＋ SvelteKit ＋ Cloud Run）。移行ではなく新規構築。
- 検証環境のみ。AI生成のダミーデータを使う。本番データ・現行GASには触らない。
- 全テーブルでRLSを有効にする。秘密情報は環境変数に置く。
- 画面・操作・用語は現行マニュアルv9に合わせる（用語集v0.1）。

## 【廃止の根拠（要件・既存方針）】
- **バッグ番号・親バッグ**：まとめ単位は**かご記号に一本化**（採番一式v0.5の既定＝バッグ番号・親バッグは使わない）。
- **ユニット番号**：配達順修正 **v0.3** で「ユニット番号を廃止し③はゾーン番号のみ」。
- ＝運用で効かせるのは **ゾーン番号（zone_no）＋共通ID** だけ。他のまとめ番号は取込まない（列ごと落とす）。

## B. この指示書の中身（取込のみ）

### タイトル
- エリアマスタ「集約master」を、②が参照する**最小列**（町キー＋ゾーン番号＋共通ID＋有効/優先度）で `area_master` に取込む。**親バッグ名・バッグ番号・ユニット番号は列ごと廃止**。決定的・冪等・dry-run→本実行。

### 対象機能（要件定義の章番号）
- 第4章 全国配分（Master整備）。②『住所判定[common_id付与]』の**参照元**。
- 参照：エリアマスタ「集約master」（都道府県/自治体/町名/丁目/エリア/ゾーン/**共通ID**/有効/優先度）。
- 後段：② 共通ID付与 v0.3（TownKey→common_id/zone_no）／⑤ 配達順 v0.3（zone_no順）／③ office_assign_v0（common_id→office）。

### 取込する列 / 落とす列
**残す（取込む）**

| 列 | 用途 |
| --- | --- |
| 都道府県・自治体・町名・丁目 | ②の突合キー（TownKey生成） |
| ゾーン番号（zone_no） | ⑤配達順の並び★ |
| 共通ID | ②の付与結果★ |
| 有効 | 最新有効行のみ採用★ |
| 優先度 | 同一キー複数時の選択 |
| エリア | （②をGAS20二段突合にする場合のみ）※直lookupなら不要 |
| 郵便番号・拠点 | 任意（参考・将来） |

**落とす（廃止・取込まない）**：**親バッグ名 / バッグ番号 / ユニット番号**

### やること（具体的に）
凡例：【人】＝手作業／【AI】＝Claude Codeで生成・実行（SQL）。

- 【人】 集約masterシート → **CSV(UTF-8)** 化。**上表の残す列だけ**に絞る（親バッグ/バッグ番号/ユニット番号を除外）。丁目空はそのまま。ヘッダ1行。
- 【AI】 `area_master`（本表）＋ `area_master_staging`（取込バッファ）を作成。RLSは**hq参照のみ**（マスタ＝バックエンド参照。zone_plan と同格）。
  - 列：`prefecture, municipality, town, chome, town_key, zone_no int, common_id, is_valid bool, priority int, (area text 任意)`。
- 【人 or AI】 CSV → `area_master_staging` に一括ロード（**Supabase Dashboard の CSVインポート**推奨：84k行はSQL Editorへのコピペ不可）。
- 【AI】 staging → 本表へ整形・確定（dry-run→本実行・冪等）：
  - `town_key = normalize_addr(都道府県|自治体|町名|丁目)`（①正規化と同じ関数で整合）。
  - `zone_no` は**数字のみ抽出→int**（例 '1.0'→1）。
  - **有効のみ**採用。同一 `town_key` 複数は**優先度**（無ければ最終行）で1行に確定。
  - 本表へ upsert（`town_key` 一意）。
- 【AI】 索引：`area_master(town_key)`・`area_master(common_id)`。
- 【AI/人】 検証（下記check）→ 業務Bへ記録。

### やらないこと（範囲外）
- **親バッグ・バッグ番号・ユニット番号の取込**（列ごと廃止）。
- ②付与ロジック本体（common_id付与 v0.3）・⑤配達順（配達順 v0.3）・③振分・④配車。
- **ZonePlan（`zone_plan`）の split_threshold/adjacent_zones**（配車用。既存のまま・別役割）。
- Master/ZonePlan の内容編集・本番データ・現行GAS。
- `deliveries` へのゾーン保存（＝common_id付与 v0.3 が `zone_no` を保存。本書はマスタ取込まで）。

### 合格条件（動作確認の観点）
- `area_master` に集約master（**有効のみ**）が取込まれ、**`town_key → (common_id, zone_no)` が一意に引ける**。
- **親バッグ名・バッグ番号・ユニット番号の列が無い**（廃止済み）。
- `zone_no` は整数。**欠損（zone_no/common_id 空）率が把握**できる（保留予備軍）。
- 決定的・冪等（再取込で件数安定）。dry-run→本実行。
- サンプル一致：岡崎市の例で 箱柳町→(common_id OKZ_C_01_06, zone_no 1) 等が引ける。
- 用語が用語集v0.1どおり（共通ID＝common_id・ゾーン番号＝zone_no・有効）。

### 成果物（ファイル等）
- 【AI】 `area_master_schema_v0.sql`（`area_master`＋`area_master_staging`＋index＋RLS〔hq参照〕）※コピペ実行。
- 【AI】 `area_master_load_v0.sql`（staging→正規化→有効/優先度で確定→upsert・dry-run/本実行）※コピペ実行。
- 【AI】 `check_area_master_v0.sql`（件数・`town_key`一意性・zone_no欠損率・サンプル一致・列廃止確認）※コピペ実行。
- 【人】 集約master → **CSV(UTF-8・列を絞る)**、Dashboardでstagingにインポート。
- 確認結果メモ（取込件数・一意性・欠損率・サンプル一致）。

## 前提・要確認
- 【要確認】**取込方法**：84k行は SQL Editor へコピペ不可 → **Supabase Dashboard の CSVインポート**で staging に入れ、変換SQLは Editor で流す想定（手段の最終確認）。
- 【要確認】**②の方式**：`area_master` が **共通IDを畳んで持つ**ため、②は「`town_key`→(common_id, zone_no) の**直lookup**」で足りる。GAS20の二段突合（Master突合→ZonePlan突合で zone∈[from,to]）を厳密踏襲するかは **common_id付与 v0.3 側で決定**（本書は取込のみ）。直lookupなら `area` 列は不要。
- 【要確認】`zone_no` の一意性は「拠点＋ゾーン」。突合は `town_key` 単位なので実用上OK。必要なら `拠点`列も保持。
- 【依存の微修正（別書）】**common_id付与 v0.3 は `unit_no` の保存を削除**し、`zone_no`＋`common_id` のみ保存に（ユニット廃止に合わせる）。配達順 v0.3 は変更不要（元から zone_no のみ）。
- 【正規化整合】`town_key` の作り方は ①住所正規化（`normalize_addr`）と**同一関数**で揃える（突合ズレ防止）。丁目の範囲/単一/空の扱いを②と一致させる。

---
（本書はドラフト・未実行。承認後に上記3 SQL＋確認メモを作成する。実行順：**本書(取込) → common_id付与 v0.3 → 配達順 v0.3**。）
