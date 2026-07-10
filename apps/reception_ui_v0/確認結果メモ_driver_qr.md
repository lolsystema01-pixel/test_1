# 確認結果メモ（ドライバー向けLINE QR返信 v0.1）

- 実施日: 2026 / 07 / 08
- 実施者: （業務A／実機LINE・スキャナ読取は業務A）
- 事前検証: Claude Code（単体・HTTPスモーク・svelte-check・build）

## 事前検証（Claude Code）※実装完了時に実数を記入

| 検証 | 結果 |
|---|---|
| 単体 driverline（パーサ正規化・桁数境界・KAZ付き・全角・ガイド文） | 12/12 PASS |
| 単体 qr（パラメータ検証・生成PNGデコード=正準値一致） | 3/3 PASS |
| HTTPスモーク（/qr 200/400・webhook 画像返信/ガイド文/署名不正403・全角） | 10/10 PASS |
| 既存テストの非破壊（validation/flow/channels） | 30/30 PASS |
| svelte-check / build | 0 errors / 成功 |

## 実機確認（【人】・承認後・公開URL用意後）

| # | 観点 | 期待 | 実際 | 判定 |
|---|---|---|---|---|
| 1 | LINEに数字（KAZの後ろ）を送信 | QR画像がトークに返る | 実機トークにQR画像＋案内文が返信された（サーバログ `driver-line/reply` で送信成功を突合・`reply-failed` 0件） | ☑ |
| 2 | 返ったQRをスキャナ読取 | 「KAZ＋送った数字」が取れる | 未実施（実施者の手元にスキャナ/実伝票環境なし。単体テストでPNGデコード=正準値一致は3/3実証済み。現場テスト枠で実施予定） | ☐ |
| 3 | KAZ付き・全角・空白混入で送信 | 同じQRが返る（正規化） | （未実施・単体テストでは12/12担保済み） | ☐ |
| 4 | 桁数外・日本語を送信 | 使い方ガイド文（QRは返らない） | ガイド文が返信された（ログ `result:"out_of_scope"` で突合） | ☑ |
| 5 | 荷受人ボット（既存）の動作 | 従来どおり（無改修） | 既存 `/webhook/line` はコード無改修・既存テスト30/30 PASS（実LINE接続は元々なし＝対象外） | ☑ |

## 気づき・申し送り

- 桁数はサンプル実測11桁・受理10〜14桁可変。実データ確定後に `parseDriverNumber` の引数で絞る。
- 認証・存在チェックはv0なし（友だち追加をドライバー限定にする運用のみ）。

### 実機確認の環境メモ（2026-07-08）

- LINE設定: Messaging API有効化（プロバイダー Last OneMile Logistics）・長期トークン発行・応答メッセージOFF・Webhook URL登録→コンソール「検証」**成功**・Webhook利用ON。
- 公開URL: cloudflared quick tunnel（`cloudflared tunnel --url http://localhost:4173`）＋ `npm run preview`。**トンネルURLは再起動ごとに変わる＝Webhook URLと `PUBLIC_APP_BASE_URL` の再設定が必要**（常設は要デプロイ）。
- ハマりどころ: Vite preview がトンネルのHost名を403で弾く → `vite.config.ts` に `preview.allowedHosts: ['.trycloudflare.com']` を追加して解決。
- 友だち追加の配布リンク: `https://line.me/R/ti/p/@608abcuq`（配布はドライバー・関係者限定の運用）。

### 常設化（Netlify検証本番・2026-07-08 追記）

- 現場利用（翌日開始）に合わせ **Netlify に常設デプロイ**: `https://lol-driver-qr.netlify.app`（Webhook URL 差し替え→コンソール「検証」成功）。
- **本番経由のend-to-endを実機確認**: 21:59 実番号送信→QR返信・関数ログで `driver-line/reply` と LINE側の画像取得（80ms）を突合。ローカル/トンネル停止後も 200 を確認（完全独立稼働）。
- 環境変数は Netlify 側に設定（値はリポジトリ・チャットに出していない）。Supabase接続情報は未設定＝受付UI部分はスタブ動作（実データ到達不可）。
- **暫定**: サイトは業務A個人のNetlifyアカウント所有。会社チームへの移管 or Cloud Run＋会社ドメインへの正式移行を別途指示書化（Slackに申し送り済み）。

### マージ後レビュー対応（2026-07-10・PR #3に反映）

- 🔴1 署名検証 fail-closed 化（driverline.env.ts／line.env.ts。dev のみスタブ通過）
- 🔴2 PUBLIC_APP_BASE_URL を公開環境で必須化（未設定は webhook 503・Host由来URLでQRを生成しない）
- 🔴3 webhookレスポンスの返信内容同梱を dev／スモーク限定に
- 🟠5 公開ゲート新設（hooks.server.ts）：既定公開は /qr/* と /webhook/driver-line のみ。受付UIは RECEPTION_UI_PUBLIC=true までは404
- 🟠4 Netlify環境変数：DRIVER_LINE_*／PUBLIC_APP_BASE_URL 設定済み・LINE_CHANNEL_*（荷受人）と SMS_PROVIDER_* は**未設定を維持**（スタブ＝実送信なし）
- ratelimit のサーバレス制約はREADMEに明記（受付チャネル本公開時に外部ストア化）
- 🟡 adapter-auto を依存から削除。桁数の絞り込みは現場のA/4帯形式確認と同時に実施予定
