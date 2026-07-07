# ドライバーアプリ v0（T3）— 認証フロント(8.2) ＋ 配送一覧(8.3)

指示書 `shijisho/shijisho_driver_auth_frontend_v0_1.docx`（8.2）＋ `shijisho/shijisho_delivery_list_v0_1.docx`（8.3）の成果物。

**スタック**: SvelteKit (Svelte 5) + `@supabase/ssr` / Supabase直＋RLS / anonキーのみ。
**範囲(8.2)**: Google OAuth ログイン → セッション → 自分のドライバーprofile → ガード → ログアウト。
**範囲(8.3)**: ホーム＝**配送一覧**。当日担当を**配達順**で表示（問合番号・住所・氏名・時間指定・ステータス・かご記号・配達順）。**対象日切替**（既定=今日）・**担当総数**。読み取り専用（RLS委譲：driver=自分の担当）。
地図(8.4)・配達処理(8.5)・書込/Cloud Run は範囲外。

## §8.3 配送一覧（追加分）

- ホーム `/`（`+page.server.ts` / `+page.svelte`）＝配送一覧。`deliveries` を `delivery_date=対象日`（`?date=`・既定今日）で絞り `delivery_order` 昇順。`driver_id` は明示せず **RLS(deliveries_driver) に委譲**＝自分の担当のみ・他ドライバー0件。
- `氏名(recipient_name)` を表示（CSV取込由来。DSPダミーは空＝「—」のことあり）。
- 検証SQL: `supabase/delivery_list_v0.sql`（取得クエリ相当＋配達順連番＋件数の確認）。
- 確認: テストドライバー（`promote_test_driver_v0.sql` で DRV001）でログイン → 自分の当日160件が配達順に・他ドライバー0件。

## 構成

| パス | 役割 |
|------|------|
| `src/hooks.server.ts` | Supabaseサーバークライアント(anon)＋セッションCookie取り回し＋**認証ガード** |
| `src/routes/+layout.ts` / `+layout.server.ts` / `+layout.svelte` | クライアント/サーバー両対応クライアント＋`onAuthStateChange`でセッション維持 |
| `src/routes/login/+page.svelte` | Googleログイン（`signInWithOAuth`, provider=google） |
| `src/routes/auth/callback/+server.ts` | OAuthコールバック（`exchangeCodeForSession`） |
| `src/routes/auth/signout/+server.ts` | ログアウト（`signOut`） |
| `src/routes/+page.*` | 保護ホーム：自分のprofile＋**担当荷物のみ**（RLS委譲） |
| `src/routes/incomplete/+page.svelte` | 「登録未完了」（driver_id未設定＝未オンボーディング） |
| `supabase/promote_test_driver_v0.sql` | 検証用：テストGoogleユーザーを driver に昇格 |

## RLSへの委譲（設計の要点）

- 荷物クエリは `driver_id` で**明示フィルタしない**。`deliveries_driver`（`driver_id = my_driver()`）に絞り込みを委ねる。
  → 他ドライバーの担当荷物は**自然に0件**になり、合格条件「他ドライバー0件」を実証できる。
- `drivers` も `drivers_self` により自分の1行のみ。
- driver ロールには `offices` のRLSポリシーが無いため、所属は **`office_code` のみ**表示（`office_name` は driver では読めない）。

## 動かす前の準備

### 1. Supabaseダッシュボード（【人】・認証 v0.3 が前提）
- Authentication → Providers → **Google** を有効化（Client ID / Secret）。
- Authentication → URL Configuration →
  - Site URL: `http://localhost:5173`
  - Redirect URLs に `http://localhost:5173/auth/callback` を追加。
- DB は `supabase/dbschema_v0` → `rls_v0/`（profiles_v0 → rls_v0 → seed） → `auth_oauth_v0/` 実行済みであること。

### 2. 環境変数
```powershell
Copy-Item .env.example .env
# .env に PUBLIC_SUPABASE_URL と PUBLIC_SUPABASE_ANON_KEY を入れる（anonキーのみ）
```

### 3. 起動
```powershell
npm install
npm run dev        # http://localhost:5173
```

### 4. テストドライバーの用意（検証直前）
1. 起動したアプリでテスト用Googleアカウントを一度ログイン（profilesがrole=NULLで自動作成され「登録未完了」になる）。
2. `supabase/promote_test_driver_v0.sql` の `test_email` を当該メールに変えて SQL Editor で実行（role=driver / driver_id=DRV001 を付与）。
3. アプリを再読込 → 担当荷物（DRV001の2件）が表示される。

## 合格条件（→ `確認結果メモ.md` で記録）

1. Google OAuthでログインでき、再読込してもセッション維持。
2. 自分のドライバーprofile（ドライバーID・所属営業所）をRLSで取得（他人の行は見えない）。
3. 担当荷物のみ表示・他ドライバーの荷物は0件（DRV002の担当 `9000000000 23/24` が見えない）。
4. 未ログインで保護ページ→ログインへ。driver_id未設定→「登録未完了」へ。ログアウトでセッション切れ。
5. フロントに service role キーが無い（anonキーのみ）・HTTPS前提(11.3)。
6. 用語が要件定義/用語集v0.1どおり（ドライバーID・所属営業所・配送物・問合番号）。
