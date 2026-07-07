# 認証 v0.3（Google OAuth土台）

指示書 `shijisho/shijisho_auth_oauth_v0_3.docx` の成果物。
内部向け（本部／拠点／営業所）Google OAuth の**土台**。要件定義 5.2 認証。
**フロントエンド（ログイン画面・遷移）は後続の別指示書**。今回はGUI設定（人）＋DB自動紐付け（AI）まで。

## 担当の分離

| 担当 | 内容 |
|------|------|
| 🧑 **【人】** | Google Cloud Console / SupabaseダッシュボードのGUI設定、シークレットの環境変数設定 |
| 🤖 **【AI】** | profiles 自動作成のトリガ／関数、確認SQL（このフォルダのsql） |

## 成果物

| ファイル | 担当 | 内容 |
|---------|------|------|
| `profile_autocreate_v0.sql` | AI | auth.users→profiles 自動作成トリガ＋role を未設定可に |
| `check_auth_v0.sql` | AI | profiles自動作成・auth.uid()→ロール取得の確認 |
| `設定記録メモ.md` | 人 | GUI設定の記録（**シークレット値は書かない**） |
| `確認結果メモ.md` | 人+AI | 検証結果 |

---

## 🧑【人】の手順

### 手順1：Google Cloud Console で OAuthクライアント作成
1. GCPプロジェクトを用意（検証用。既存でも可）。
2. **OAuth同意画面**を設定（User Type=外部/内部、テストユーザーに自分のGoogleアカウントを追加）。
3. **認証情報 → OAuth 2.0 クライアントID** を作成（アプリの種類：**ウェブアプリケーション**）。
4. **承認済みのリダイレクトURI** に、手順2でSupabaseが表示する Callback URL を登録（手順2とセットで往復）。
5. 発行された **クライアントID／クライアントシークレット** を安全に控える。
   - ⚠️ **チャット・リポジトリ・確認メモに値を貼らない**（秘密情報）。

### 手順2：Supabase で Googleプロバイダ有効化
1. Supabaseダッシュボード → **Authentication → Providers → Google** を **Enable**。
2. クライアントID／クライアントシークレットを入力。
3. 画面に出る **Callback URL** をコピーし、手順1-4のGoogle側「承認済みのリダイレクトURI」に登録（往復完了）。

### 手順3：秘密情報の扱い
- **ホスティング版Supabaseで運用する今は、ダッシュボード入力で完了**。ID/シークレットは
  Supabase側に保存される（シークレットは暗号化保管）。**自分の `.env` への記載は不要。**
  - クライアントIDは秘密ではない（OAuthのURLに出る公開情報）。シークレットが秘密。
  - いずれも**コード・リポジトリ・メモに値を直書きしない**（11.3）。
- 環境変数（`SUPABASE_AUTH_GOOGLE_CLIENT_ID` / `SUPABASE_AUTH_GOOGLE_SECRET`）は**任意・参考**。
  ローカルのSupabase CLI(config.toml)やCloud Run等から扱う場合のみ使用（`.env.example`参照）。

---

## 🤖【AI】DB側の実行順（SQL Editor）

1. （前提）`rls_v0/profiles_v0.sql` 実行済み（profiles と判定ヘルパーがある）
2. `profile_autocreate_v0.sql` を Run … トリガ／関数を作成、role を未設定(NULL)可に
3. 【人】が Supabase で認証ユーザーを1人追加（**Add user**、またはテスト用Googleでログイン）
4. `check_auth_v0.sql` を Run … profiles自動作成・auth.uid()→ロール取得を確認

## 合格条件

- 🧑 Supabase で Google OAuth が有効（コールバックURI往復済み）
- 🧑 クライアントID/シークレットが環境変数管理で、直書きされていない
- 🤖 新規authユーザー作成時に profiles 行が自動作成（role未設定=NULL）
- 🤖 auth.uid() から profiles のロール・帰属が引ける（SQLで確認）

## 設計メモ

- 新規ユーザーは **role=NULL（未設定）** で作成 → `my_role()` が NULL を返し、RLSで何も見えない（fail-closed）。本部がロールを付与して初めて可視範囲が開く。
- ロール付与（profilesへの帰属設定）そのものは本指示書の範囲外。
