# 確認結果メモ（配達順ゾーン化 一式：取込→付与→配達順）

- 実施日: 2026 / 07 / __
- 実施者: （業務A／SQL Editor＋Dashboard CSVインポート）
- 事前検証: Claude Code（pglite E2E 18/18）
- 実行順: ① エリアマスタ取込 v0.1 → ② 共通ID付与 v0.4 → ③ 配達順修正 v0.3

## セットアップ / 実行順
1. [✓] （前提）`normalize_v0.sql`・採番一式 v0.5・配車 v0.5 実機済み
2. [✓] `area_master_v0/area_master_schema_v0.sql`
3. [✓] 集約master → **CSV(UTF-8・残す列だけ)** を Dashboard で `area_master_staging` にインポート
4. [✓] `area_master_v0/area_master_load_v0.sql`（A dry-run → B 本実行）→ `check_area_master_v0.sql`
5. [✓] `common_id_assign_v0/common_id_assign_v0.sql`（A → B）→ `check_common_id_v0.sql`
6. [ ✓] `delivery_order_zone_v0/delivery_order_zone_sort_v0.sql` → 採番一式v0.5の§A/§Bで採番 → `check_delivery_order_zone_v0.sql`

## 合格条件チェック

### ① エリアマスタ取込 v0.1
| 観点 | 期待 | 実際 | 判定 |
| --- | --- | --- | --- |
| 有効のみ取込・town_key一意 | 重複0・common_id空除外 |  | ☐ |
| 廃止列なし | 親バッグ/バッグ番号/ユニット番号 が無い |  | ☐ |
| zone_no 整数・欠損把握 | '1.0'→1・非数値NULL |  | ☐ |
| サンプル | 箱柳町（その他）→ OKZ_C_01_06 / zone 1 |  | ☐ |

### ② 共通ID付与 v0.4
| 観点 | 期待 | 実際 | 判定 |
| --- | --- | --- | --- |
| common_id/zone_no 付与 | 直lookup・with_common_id≒with_zone_no |  | ☐ |
| unit_no 保存なし | deliveries に unit_no 列が無い |  | ☐ |
| 保留 | 未突合は status='保留'＋未登録記録 |  | ☐ |
| 再マッチ | マスタ追加→保留が付き復帰 |  | ☐ |
| 現行GAS一致 | common_id→③office→④配車集計がGAS一致 |  | ☐ |

### ③ 配達順修正 v0.3
| 観点 | 期待 | 実際 | 判定 |
| --- | --- | --- | --- |
| ソート順 | ①common_id ②時間 ③zone_no ④住所 ⑤問合番号 |  | ☐ |
| ゾーン順 | 同一common_id内でzone_no昇順（逆行0） |  | ☐ |
| 保留末尾 | zone_no欠損は末尾 |  | ☐ |
| 冪等 | 再実行でplan件数安定・採番本体v0.5維持 |  | ☐ |

## 事前検証（Claude Code）— pglite E2E 18/18 PASS
- **A**：有効のみ5件（無効除外）・★優先度小(3)勝ち・zone_no '1.0'→1・非数値NULL・廃止列なし
- **B**：D1〜D4 に common_id/zone_no 付与・★D5未登録→保留・unit_no列なし・未登録記録
- **C**：zone_no昇順で配達順（★住所順なら先頭のD3がzone優先で3番目＝zone_noが住所より優先）・冪等

## 備考・気づき
- ②は area_master 直lookup（前方一致・最長一致）。deliveries は生住所のみのため完全一致でなく前方一致で突合。丁目粒度は本データでは町名どまり。
- **共通IDの正は area_master**（ZonePlan由来）。ZonePlan（配車の split_threshold/adjacent_zones）は別役割で不変。
- 旧 `address_match_v0/match_v0.sql`（②旧実装）は本v0.4で置換。①normalize_v0 は前段として残す。
- 【要データ確認】住所に都道府県が無い行が多い場合、town_key を自治体+町名側にも用意する調整が要る。
- 【要確認】取込の「勝ちルール」＝優先度の小さい方（実マスタの意図と一致するか確認）。
