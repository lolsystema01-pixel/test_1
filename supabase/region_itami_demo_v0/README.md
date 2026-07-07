# 地域セット（伊丹営業所デモ）v0 — 実データで①〜⑤を通す

兵庫/大阪の実依頼リスト（2026-06-29バッチ）を、**1営業所（伊丹営業所IT01）**で ④配車・⑤採番(zone配達順) まで流すための最小セット（A案）。

## 全体の流れ（このバッチ＝delivery_date 2026-06-29）
```
①取込(csv_import)  →  ②共通ID付与(common_id_assign・zone_no保存)  →  ③振分(A案=本セットで全件IT01へ直割当)
  →  ④配車(dispatch_build・記録口で配車済)  →  ⑤採番(renumber zone版・配達順=…→zone_no→…)
```

## ファイル（コピペ実行・順番）
| ファイル | 役割 |
| --- | --- |
| `region_setup_v0.sql` | 拠点D_ITM＋営業所IT01＋ドライバー8名＋稼働(2026-06-29承認)＋当バッチを IT01 に割当 |
| `run_flow_v0.sql` | ④配車（dry-run→本実行・記録口）→ ⑤採番(zone)→ deliveries反映＋問合Index同期 |
| `check_region_v0.sql` | 全体サマリ・zone配達順・逆行0・記録口ログ・ドライバー別件数 |

## 前提（適用済みであること）
- 取込＋②付与済み（deliveries に common_id/zone_no・delivery_date=2026-06-29）
- `dispatch_v0`（dispatch_build・shift_hours）／`status_log_v0`＋`record_status_transition_v0`（記録口）／`delivery_order_zone_sort_v0`（renumber zone版）／`seq_kago_index_v0`（§0・delivery_index）

## A案の割り切り
- **③office_assign は使わず**、当バッチ全件を **IT01 に直割当**（`region_setup_v0.sql` の 4)）。
- 配車の**同一市隣接積み増しは効かない**（兵庫の市データが address_master に無いため）＝各ドライバーは主ゾーンのみ＋残りは仮ドライバー。デモとしては有効。
- zone_plan 未登録の common_id は**分割閾値170（既定）**で動く。

## 実行後の見どころ（check_region_v0.sql）
- ①：total≒2,538・dispatched>0・numbered>0・held=保留（住所不備）
- ②：`driver_id×common_id` 内で **delivery_order が zone_no 昇順**（③で逆行0）
- ④：記録口ログに `配車済/source=配車`

## 検証について
本セットは新規ロジックを持たず、**検証済みの関数を 2026-06-29 で呼ぶ orchestration＋データ投入**：
- ②共通ID付与／renumber(zone) … pglite E2E 20/20
- 記録口(record_status_transition) … pglite 23/23
- dispatch_build … 実機8,800件0.88秒
- region_setup は INSERT/UPDATE のデータ投入のみ

## 後で B案（自治体単位）へ
`region_setup_v0.sql` の 4) を「自治体→営業所」の対応に置換し、営業所・ドライバーを自治体別に増やせば拡張可能。
