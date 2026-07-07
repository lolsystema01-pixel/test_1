# 拠点振分 v0.2（共通ID→拠点→営業所の付与）

指示書 `shijisho/shijisho_office_assign_v0_2.docx` の成果物。
共通IDが付いた荷物に、**共通ID→拠点→営業所** の経路で拠点コード・営業所コードを付与する（配布の土台）。
要件定義 6.2 全国配分 / 4.5 配布 / 5.4 拠点＝営業所（既定1:1）/ 9.2 拠点・営業所マスタ に対応。

## 前提

- 住所判定（共通ID判定）が済み、荷物に `common_id` が付いている（`supabase/address_match_v0/`）。
- 全国Master／ZonePlan が読込済み（`supabase/master_zoneplan_v0/`）。ZonePlan が共通ID→拠点(`depot_code`)を保持。

## 実行順（SQL Editor に手でコピペ）

1. `seed_office_master_v0.sql` … 拠点/営業所マスタを seed（非版管理）。拠点→営業所 1:1。
2. `assign_office_v0.sql`【A. dry-run】… 引けた/引けない件数を確認（書き込まない）。
3. `assign_office_v0.sql`【B. 本実行】… 拠点コード・営業所コードを付与＋保留。
4. `check_assign_v0.sql` … 付与結果・保留・営業所別件数・経路成立の確認。

各ブロックを選択して Ctrl/Cmd+Enter で個別実行（複数文は最後の結果しか表示されないため）。

## マスタ方針（重要）

- 拠点/営業所は**非版管理の設定マスタ**（版管理は全国Master・ZonePlanのみ＝9.2/9.3）→ CSV取込せず seed SQL で直接投入。
- ★**正準ダミーデータ規格 v1**（`docs/dummy_data_standard_v1.md`）に統一。拠点コードは ZonePlan/Master の `depot_code`（**英コード `D01`/`D02`**）に**一致**させる（経路の接続点）。
- 拠点/営業所は英コードのまま名称のみ愛知県へ：
  - `D01`=愛知県第1拠点（営業所 `A01`=「愛知県1営業所」）／`D02`=愛知県第2拠点（`C01`=「愛知県2営業所」）。
  - 営業所は `A01`/`C01` の 1:1（**旧 `B01` は正準規格で廃止**。残存環境向けに seed §0 で冪等クリーンアップ）。
  - `seed_office_master_v0.sql` は depots/offices を**冪等 upsert**（旧版の「日本語コードへ再キー」は廃止）。`drivers`/`profiles`/`work_schedules` の紐付きは温存。

## 成果物

| ファイル | 内容 |
|---------|------|
| `seed_office_master_v0.sql` | 拠点/営業所マスタの seed（D01/D02・A01/C01・愛知県名称・1:1・冪等upsert） |
| `assign_office_v0.sql` | 共通ID→拠点→営業所の付与（dry-run→本実行）＋保留 |
| `check_assign_v0.sql` | 付与件数・保留・営業所別件数・経路成立・1:1 の確認 |
| `確認結果メモ.md` | 付与N件／保留M件／営業所別件数の記録 |

## やらないこと（範囲外）

- 住所→共通IDの判定（前段）。ゾーン・かご記号の付与（配車側）。配車（6.5）・仕分け・帳票。
- 中間拠点が複数営業所を束ねる運用（5.4。既定1:1。将来、親子で対応）。
- RLSの詳細（別指示書）。UI。本番データ・現行GAS。SQLの自動実行・マイグレーション（人手コピペ）。
