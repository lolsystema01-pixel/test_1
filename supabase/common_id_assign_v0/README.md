# 共通ID付与 v0.4（②住所判定＝area_master 直lookup）

取込②『common_id付与』を **area_master 直lookup**（town_key→common_id/zone_no）に簡素化し、**zone_no も deliveries に保存**（⑤配達順v0.3が使う）。**unit_no は保存しない**（ユニット廃止）。付与タイミングは不変（取込直後・配車前）。

## ファイル
| ファイル | 役割 |
| --- | --- |
| `common_id_assign_v0.sql` | deliveries に zone_no 列追加＋②付与（前方一致・最長一致）＋保留・dry-run/本実行 |
| `common_id_rematch_v0.sql` | マスタ更新後、保留行だけ再判定して付け直し（保留→未配車復帰） |
| `check_common_id_v0.sql` | 付与率・zone_no保存・unit_no不在・保留・付与分布 |

## 突合方式（現実解）
- deliveries は**生住所のみ**（構造化なし）→ 正規化住所を `area_master.town_key` へ **前方一致・最長一致**で突合＝単一表 area_master からの直lookup（ZonePlan二段は使わない＝v0.4簡素化）。
- **共通IDの正**は area_master 側（元は ZonePlan 由来）＝要件114の踏襲は共通ID値で担保。
- 未突合→`unregistered_addresses` 記録＋`status='保留'`（未配車/保留のみ対象）。

## 実行順（実機）
1. 前提：`normalize_v0.sql`・エリアマスタ取込 v0.1（`area_master`）・荷物取込済み
2. `common_id_assign_v0.sql`（A dry-run → B 本実行）
3. `check_common_id_v0.sql`
4. （マスタ更新時）`common_id_rematch_v0.sql`

## 注意
- 旧 `address_match_v0/match_v0.sql`（②の旧実装）を**置換**。①`normalize_v0`（正規化・unregistered_addresses）は前段として残す。
- 住所に都道府県が無いデータが多い場合は、town_key を自治体+町名側にも用意する調整が要る（要データ確認）。
- ③office_assign_v0・④配車・⑤採番本体は不変。

## 検証（Claude Code）
- pglite E2E（`../delivery_order_zone_v0/pglite_e2e_test.mjs`・**18/18 PASS**）：D1〜D4 に common_id/zone_no 付与、D5 未登録→保留、unit_no 列なし、未登録記録。
