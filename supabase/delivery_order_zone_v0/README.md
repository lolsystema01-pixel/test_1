# 配達順の修正 v0.3（住所 → ゾーン番号 zone_no）

採番一式 v0.5 の `renumber_build` の**配達順ソートキーだけ**を差し替え。③『住所自然順』→ **ゾーン番号(zone_no)**。ユニット番号は使わない。採番本体（連番・かご記号・冪等・dry-run/本実行）は v0.5 のまま。

## 並び順（変更後）
```
① common_id 自然順
② 時間指定（時刻ランク）
③ zone_no 昇順（NULL=保留は末尾）   ← 旧『住所自然順』を置換
④ 住所（同一ゾーン内の最終tiebreak）
⑤ 問合番号
```
＝GAS25 の①②③④のうち③住所を zone_no に置換（意図的にGAS25を超える改善・LOL承認済み方針）。

## ファイル
| ファイル | 役割 |
| --- | --- |
| `delivery_order_zone_sort_v0.sql` | `renumber_build` を再定義（base CTE の ORDER BY に zone_no）。関数定義のみ |
| `check_delivery_order_zone_v0.sql` | ゾーン順・逆行0・保留末尾・冪等の確認 |
| `pglite_e2e_test.mjs` | 取込→付与→配達順の通し検証（18/18 PASS） |

## 実行順（実機）
1. 前提：採番一式 v0.5（§0オブジェクト・offices拡張）＋ 共通ID付与 v0.4（deliveries.zone_no 保存済み）
2. `delivery_order_zone_sort_v0.sql`（renumber_build 再定義）
3. 実行は**採番一式 v0.5 の §A/§B**（dry-run→本実行）をそのまま使う
4. `check_delivery_order_zone_v0.sql`（対象日を実データ日に）

## 検証（Claude Code）— pglite E2E 18/18 PASS
- 同一 common_id 内で zone_no 昇順に配達順が付く（**住所順なら先頭になる小美町(D3)が zone優先で3番目**＝zone_noが住所より優先）。
- 別 common_id は自然順で後続。zone_no欠損は末尾（nulls last）。再実行で件数安定（冪等）。
