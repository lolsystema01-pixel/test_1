# 受付チャネル v0（LINE／SMS／電話）— N-7〜N-9

要件定義 **7.1**。LINE・SMS・電話からの受付を、**既存の読み取り（SECURITY DEFINER 関数）と登録（N-4）に funnel する連携**だけを実装。
Web受付UI v0.4（同アプリ）の **read/auth/register/validation/mask を流用**。検証環境・ダミー（外部サービスはスタブ、キーは環境変数）。

## 構成（reception_ui_v0 に増築）

| 部品 | ファイル | 役割 |
| --- | --- | --- |
| 会話FSM | `src/lib/server/channels/fsm.ts` | 問合番号→OTP→種別→（日時/置き配）→確認→完了。**依存注入（DI）＝$env非依存・テスト可** |
| サービス束 | `src/lib/server/channels/services.ts` | FSMに `lookup`(既存関数)／`issueOtp`/`verifyOtp`/`register`(N-3/N-4)／`sendOtp` を注入 |
| 会話状態 | `src/lib/server/channels/session.ts` | チャネル×ユーザーの会話状態（インメモリ） |
| N-7 LINE | `channels/line.ts`(純:署名検証/イベント解釈)＋`line.env.ts`(返信API)＋`routes/webhook/line` | 署名検証→FSM→返信 |
| N-8 SMS | `channels/sms.ts`(送信アダプタ)＋`routes/webhook/sms` | OTP/通知送信＋双方向受信→FSM |
| N-9 電話 | `routes/webhook/phone` | IVR/オペレータ入力→存在確認→N-4登録（受け口枠） |
| 横断 | `channels/ratelimit.ts`／`mask.ts`／store(OTPロック)／register(二重) | レート制限・PIIマスキング・OTP試行ロック・二重受付(N-5) |

## funnel 先（流用＝本書では作らない）

- **読み取り**：`delivery_status_public`（anon・非PII・§7.4で実装済み）→ `lib/server/lookup.ts`
- **登録(N-4)・認証(N-3)・検証(D章)**：v0.4 の `store.ts`／`validation.ts` をそのまま使用
- **service ロールキーは使わない**（§11.3・RLS委譲）

## 検証環境の割り切り（本番非接続）

- LINE 署名：`LINE_CHANNEL_SECRET` 未設定なら**検証スタブ（通す）**。設定時は HMAC-SHA256 で検証。返信は `LINE_CHANNEL_ACCESS_TOKEN` があれば Reply API、無ければログ。
- SMS：`SMS_PROVIDER_*` があれば実送信枠、無ければスタブ（ログ）。OTPコードは会話に**検証用表示**（実SMSは電話番号=PII取得が必要＝別途）。
- 電話：受け口枠（IVR/オペレータ→N-4）。AI音声一次対応は **P3（後段）**。

## 環境変数（`.env`・任意）

```
LINE_CHANNEL_SECRET=          # 設定時のみ署名検証
LINE_CHANNEL_ACCESS_TOKEN=    # 設定時のみ実返信
SMS_PROVIDER_SID=             # 設定時のみ実SMS
SMS_PROVIDER_TOKEN=
SMS_FROM=
```
（読み取り実接続の `PUBLIC_SUPABASE_URL`/`PUBLIC_SUPABASE_ANON_KEY` は本体READMEを参照）

## エンドポイント

- `POST /webhook/line` … LINE Webhook（署名検証→会話）
- `POST /webhook/sms` … SMS inbound（form/json）。送信は `sms.ts`
- `POST /webhook/phone` … 電話受け口（`{trackingNumber,type,desiredDate,timeSlot,dropPlace,overwrite}`→受付番号）

## 範囲外

DB読み取り実装（既存関数）・N-3/N-4/D章本体（v0.4）・service ロール直アクセス・Web受付画面・AI音声本実装(P3)・完了通知メール文面・本番接続。
