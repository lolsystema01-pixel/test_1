# 配達順・かご記号 採番＋問合Index同期 v0.5

指示書 `shijisho/shijisho_seq_kago_index_v0_5.docx` の成果物。要件定義 **6.5（本実行の後段）／6.7（仕分けナビの前提）** に対応。
準拠: 現行GAS `25_delivery_order.js`（候補C）/ `26_basket_management.js`（営業所内通し番号方式）。

**範囲**: 配車確定後の荷物に 配達順→かご記号 を採番し、問合Indexへ同期＋当日一括取得の参照まで。
仕分けナビUI(6.7)・ルート最適化(8.4 ZENRIN)・ラベル/帳票(6.8/6.9)は範囲外。

## ファイル

| ファイル | 役割 |
|---|---|
| `renumber_v0.sql` | 採番エンジン。§0設定+関数 / 検証準備 / §A dry-run / §B 本実行（deliveries更新＋問合Index同期） |
| `index_today_v0.sql` | 当日対象の問合Index一括取得ビュー `index_today`（仕分けナビ起動時用・`security_invoker`でRLS適用） |
| `check_renumber_v0.sql` | 確認（配達順連番・かご繰上げ・Index一致・件数） |
| `確認結果メモ.md` | 結果記録 |

## 実行順（SQL Editor にコピペ）

1. （前提）`dispatch_v0`：seed → §A → §B まで実行済み（deliveries に driver_id・status=配車済）
2. `renumber_v0.sql` §0〜§A … dry-run（採番プレビュー・書き込まない）
3. `renumber_v0.sql` §B … 本実行（配達順・かご記号を書き込み＋問合Index同期）
4. `index_today_v0.sql` … 当日一括取得ビュー作成
5. `check_renumber_v0.sql` … 期待 vs 実 を突合

## ロジック（GAS準拠）

- **配達順**：ドライバー×当日で `ROW_NUMBER`。並び＝① 共通ID → ② 時間指定ランク(`time_window_rank`：9:00-12:00→900/午前→800/午後→1300/無→9999) → ③ 住所 → ④ 問合番号（タイブレーク＝冪等）。実/仮の両方。ルート最適化はしない（最適訪問順はT3 ZENRIN=8.4）。
- **かご記号**（営業所内通し番号方式）：
  1. 各ドライバーの担当を配達順で並べ、**1かご個数**（=`offices.basket_cart_limit`、既定50・範囲1〜500）ごとに区切る＝`basket_index = ceil(配達順/1かご個数)`。
  2. ドライバーを**かご振り順**（`offices.basket_order`：ドライバー順=件数多い順／配達順順=先頭配達順早い順／ゾーン順=先頭共通ID順。同点は名前順）で並べる。
  3. その順に、各ドライバーのかごへ**営業所内通し番号**を1ずつ加算→記号化（連続）。
  4. 記号形式は営業所設定（`basket_code_format` アルファベット既定/数字・`basket_code_prefix`・`basket_code_digits`）。例: A,B,…,Z,AA,…／M01,M02…。
- **問合Index同期**：問合番号→ドライバー・配達順・かご記号・共通ID を upsert（冪等）。**ここで `delivery_index` が埋まる**。
- **当日一括取得**：`index_today` ビュー（`delivery_index`×`deliveries` を `delivery_date=current_date` で絞る）。仕分けナビ起動時に一括取得する想定。
- **二段階**：dry-run（`renumber_plan` 作業表に計算のみ）→ 本実行（deliveries更新＋Index同期）。まとめ単位はかご記号に一本化（バッグ番号・親バッグなし）。

## 検証データの期待値（current_date／dispatch v0出力の上で）

| 営業所 | ドライバー(件数) | かご | 記号形式 |
|---|---|---|---|
| A01 | DRV001(160)・仮2(150)・仮3(142)・仮1(140)・DRV002(108) ※件数多い順 | 計**71**かご（1かご個数=10） | アルファベット A…BS |
| C01 | DRV003(100) | 計**10**かご | 数字 **M01…M10** |

- 配達順は各ドライバー 1..件数 の連番。問合Index 800行が deliveries と一致。`index_today`=800。

## 設計メモ

- **当日スコープ**：`delivery_date=current_date` のみ（dispatchと同じ。別日の在庫は対象外）。
- `offices` にかご記号形式の設定列を追加（§0、`add column if not exists`）。検証準備で C01 を数字形式(M/2桁)に設定し両形式を実証。
- 検証準備で当日DSPダミーに時間指定を散らし、②時間ランクを発火させている（ダミーのみ更新）。
- `index_today` は `security_invoker=on`。営業所は自営業所・ドライバーは自担当のみ取得（rls_v0のポリシーが効く）。

## 検証状況

- **pglite で実行検証済み**（schema→profiles→dispatch→renumber→index→check 全通し）。配達順連番OK・かご通し番号 A01=1..71/C01=1..10 連続OK・記号 A…BS / M01…M10・問合Index不一致0・当日ビュー800。Supabase実機の最終確認は `確認結果メモ.md` へ。
