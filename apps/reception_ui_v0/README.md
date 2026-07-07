# Web受付UI v0.4（T2 再配達・荷受人対応）

要件定義 **7.1**。不在票のQR/URLから入る **Web受付フロー**を1冊で全実装＝**UI（B）＋内製の繋ぎ（C：N-1〜N-6,N-10,N-11）＋バリデーション（D）**。
SvelteKit（Svelte5）。**検証環境・ダミーのみ。本番DB・本番キー・現行GAS/Sheetsに接続しません**（バックエンドはアプリ内ダミー）。LINE/SMS/電話は別指示書。

## 受付フロー（7画面・分岐つき）

```
① 問合番号 →〔N-3 OTP認証〕→ ③ 受付種別 ─┬─(再配達/時間変更)→ ④ 希望日時 ─┐
② 認証コード                              └─(置き配)──────→ ⑤ 置き配場所 ─┤
                                                       ⑥ 確認 →〔N-4 受付登録/N-5 二重〕→ ⑦ 完了〔N-6 状態〕
```

- 画面：`src/routes/reception/{tracking,verify,type,datetime,place,confirm,done}`
- フロー状態：`src/lib/reception.svelte.ts`（sessionStorage・タブ内のみ）

## C章 内製の繋ぎ（サーバendpoint）

| N | 役割 | 実装 |
| --- | --- | --- |
| N-1 | 雛形・ルーティング | SvelteKit初期化・`/reception/*`・共通設定 |
| N-2 | バリデーションのルール設計 | `src/lib/validation.ts`（正＝当社・表示はUI=D章） |
| N-3 | 認証API（OTP） | `POST /api/auth/otp`（**番号存在チェックは検証Supabase実接続**）・`POST /api/auth/verify`（トークン・失敗回数・ロック） |
| N-4 | 受付登録API | `POST /api/redelivery`（受付番号発行・ダミー保持） |
| N-5 | 二重受付チェック | 同上（既存あり→409、`overwrite`で上書き） |
| N-6 | 状態取得 | `GET /api/status`（**配送状況・市レベルは検証Supabase実接続**＋受付サマリ・**PIIは返さない**） |
| N-10 | エラー・ログ（マスキング） | `src/lib/mask.ts`（PIIを伏せてログ） |
| N-11 | 単体・結合テスト | `test/validation.test.ts`・`test/flow.test.ts` |

- ダミーバックエンド（サーバ専用）：`src/lib/server/store.ts`（OTP・トークン・受付。インメモリ）。
- 認証中核（N-3）はアプリ内＝**外注に出さない**。
- **読み取り実接続**：`src/lib/server/lookup.ts` が **検証**Supabaseの `delivery_status_public`（anon・非PII）を呼ぶ。`.env` に `PUBLIC_SUPABASE_URL`/`PUBLIC_SUPABASE_ANON_KEY` を入れると実DB、未設定ならアプリ内ダミーに自動フォールバック（オフライン検証可）。書き込み（受付登録）は実接続しない。

## D章 バリデーション（7項目）

問合番号（必須・半角英数8〜20）／認証コード（必須・数字6桁）／受付種別（必須）／希望日（必須・今日以降）／時間帯（必須）／置き配場所（置き配時のみ必須）／メモ（任意・200字）。
表示：**該当項目の直下に赤字・入力時＆送信時・全項目OKで次へ/送信可**。

## セキュリティ（指示書A）

- 本番DB・本番キー・GAS/Sheets **非接続**（ダミー結合）。RLSは本アプリ範囲外（DBに触れない）。
- **PIIマスキング**：状態取得は氏名・連絡先・詳細住所を返さず市レベルのみ。ログは `mask.ts` でPIIを伏せる（N-10）。
- OTPトークンはサーバ保持。受付/状態はトークン必須（番号のなりすまし不可）。

## 動かす

```bash
npm install
npm run dev              # http://localhost:5173 → / が /reception/tracking へ
npm run dev -- --host    # スマホ実機（同一WiFi）: http://<PCのIP>:5173/
npm test                 # N-11：validation 10 + flow 9 = 19/19
npm run check            # svelte-check 0/0
npm run build
```

- **ダミーで動かす**（env未設定）：番号 **900000000001 / 02 / 03**。認証コードは画面に表示。
- **検証Supabaseに実接続**（読み取り）：`.env` に `PUBLIC_SUPABASE_URL`/`PUBLIC_SUPABASE_ANON_KEY`（検証プロジェクトの anon キー）を設定。番号は**半角英数の実在問合番号**（例：`900000000005` や取込の12桁。`DSP-…` は記号を含むのでUI検証で弾かれる）。前提：検証Supabaseに `delivery_status_public` 関数が作成済み。認証コードは引き続き画面表示（実SMSはチャネル連携=別指示書）。

## 範囲外

LINE/SMS/電話（N-7〜N-9・別指示書）／完了通知メール文面・HTML／本番DB/API接続／クラウド発注の体裁。
