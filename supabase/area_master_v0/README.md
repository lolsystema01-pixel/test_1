# エリアマスタ取込 v0.1

集約master を**最小列**（町キー＋ゾーン番号＋共通ID＋有効＋優先度）で `area_master` に取込む。
**親バッグ名・バッグ番号・ユニット番号は廃止**（かご記号一本化・配達順v0.3のユニット廃止）。②共通ID付与v0.4／⑤配達順v0.3 の前提データ。

## ファイル
| ファイル | 役割 |
| --- | --- |
| `area_master_schema_v0.sql` | `area_master`（town_key PK＋zone_no int＋common_id…）＋ `area_master_staging`＋index＋RLS(hq参照) |
| `area_master_load_v0.sql` | staging→本表（town_key正規化・zone_no整数化・有効のみ・優先度で1件確定・upsert・dry-run/本実行） |
| `check_area_master_v0.sql` | 件数・一意性・zone_no欠損率・サンプル一致・廃止列確認 |

## 実行順（実機）
1. `area_master_schema_v0.sql`（前提：`normalize_v0.sql` の `normalize_addr`）
2. **集約master → CSV(UTF-8・残す列だけ)** を Supabase Dashboard の CSVインポートで `area_master_staging` へ（84k行はSQLコピペ不可）
3. `area_master_load_v0.sql`（A dry-run → B 本実行）
4. `check_area_master_v0.sql`

## 設計
- `town_key = normalize_addr(都道府県+自治体+町名)`（①と同一関数）＝②が前方一致・最長一致で直lookupするキー。**町名の「（…）」（例「箱柳町（その他）」）は除去**してから作る＝実住所「箱柳町12-3」に前方一致する。
- 保持列：`depot`（拠点＝zone_noのスコープ）・`area`（エリア・将来の二段突合/階層）・`source_town_key`（元TownKey・追跡）・`postal_code`（郵便番号・将来の郵便番号突合用）。いずれも現②では未使用だが保持。
- 廃止列：親バッグ名・バッグ番号・ユニット番号（かご記号一本化・配達順v0.3）。
- **勝ちルール（要確認）**：同一 town_key 複数は**優先度の小さい方**を採用（同値/無しは物理順）。
- RLS は hq 参照のみ（zone_plan と同格）。書込みは取込SQL（postgres）。
- ZonePlan（`zone_plan` の split_threshold/adjacent_zones）は配車用で別役割・不変。

## 検証（Claude Code）
- pglite E2E（`../delivery_order_zone_v0/pglite_e2e_test.mjs`）で取込→付与→配達順を通し検証（**18/18 PASS**）。取込分：有効のみ5件・優先度小勝ち・zone_no '1.0'→1・非数値NULL・廃止列なし。
