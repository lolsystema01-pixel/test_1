# Claude API PoC（配送状況の自動応答）v0

指示書 `shijisho/shijisho_ai_status_reply_v0_1.docx` の成果物。要件定義 **7.4 問合せ・顧客AI**。
**Cloud Run 層の初実装**：問合番号から **配送状況＋配達予定** を Claude API が日本語の自然文で回答する、Hono+TS の最小エンドポイント1本。

## エンドポイント

```
POST /api/v1/ai/delivery-status-reply
  body: { "tracking_number": "900000000001", "question": "今日届きますか？"(任意) }
  200 : { "data": { "tracking_number", "status", "reply": "<日本語の自然文>" } }
  400 : VALIDATION_ERROR（tracking_number 必須 / JSON不正）
  404 : NOT_FOUND（該当なし・丁寧なエラー文）
  500 : INTERNAL_ERROR（照会失敗 / AI生成失敗）
```
API契約 v0 準拠：`/api/v1`・kebab-caseパス・英語snake_case・統一エラー `{ error: { code, message } }`。

## セキュリティ設計（最優先）

| 守るもの | やり方 |
|---|---|
| **AI入力のPIIマスキング**（11・11.3） | DBの **SECURITY DEFINER 関数 `delivery_status_public`** が **氏名・詳細住所・連絡先を一切返さない**。返すのは status・delivery_date・time_window・配達順・**市レベル(municipality)** のみ。＝サーバも Claude もPIIを受け取らない（マスキングを源流で強制）。 |
| **Claude APIキー** | サーバ環境変数 `ANTHROPIC_API_KEY` のみ。Anthropic SDK が環境から読む。**フロント・レスポンス・ログに出さない**（起動ログはURLのみ）。 |
| **service_role 不使用** | 非PII状況は anonキー＋関数経由で引く。強い鍵をサーバに置かない。 |

- モデルは `ANTHROPIC_MODEL`（既定 **`claude-opus-4-8`**）。単純なQ&A＝1メッセージ呼び出し・非ストリーミング・`max_tokens=1024`。
- ステータス（6.10：未配車/配車済/仕分済/配送中/完了/不在）に応じて回答が変わるよう、語彙ガイドをシステムプロンプトに内蔵。

## 構成

```
src/prompt.ts   … プロンプト雛形（純関数・PII非依存）＝状況語彙＋状況別回答
src/claude.ts   … Claude 呼び出し（SDK・モデル環境変数）
src/supabase.ts … anonキー＋関数 delivery_status_public 呼び出し
src/index.ts    … Hono：endpoint＋統一エラー＋起動
supabase/ai_status_reply_v0/delivery_status_rpc_v0.sql … 非PII状況を返す関数（PIIマスキング源流）
```

## セットアップ（PoCはローカルで十分）

```powershell
# 1) DB関数を作成（前提: 配車v0.5＋採番一式v0.5 実機済み）
#    supabase/ai_status_reply_v0/delivery_status_rpc_v0.sql を SQL Editor で実行

cd apps/ai_status_reply_v0
Copy-Item .env.example .env   # ANTHROPIC_API_KEY / SUPABASE_URL / SUPABASE_ANON_KEY を設定
npm install
npm run dev                   # http://localhost:8787
```

> 動かす場所：PoCはローカルHono起動で十分（指示書どおり）。Cloud Run へデプロイする場合も同じコードで、環境変数を Secret に置くだけ。

## 動作確認（curl）

```bash
# 正常系（問合番号は配車/採番済みの実データに合わせる。例は 9000… 帯のダミー）
curl -s http://localhost:8787/api/v1/ai/delivery-status-reply \
  -H 'content-type: application/json' \
  -d '{"tracking_number":"900000000001","question":"今日届きますか？"}'

# 該当なし → 404 統一エラー
curl -s http://localhost:8787/api/v1/ai/delivery-status-reply \
  -H 'content-type: application/json' -d '{"tracking_number":"NOTEXIST999"}'
```
`test/requests.http`（REST Client用）も同梱。

## 合格条件（→ `確認結果メモ.md`）

- ダミー問合番号→ Claude が状況＋配達予定を日本語自然文で返す。
- ステータスに応じて回答が変わる。
- **個人情報（氏名・詳細住所・連絡先）がプロンプトに含まれない**（関数が源流でマスク）。
- 存在しない問合番号→丁寧なエラー文＋統一エラー（code/message）。
- Claude APIキーが環境変数にあり、フロント／レスポンス／ログに露出しない。
- `/api/v1`・英語snake_case・統一エラー（API契約 v0準拠）。

## やらないこと（範囲外）

- 7.4の他項目（営業所AI支援・顧客AIチャット・AI音声）。荷受人の本人確認・簡易認証（7.1）。
- チャットUI・LINE/SMS連携。配送状況の書き込み・再配達受付（7.1）。API契約v0自体の作成。本番データ・現行GAS・キーのフロント配置。

## 事前検証（このリポジトリで実施済み）

| 検証 | 結果 |
|---|---|
| `npm run typecheck`（tsc） | 0 errors |
| `npm run test:prompt`（prompt.ts 単体） | **20/20 PASS** |
| pglite：関数 `delivery_status_public` | **14/14 PASS** |

pglite で実証：**氏名(田中)・連絡先(090)・詳細住所(箱柳町12-3)が結果に一切出ない**／status・予定日・時間帯・配達順・市レベルは返る／該当なし→`null`（→404）／anon・authenticated 双方で実行可。

> Claude 実呼び出し（自然文の中身・ステータス別の口調）は **【人】が APIキーを設定して curl で確認**（外部送信を伴うため）。`確認結果メモ.md` に記録。
