# CSV取込＋重複排除（問合番号）v0.2

> ⚠️ **荷主の取込は `supabase/shippers_master_v0/import_shipper_map_v0.sql` が置き換え版**。
> 本 `import_v0.sql §4` は `shipper_id` に**荷主名（HACHI EXPRESS）をそのまま**入れていた。
> 荷主マスタ v0.2 で「名称→shipper_idコード変換（未一致は保留）」に差し替え済み。
> 以後の取込は `shippers_master_v0/` を使うこと（重複排除のロジックは同一）。

指示書 `shijisho/shijisho_csv_import_v0_2.docx` の成果物。
荷主CSV → 配送データ（荷物）へ取込。**問合番号で重複排除**、取込直後は**未配車**、**取込バッチID**付与。
要件定義 6.1 荷物データ取込 / 9.1。

## 入力（【人】）

- `shipper_data_dummy.csv.xlsx`（プロジェクト直下）。18行・問合番号の重複2件（11217=11201, 11218=11208）→ ユニーク16件。
  - この内容は `import_v0.sql` 内に staging seed として取り込み済み（AIパス）。
  - 【人】が Supabase Table Editor でCSVインポートする場合は、import_v0.sql の §1・§2 をスキップして §3・§4 のみ使う。

## 成果物

| ファイル | 役割 |
|---------|------|
| `reset_prev_dummy_v0.sql` | 以前のダミー荷物を削除（取込前に1回） |
| `import_v0.sql` | ステージング定義＋seed＋重複排除取込＋件数集計 |
| `check_import_v0.sql` | 重複排除・2回取込・件数・ステータス・検索の確認 |
| `確認結果メモ.md` | 結果記録 |

## 実行順（SQL Editor）

1. （前提）DBスキーマ v0 作成済み（`dbschema_v0/`）
2. `reset_prev_dummy_v0.sql` … **以前のダミー荷物を削除**（deliveries / delivery_index を空に）
3. `import_v0.sql` … **1回目**：取込16件・CSV内重複2件除外
4. `import_v0.sql` … **2回目**（同じものをもう一度）：取込0件・既存重複16件スキップ
5. `check_import_v0.sql` … 確認

## 期待結果

| 指標 | 1回目 | 2回目 |
|------|------|------|
| csv_rows | 18 | 18 |
| unique_in_csv | 16 | 16 |
| inserted | **16** | **0** |
| csv_internal_dup_excluded | 2 | 2 |
| existing_dup_skipped | 0 | **16** |

- deliveries 総数 = **16**（2回目以降も16のまま）
- status = 全て **未配車** / import_batch_id 付与あり
- 問合番号・住所・氏名で検索できる

## メモ（設計の割り切り）

- 氏名検索のため deliveries に `recipient_name` 列を追加（氏名/住所にインデックス）。
- **全国配分（住所→共通ID・拠点・営業所）は範囲外**（6.2・別指示書）。取込直後は office_code 等 NULL・未判定でよい。
- 荷主は `shipper_id` に荷主名（HACHI EXPRESS）を格納（荷主マスタは未作成）。
- CSV内の「丁目あり/表記ゆれ/未登録想定」行も、今回は**問合番号の重複排除のみ**が対象（住所判定はしない）。
