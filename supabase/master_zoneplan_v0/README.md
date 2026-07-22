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

## ⚠ 全国Master（address_master）は撤去済み（2026-07-17・語彙是正⑤）

本モジュールのうち **Master 側は retire 済み**で、**ZonePlan 側のみ現役**です。後継は **`area_master`**（`area_master_v0/`）。
各SQLの Master 該当部は無効化済みなので、**フレッシュ環境でもそのまま実行できます**（ZonePlan だけが入る）。
経緯: `supabase/vocab_fix_v0/README.md`

## 成果物 / 実行順（SQL Editor）

1. （前提）DBスキーマ v0 作成済み（zone_plan の骨格。address_master は作られない）
2. `create_master_v0.sql` … ZonePlanをv0.4仕様へ＋ステージング作成（①Master部は retire）
3. `reset_prev_master_v0.sql` … **以前の zone_plan ダミーを削除**
   ⚠ zone_plan には②で**新語彙1,653件**が入っている。フレッシュ環境の初回構築以外では実行しないこと。
4. `load_master_v0.sql` … **1回目**（zone_plan 8 投入。§3/§6 の Master 部は retire）
5. `load_master_v0.sql` … **2回目**（全件スキップ＝0）
6. `check_master_v0.sql` … 確認（①②③⑤⑥⑦ の Master 参照は retire・zone_plan 側は現役）

**住所→共通IDのマスタが必要な場合は `area_master_v0/` を使う**（本モジュールではない）。

## 期待結果

| テーブル | csv_rows | unique | inserted(1回目/2回目) | skipped(1回目/2回目) |
|---------|---------|--------|----------------------|----------------------|
| zone_plan | 8 | 8 | 8 / 0 | 0 / 8 |
| ~~address_master~~ | — | — | — | 撤去済み（⑤）＝§7に出ない |

- 隣接は共通IDで格納（zone_plan に自己結合で全件解決）。
- ~~共通IDで Master×ZonePlan が結合でき…~~ → 後継は `area_master` × `zone_plan`（④の関数移行で移行済み）。

## 設計メモ（割り切り）

- **隣接の変換**：CSVの隣接はグループ名（岡崎-東 等）なので、読込時に「グループ名→共通ID」へ変換して格納。スライス外の隣接（大府・半田・豊田-東/山）は対応が無く除外（残った隣接は全て実在の共通ID）。
- **ゾーン番号**：CSVのゾーンFromを単一ゾーン番号として採用（From–To範囲は配車側の実装詳細＝別指示書）。
- **版管理フック**：version / is_valid 列を持たせるのみ。改訂案→承認→適用フローは別指示書。
- 住所マッチ判定（自治体＋町名＋丁目→共通ID、丁目フォールバック＝6.2）・整合性検査（6.3）・RLS設定は範囲外（別指示書）。
