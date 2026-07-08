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
| 2 | 返ったQRをスキャナ読取 | 「KAZ＋送った数字」が取れる | （確認中） | ☐ |
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
