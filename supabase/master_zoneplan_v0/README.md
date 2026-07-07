# 全国Master／ZonePlan テーブル化・読込 v0.4

指示書 `shijisho/shijisho_master_zoneplan_v0_4.docx` の成果物。
2マスタをDB内に1セットで持ち、サンプルを読み込む。要件定義 4.3 / 9.2 / 9.3。

## 対象テーブル（schema_v0 を ALTER で拡張）

| 概念 | テーブル | 主キー | v0.4の列 |
|------|---------|--------|---------|
| 全国Master | `address_master` | town_key（TownKey） | 都道府県・自治体・町名・**丁目(属性・通常空)**・共通ID・拠点・version・is_valid |
| 全国ZonePlan | `zone_plan` | common_id（共通ID） | 共通ID・**ゾーン番号(zone_no)**・拠点・**隣接(共通ID)**・version・is_valid |

- DROPせず ALTER で拡張（rls_v0 のRLS/GRANTを保持）。
- ZonePlanの旧列（グループ名・From/To・分割閾値・優先度・エリア）は持たない（配車設計時へ）。

## 入力（【人】）

- `zenkoku_master_dummy.csv`（14行）/ `zenkoku_zoneplan_dummy.csv`（8行）。
  - 内容は `load_master_v0.sql` に seed として取り込み済み（AIパス）。

## 成果物 / 実行順（SQL Editor）

1. （前提）DBスキーマ v0 作成済み（address_master/zone_plan の骨格）
2. `create_master_v0.sql` … テーブルをv0.4仕様へ＋ステージング作成
3. `reset_prev_master_v0.sql` … **以前のマスタ・ダミーを削除**
4. `load_master_v0.sql` … **1回目**（zone_plan 8 / address_master 14 投入）
5. `load_master_v0.sql` … **2回目**（全件スキップ＝0）
6. `check_master_v0.sql` … 確認

## 期待結果

| テーブル | csv_rows | unique | inserted(1回目/2回目) | skipped(1回目/2回目) |
|---------|---------|--------|----------------------|----------------------|
| zone_plan | 8 | 8 | 8 / 0 | 0 / 8 |
| address_master | 14 | 14 | 14 / 0 | 0 / 14 |

- 共通IDで Master×ZonePlan が結合でき、共通ID→ゾーン番号・隣接、Master→拠点 が引ける。
- 隣接は共通IDで格納（zone_plan に自己結合で全件解決）。
- 丁目は通常空（NULL）。version / is_valid 列あり。

## 設計メモ（割り切り）

- **隣接の変換**：CSVの隣接はグループ名（岡崎-東 等）なので、読込時に「グループ名→共通ID」へ変換して格納。スライス外の隣接（大府・半田・豊田-東/山）は対応が無く除外（残った隣接は全て実在の共通ID）。
- **ゾーン番号**：CSVのゾーンFromを単一ゾーン番号として採用（From–To範囲は配車側の実装詳細＝別指示書）。
- **版管理フック**：version / is_valid 列を持たせるのみ。改訂案→承認→適用フローは別指示書。
- 住所マッチ判定（自治体＋町名＋丁目→共通ID、丁目フォールバック＝6.2）・整合性検査（6.3）・RLS設定は範囲外（別指示書）。
