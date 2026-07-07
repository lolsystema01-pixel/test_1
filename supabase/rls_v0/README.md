# RLS v0（拠点／営業所／ドライバー／荷主の範囲）

指示書 `shijisho/shijisho_rls_v0_1.docx` の成果物。
要件定義 **5.3 権限制御(RLS) / 11.3 セキュリティ** に対応。
**SELECT の可視範囲のみ**（INSERT/UPDATE/DELETE は別指示書）。

## 前提

- 「DBスキーマ v0（骨格）」（`../dbschema_v0/`）のテーブルが作成済みであること。
  - 未実行でも `seed_accounts_v0.sql` がマスタを冪等補完するが、先に dbschema_v0 を流すのが正道。

## 成果物 / 実行順（SQL Editorで上から）

| # | ファイル | 役割 |
|---|---------|------|
| 1 | `profiles_v0.sql` | 帰属の仕組み（profiles＋判定ヘルパー関数） |
| 2 | `rls_v0.sql` | 全テーブルRLS有効化＋荷物・問合Indexの5ロールSELECTポリシー |
| 3 | `seed_accounts_v0.sql` | ロール別ダミーアカウント＋帰属、ロール別ダミー荷物 |
| 4 | `check_rls_v0.sql` | ロール別に見える行を確認 |

エラーが出たら内容を Claude に渡して直し、貼り直す。

## 仕組み（検証方法）

- `profiles`＝アカウント(auth.uid())↔ロール・帰属 の対応表。検証用ダミーUUIDを使用。
- ポリシーは `my_role()/my_office()/my_depot()/my_driver()/my_shipper()` 等の
  **SECURITY DEFINER ヘルパー**で自分の帰属を解決（RLSの再帰回避の標準パターン）。
- 確認は `set local request.jwt.claims`（sub＝ダミーUUID）＋ `set local role authenticated`
  でロールを切り替え、`begin...rollback` で囲って件数を見る。

## ロール別ポリシー（荷物）

| ロール | 可視範囲 |
|--------|---------|
| 本部 hq | 全行 |
| 拠点管理 depot | 配下営業所（既定1:1では自営業所相当） |
| 営業所 area | 自営業所（office_code 一致） |
| ドライバー driver | 自担当（driver_id 一致） |
| 荷主 shipper | 自社（shipper_id 一致） |

問合Indexは「親の荷物が見えるものだけ見える」（荷物RLSを継承）。

## 可視範囲マトリクス（ロール × テーブル・SELECT）

「—」は default-deny（0件・閉）。機微テーブル（★）は v0.2 で範囲確定＋検証必須。

| テーブル | 本部hq | 拠点depot | 営業所area | ドライバーdriver | 荷主shipper |
|---------|-------|----------|-----------|----------------|------------|
| deliveries（荷物） | 全行 | 配下営業所 | 自営業所 | 自担当 | 自社 |
| delivery_index（問合Index） | 全行 | 配下営業所 | 自営業所 | 自担当 | 自社 |
| ★ work_schedules（稼働予定） | 全行 | — | 自営業所所属 | **自分のみ** | — |
| ★ drivers（ドライバー） | 全行 | — | 自営業所所属 | **自分のみ** | — |
| offices | 全行 | 配下 | 自営業所 | — | — |
| depots | 全行 | 自拠点 | 自拠点 | — | — |
| zone_plan | 全行 | — | — | — | — |
| address_master | 全行 | — | — | — | — |
| profiles | 全行 | 自分 | 自分 | 自分 | 自分 |

## 期待件数（ダミーデータ ／ 正準規格 v1：愛知 A01(D01)・C01(D02)・B01廃止）

> `docs/dummy_data_standard_v1.md` に統一。荷物は12桁問合番号(9000…帯)、荷主 SHIP01/SHIP02。

| ロール | 荷物 | 問合Index | ★稼働予定 | ★ドライバー |
|--------|------|-----------|----------|------------|
| admin / 本部 | 6 | 5 | 4 | 3 |
| 拠点 D01 | 3 | 3 | 0 | 0 |
| 営業所A01 | 3 | 3 | 3 | 2 |
| 営業所C01 | 3 | 2 | 1 | 1 |
| ドライバDRV001 | 2 | 2 | **2（自分のみ／他人0）** | **1（自分のみ／他人0）** |
| 荷主SHIP01 | 4 | 3 | 0 | 0 （他社SHIP02荷物=範囲外0件） |

## 割り切り（範囲外）

- **機微テーブル（稼働予定・ドライバー）は v0.2 で範囲確定＋「他人=0件」を検証**（指示書 v0.2）。
- それ以外の非機微テーブル（offices/depots/zone_plan/address_master）は最低ライン＋default-deny。詳細範囲は別指示書。
- 認証基盤の実構築（OAuth/マジックリンク）・荷受人・操作系(IUD)RLS・UI は対象外。
