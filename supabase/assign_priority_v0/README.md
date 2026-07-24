# 配車 割当優先順位（希望エリア第一）v0.3

指示書「配車 割当優先順位（希望エリア第一・現状差分）v0.3」の成果物。
既存 `dispatch_build`（配車v0.5）に**希望エリア第一**を追加する最小改修（Phase1 主担当の `order by` に1句差込＋`offices` 読取分岐）。骨格・cap 式(#27)は無変更。

## 立ち位置
- §12.5.2「割当優先順位（希望エリア第1）」。`offices.preferred_area_first` で営業所ごとに切替。
- 既定 **false ＝ 現行の残荷量最大のまま**（回帰一致）。true で「担当ドライバーの希望エリア一致」を主担当選定の最優先にする。
- 希望エリア = `work_schedules.preferred_areas`（common_id 配列・シフト v0.7）。1日1稼働 UNIQUE により (driver, date) の希望は一意。

## ファイルと実行順（Supabase SQL Editor・手動コピペ）

| # | ファイル | 内容 |
|---|---|---|
| 1 | `offices_preferred_area_first_v0.sql` | `offices.preferred_area_first`(bool・**既定false**) 追加。`dispatch_priority`(既存)とは別軸で別列 |
| 2 | `dispatch_build_preferred_v0.sql` | `dispatch_build` を cap_wire 版から完全転記＋#28差込（order by 1句・offices読取・off_preference/mode記録）。骨格無変更 |
| 3 | `common_id_display_view_v0.sql` | `common_id_display` ビュー：common_id→area・municipality＋zone_no範囲（area_master由来・zone_plan不使用） |

**⚠ 適用順（重要）**: `dispatch_build` は `create or replace` で丸ごと置き換わる。正の順序は **④(`vocab_fix_v0/migrate_functions_to_area_master_v0.sql`) → cap_wire(`shift_mgmt_v0/cap_wire_shift_labels_v0.sql`) → 本モジュール②** 。cap_wire を後から流すと #28 が巻き戻る（②は cap_wire 版を土台に転記している）。

## 変更点（②の中身・cap_wire 版からの差分だけ）
- declare に `v_pref_first`（営業所のモード）／`v_pref_areas`（ドライバーの希望）。
- (1) に `offices` を join し `dispatch_drivers.preferred_area_first`（割当モード）を記録。
- (3) 営業所ループで `offices.preferred_area_first` を、ドライバーループで `work_schedules.preferred_areas` を読む（関数内分岐＝4呼出経路で一貫）。
- **Phase1 主担当の `order by` 先頭に1句差込**：`case when v_pref_first and 希望に含む then 0 else 1 end` → 希望一致を最優先。偽 or 希望未設定なら全ゾーンで 1 となり**現行の残荷量最大に自然に戻る**（回帰一致・フォールバック）。
- Phase1/Phase2 の割当 insert に `off_preference`（希望外＝#29 と同一条件）を記録。
- **(0)事前チェック・(2)ゾーン候補・Phase2隣接充填・(4)仮ドライバー・(5)集計・cap式#27・1配送物=1ドライバーは1文字も変えない。**

## 希望外（#29 と同一条件・業務A確定 2026-07-20）
- 希望外 = 割当 common_id が担当ドライバーの `preferred_areas` に含まれない（**実ドライバーのみ**）。
- `preferred_areas` が **NULL（希望未指定）は希望外に数えない**（希望なし＝どこでも可 → `off_preference=false`）。
- **仮ドライバーの割当は `off_preference=NULL`**（#29 は仮割当を別指標で数える）。
- ＝ `dispatch_assignments.off_preference` が #29 の「希望外件数」の源（`count(*) where off_preference`）。

## 検証（Claude Code・pglite 21/21）
```bash
node supabase/assign_priority_v0/pglite_test.mjs   # 21/21
```
合格条件との対応：
- **false＝現行と同一割当（回帰一致）** … ⓪②「false の割当が改修前(cap_wire版)と driver×common_id×件数で完全一致」＋cap 回帰(DRV1=100/DRV2=60)。
- **true＝Phase1 主担当に希望エリア一致が最優先** … ③ DRV1(希望{CB})が残荷量最大の CA より CB を先取り。
- **希望エリア未設定はフォールバック** … ④ DRV2(希望NULL)は true でも残荷量最大の CA。突合は common_id。
- **希望一致割当が増え希望外が減る・未割当は増えない** … ③ 希望外 false:100→true:0・未割当は両モード0（CA余剰は仮が吸収）。
- **表示名ビューが common_id→area・municipality＋zone_no範囲** … ⑤ CA→AR-A/M-A/範囲1..3・CB→M-B/2..2（area_master由来・zone_plan不使用）。
- **分岐は関数内（4呼出経路で一貫）・cap・仮・1=1は両モード共通** … ②③で実証。

## 申し送り（#29・次担当）
- **#29 配車サマリはこのモジュールの成果物を薄く消費する**：希望外件数＝`dispatch_assignments.off_preference` の集計、表示名＝`common_id_display` ビュー。希望外の定義・表示名解決をここで確定したので #29 は別定義しない（二重定義を避ける）。
- 本モジュールは #28 の範囲（優先順位・表示名・希望外記録）まで。手動調整#30・希望エリア入力UI（シフト v0.7 フロント）は範囲外。

## 範囲外（指示書）
dispatch_build 骨格（cap・残荷量・分割閾値・隣接ランク・仮ドライバー・1=1）／cap式#27／preferred_areas 列追加・希望エリア入力（シフト v0.7）／配車サマリ#29／手動調整#30／`offices.dispatch_priority` の意味変更／depots への設定追加／本番データ・現行GAS。
