// Claude API 呼び出し（サーバ側）。マスク済みデータ＋質問 → 状況・配達予定の自然文。
//   ・モデルは環境変数（既定 claude-opus-4-8）。APIキーは Anthropic SDK が ANTHROPIC_API_KEY から読む。
//   ・単純なQ&A＝1メッセージ呼び出し。短い回答なので非ストリーミング・max_tokens=1024。
//   ・thinking は付けない（簡潔回答）。代わりにシステムプロンプトで「最終回答のみ」を指示。
import Anthropic from '@anthropic-ai/sdk';
import { env } from './env.js';
import { buildSystemPrompt, buildUserMessage, type MaskedDelivery } from './prompt.js';

// new Anthropic() は ANTHROPIC_API_KEY を環境から読む（キーをコードに書かない）。
//   timeout=30s / maxRetries=1：外向き通信が詰まったとき10分固まらず早く失敗させる（デバッグ容易化）。
const client = new Anthropic({ timeout: 30_000, maxRetries: 1 });

export async function generateReply(masked: MaskedDelivery, question?: string): Promise<string> {
  const response = await client.messages.create({
    model: env.ANTHROPIC_MODEL,
    max_tokens: 1024,
    system: buildSystemPrompt(),
    messages: [{ role: 'user', content: buildUserMessage(masked, question) }]
  });
  // content は型付きブロックの配列。type で絞ってから text を取る。
  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
  return text;
}
