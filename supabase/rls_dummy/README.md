# ダミーテーブル作成＋RLS動作確認（営業所別アクセス制御）

指示書 `shijisho_rls_dummy_table_v0_2.docx` に対応する成果物一式。
**検証環境専用**。本番データ・現行GASには触れない。自動実行/マイグレーションツールは使わず、
**SupabaseのSQL Editorに手でコピペして実行**する。

## 構成

| ファイル | 役割 |
|---------|------|
| `create_table.sql` | 営業所列(`office_id`)を持つダミーテーブル `deliveries` を作成 |
| `rls_policy.sql`   | RLS有効化＋「自分の営業所の行だけSELECT」ポリシー |
| `seed_dummy.sql`   | 2営業所分(A=3件 / B=2件)のダミーデータ投入 |
| `check_rls.sql`    | 営業所権限に切り替えて見える行を確認 |
| `確認結果メモ.md`  | 各権限で見えた件数の記録用 |

## 実行手順（SQL Editorで上から順に）

1. `create_table.sql` を貼り付けて **Run** → テーブル作成
2. `rls_policy.sql` を貼り付けて **Run** → RLS＋ポリシー設定
3. `seed_dummy.sql` を貼り付けて **Run** → ダミーデータ投入（全5件見えるはず）
4. `check_rls.sql` を貼り付けて **Run** → 営業所別の見え方を確認

エラーが出たら内容を Claude に渡して直し、貼り直す。

## 設計メモ（営業所の判定方法）

- 「そのアカウントがどの営業所か」は **JWTの `office_id` クレーム** で判定する。
- 検証では `check_rls.sql` 内で `set local request.jwt.claims` により office_id を直接注入し、
  `set local role authenticated` で一般ユーザー権限に切り替えて確認する。
- 実運用では office_id を JWT に載せる仕組み（Custom Access Token Hook で app_metadata 等に格納）が
  別途必要。今回の検証スコープ外。詳細は `rls_policy.sql` の補足コメント参照。

## 期待結果（合格条件）

| 権限 | 見える件数 |
|------|-----------|
| 管理者(SQL Editor=RLS無視) | 5件（A=3, B=2） |
| 営業所A | 3件（Aのみ。Bは0件） |
| 営業所B | 2件（Bのみ。Aは0件） |

→ 管理者と営業所権限で件数が変わり、各営業所は自分の行しか見えなければ合格。
