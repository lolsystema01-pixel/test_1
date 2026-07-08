# ドライバー向けLINE QR返信 v0.1

指示書「ドライバー向けLINE QR返信 v0.1」の成果物。承認済み（LOL）。
ドライバー専用LINE公式アカウント（@608abcuq）に**問合番号の数字部分**（KAZの後ろ・10〜14桁）を送ると、
**「KAZ＋数字」を埋めたQR画像**がトークに返る。伝票のバーコード/QRが破損・読取不能なときの代替スキャン手段。

## 構成（ステートレス・DB非接触・service_role不使用）

| パス | 役割 |
|---|---|
| `src/lib/server/channels/driverline.ts` | 番号パーサ・返信組み立て（純関数） |
| `src/lib/server/qr.ts` | QRパラメータ検証＋PNG生成（qrcode・誤り訂正M） |
| `src/lib/server/channels/driverline.env.ts` | $env依存ラッパ（署名スタブ・画像返信・baseURL） |
| `src/routes/qr/[number]/+server.ts` | GET /qr/KAZ<数字>.png（オンザフライ生成・不正400） |
| `src/routes/webhook/driver-line/+server.ts` | POST（署名検証→パース→画像返信・不正403） |

- 既存の荷受人向け `/webhook/line` とは**完全分離**（ルート・secret・環境変数）。既存コードは無改修。
- 署名検証・イベント解釈・レート制限・PIIマスキングは既存純関数（line.ts / ratelimit.ts / mask.ts）を流用。
- QRの中身＝送り状番号のプレーンテキスト（実伝票QRのデコード裏取り済み＝伝票QRと同値）。

## 【人】LINE Developers 設定手順（実機確認前に1回）

1. LINE Developers で @608abcuq のチャネルを開き **Messaging API を有効化**。
2. **チャネルシークレット**／**チャネルアクセストークン（長期）**を発行し、環境変数へ：
   `DRIVER_LINE_CHANNEL_SECRET` / `DRIVER_LINE_CHANNEL_ACCESS_TOKEN`
   ※値はチャット・リポジトリ・メモに貼らない（.envのみ）。
3. **Webhook URL** に `https://<公開URL>/webhook/driver-line` を登録し Webhook をON。
4. 応答設定で**自動応答メッセージをOFF**（二重返信防止）。
5. `PUBLIC_APP_BASE_URL=https://<公開URL>` を設定（LINEが画像を取りに来るURL）。
6. 友だち追加のQR/URLは**ドライバーに限定して配布**（v0の利用制限はこの運用のみ）。

※ LINEはwebhook通知も画像取得も**インターネットから届くURL**が必要。実機確認はデプロイ or トンネルで公開してから。

## 検証（ローカル・LINE不要）

```bash
npm test                 # 単体（既存30＋driverline/qr）
npm run build && npm run smoke:driver-qr   # HTTPスモーク（署名込み・PASS 10/10）
```

- 検証で使う番号は**ダミー帯**（90000000001 等の9000…帯）。実番号は使わない。
- 未設定時の挙動：SECRET未設定＝署名スタブ通過／TOKEN未設定＝返信はログ出力（レスポンスに返信内容を同梱）。

## 範囲外（指示書どおり）

DB照会・存在チェック・ドライバー本人認証（後回し）／荷受人チャネルの変更／QRの印刷・ラベル化／Storage保存／本番運用設計。
