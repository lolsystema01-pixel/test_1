# 配車 v0.5（処理能力優先・仮ドライバー）

指示書 `shijisho/shijisho_dispatch_v0_5.docx` の成果物。要件定義 **6.5 配車（ドライバー予測）** に対応。
GAS `20_assign_main_fit_assign.js` / `24_Logic_Dispatch` の判定経路を踏襲。

**範囲**: ドライバー確定（実/仮）＋ステータス＝配車済み まで。
配達順・かご記号の採番＋問合Index同期（採番一式）、最低保証優先の救済、応援募集(6.6)、配車画面UIは**範囲外**。

## ファイル

| ファイル | 役割 |
|---|---|
| `seed_dispatch_v0.sql` | 検証用ダミー（ゾーン＋隣接＋分割閾値・ドライバーskill・承認/申請中の稼働予定・未配車荷物800件） |
| `dispatch_v0.sql` | エンジン本体。§0設定＋関数 / §A dry-run / §B 本実行 |
| `check_dispatch_v0.sql` | 確認（cap・分割・cap充足・隣接束ね・仮数・件数） |
| `確認結果メモ.md` | 結果記録 |

## 実行順（SQL Editor にコピペ）

1. `seed_dispatch_v0.sql` … ダミー投入（A01=700件 / C01=100件）
2. `dispatch_v0.sql` §0〜§A … **dry-run**（集計のみ・書き込まない）→ 中身を確認
3. `dispatch_v0.sql` §B … **本実行**（status=配車済み 確定）
4. `check_dispatch_v0.sql` … 期待 vs 実 を突合

## ロジック（GAS準拠）

- **cap** ＝ スキル（`drivers.skill_per_hour`＝1時間あたり配達個数）× 稼働区分の時間（`shift_hours`：フル8h/6中6h/2時間2h…）。**承認済み稼働予定のみ**（申請中/却下は除外）。
- **ゾーン候補** ＝ 共通ID別の未配車荷量。`zone_plan.split_threshold`（既定170）で分割：
  `≤閾値→1 / ≤1.8倍→2 / ≤2.6倍→3 / 以降 ceil(荷量/閾値)`。
- **処理能力優先（既定）** ＝ capの大きい実ドライバーから、Phase1で主担当ゾーン1本→Phase2で**隣接ランク≤3**のゾーンを積み増しcap充填（割当後 ≤ cap）。
  - 隣接ランク: `zone_rank()` ＝ 1=同一ゾーン / 2=同一市（`address_master.municipality`）/ 3=隣接（`zone_plan.adjacent_zones`）/ 99=対象外（割り当てない）。
- **仮ドライバー** ＝ 残った未配車を 営業所×共通ID でまとめ、推奨枠200個で区切って `仮1, 仮2…`。承認ドライバー0なら全件仮配車。
- **二段階** ＝ dry-run（`deliveries`は触らず作業テーブルに集計）→ 本実行（割当に従い `driver_id` 付与＋`status='配車済'`）。
- **当日スコープ** ＝ 対象は `deliveries.delivery_date = current_date` の未配車のみ（要件「当日基準」）。別日の在庫や他モジュールの残骸は混入しない。**seed と dispatch は同じ日に実行**すること（seedが `delivery_date=current_date` で投入するため）。

## 設計メモ（既存スキーマとの整合）

- **分割閾値の持ち主＝配車（ZonePlan拡張）**。全国ZonePlan v0.4 はマスタ本体に分割閾値を「持たない」とし「配車設計時にZonePlan拡張として扱う」と委譲している（master_zoneplan v0.4『やらないこと』）。本配車が `zone_plan.split_threshold` 列を追加（§0、既定170）し、**値の出所は全国ZonePlan CSV「分割閾値(個)」**。master_zoneplan_v0 が読込済みなら §0 が `zoneplan_staging` から同値を同期、未ロードなら seed のフォールバック値（CSVと一致）を使う。master_zoneplan_v0 本体は無改修。
- 同一市判定(rank2)は `address_master.municipality` から導出（マスタに正規に存在する出所）。
- 隣接 `adjacent_zones` は**共通IDのカンマ区切り**で保持（`zone_rank` が `string_to_array`＋`trim` で解釈）。
- 作業3テーブル（`dispatch_drivers/zones/assignments`）＋`shift_hours` は **全テーブルRLS**方針に従い RLS有効化＋本部参照のみ。SQL Editor は管理者権限で動くため計算・更新は可能。
- `deliveries.driver_id` はFK無し（schema_v0準拠）なので `仮1` 等の仮ID格納も可。

## 検証データの期待値（current_date 基準）

| 営業所 | 実ドライバー(cap) | ゾーン(荷量/分割) | 実割当 | 仮ドライバー |
|---|---|---|---|---|
| A01 | DRV001(160)・DRV002(108) | OKZ_C(300/2)・OKZ_E(150/1)・TYT_C(250/2) | 268 | 仮1・仮2・仮3（計432） |
| C01 | DRV003(176) ※DRV004は申請中で除外 | TKI_C(60/1)・CTA_C(40/1) | 100（TKI_C+CTA_C束ね・rank3） | なし |

合計800件 → 本実行で全件 `配車済`（実368＋仮432）。

## 検証状況

- **ロジックは pglite（WASM版Postgres）で実行検証済み**（schema_v0＋profiles_v0＋seed＋dispatch を流し、check全項目が上表の期待値と一致）。Supabase上での最終確認は `確認結果メモ.md` に記録すること。
- 環境差: Supabaseには `authenticated` ロール・`auth.uid()` が既存（pgliteでは要スタブ）。Supabase SQL Editor ではそのまま動く。
- 性能目標（数千件で10秒台）は集計をセットベース、配分ループは営業所×ドライバー単位（割当自体は `INSERT…SELECT…LIMIT` のセット処理）で抑えている。荷量を増やして所感を記録すること。
