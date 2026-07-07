# 検証用ダミーデータ 正準規格 v1

最終更新: 2026-06-18 / 対象: `test_1`（LOL配送統合システム 検証環境）

検証用ダミーデータが地域（東京/愛知）・コード様式でモジュール間にバラついていたのを**愛知に統一**するための正準規格。
**新規 seed・既存 seed の整備は本書に従う**。プロジェクト規則「識別子は英語snake_case、用語集の語は COMMENT 併記」に準拠。

---

## 0. 地域

- **愛知に統一**。住所は岡崎市・豊田市・東海市・知多市（zone_plan / address_master / 配車データの実体に一致）。
- 東京・神奈川の住所は使わない（旧東京系3ファイルは愛知へ移行）。

## 1. 拠点（depots）

| depot_code | depot_name |
|---|---|
| `D01` | 愛知県第1拠点 |
| `D02` | 愛知県第2拠点 |

- **コードは英字 `D01`/`D02`**。`'愛知県1'` のような日本語値は使わない（旧 office_assign 等の様式違反を是正）。
- 日本語名は `depot_name` 列・COMMENT で表現。

## 2. 営業所（offices）

| office_code | depot_code | office_name |
|---|---|---|
| `A01` | D01 | 愛知県1営業所 |
| `C01` | D02 | 愛知県2営業所 |

- 拠点:営業所 = 1:1（D01→A01 / D02→C01）。
- 旧 `B01`（営業所B）は廃止。RLSの可視範囲差は「A01(D01) と C01(D02)」「拠点 D01 と D02」で実証する。

## 3. ドライバー（drivers）

| driver_id | driver_name | office_code |
|---|---|---|
| `DRV001` | 山田太郎 | A01 |
| `DRV002` | 佐藤花子 | A01 |
| `DRV003` | 鈴木一郎 | C01 |
| `DRV004` | 田中美咲 | C01 |

- 様式 `DRV` ＋ 3桁。配車の仮ドライバーは `仮1`/`仮2`/`仮3`（生成）。

## 4. 荷主（shippers）

| shipper_id | shipper_name | 用途 |
|---|---|---|
| `SHIP01` | HACHI EXPRESS | 取込ダミーの実体（csv_import） |
| `SHIP02` | ニコイチ運輸 | **RLS分離デモ用**（荷主の「自社のみ＝範囲外0件」を実証するための2社目） |

- 様式 `SHIP` ＋ 2桁。**両方を `shippers` マスタに登録**し、`deliveries.shipper_id` → `shippers` の FK を成立させる。
- 旧 `SHIP03` は廃止（SHIP01/SHIP02 に寄せる）。
- 取込経路では名称→コード変換（`shippers_master_v0`）。マスタに無い名称は保留（素通りさせない）。

## 5. 共通ID（common_id / zone_plan）

- 様式 `OKZ_C_01_08` 系（`[都市2字][区域1字]_[ゾーン番号2字]_[From][To]`）。`C0001` 等は使わない。
- 実 zone_plan（`master_zoneplan_v0/load_master_v0.sql`）の値を正とする。代表値:
  - `OKZ_C_01_08`（岡崎・中央）/ `OKZ_E_05_12` / `TYT_C_25_36`（豊田）/ `TKI_C_03_07`（知多）/ `CTA_C_06_13`（東海）。
- 基盤 seed（dbschema/rls）では実在する2値（例 `OKZ_C_01_08` / `TYT_C_25_36`）を使う。

## 6. 問合番号（tracking_number）

- **実問合番号は12桁数字**に統一（旧 `Q0000001` / `DLV-A1` のデモ行も12桁へ移行）。
- 配車で量産する生成データは **`DSP-<common_id>-<4桁>`**（用途が違うため別様式として許容）。
- デモ用12桁は実CSV値（`2874…`）と衝突しない**`9000…` 帯**を使う（下記アロケーション）。

### 6.1 12桁デモ問合番号アロケーション（基盤 seed 用）

| 旧キー | 新tracking_number | office/driver/shipper |
|---|---|---|
| DLV-A1 / Q0000001 | `900000000001` | A01 / DRV001 / SHIP01 |
| DLV-A2 | `900000000002` | A01 / DRV001 / SHIP02 |
| DLV-A3 / Q0000002 | `900000000003` | A01 / NULL / SHIP01 |
| DLV-B1 → C01へ | `900000000011` | C01 / DRV003 / SHIP01 |
| DLV-B2 → C01へ | `900000000012` | C01 / DRV003 / SHIP02 |
| DLV-C1 | `900000000013` | C01 / NULL / SHIP01 |

> RLS可視範囲の件数構造（営業所別・ドライバー別・荷主別）は旧 rls_v0 と同型を維持し、地域/コードのみ正準化する。

## 7. バッチID（import_batch_id）

- 取込生成: `BATCH-YYYYMMDD-HH24MISS`（`import_shipper_map_v0` / `import_v0`）。
- 基盤 seed の固定値: `BATCH-SEED`。配車量産: `DISP-SEED`。

## 8. かご記号（basket_code）

- A01=アルファベット（`A`,`B`,…）/ C01=数字（`M01`,`M02`,…）。営業所設定 `basket_code_format` に従う（現状維持）。

---

## 9. 移行対象ファイル（旧→正準）

| 層 | ファイル | 主な是正 |
|---|---|---|
| 基盤 | `dbschema_v0/seed_dummy_v0.sql` | 東京→愛知 / Q*→12桁 / C000*→OKZ_* / depot名 |
| RLS | `rls_v0/seed_accounts_v0.sql` ＋ `check_rls_v0.sql` | 東京→愛知 / B01廃止→C01 / DLV-*→12桁 / SHIP03廃止 |
| 荷主 | `shippers_master_v0/` | SHIP02 登録（分離デモ） |
| 認証 | `apps/driver_auth_frontend_v0/supabase/promote_test_driver_v0.sql` | 東京→愛知 / DLV-*→12桁 |
| パイプライン | `office_assign_v0` / `dispatch_v0` / `work_schedule_v0` / `master_zoneplan_v0` 等 | `depot_code '愛知県1/2'`→`D01/D02`（コードのみ。名称はそのまま） |

各移行は **pglite で再検証**（`auth.uid()` スタブ＋`authenticated` ロール、件数・FK・範囲外0件を 1:1 で突合）。
