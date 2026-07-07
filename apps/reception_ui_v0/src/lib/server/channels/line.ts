// N-7 LINE：署名検証＋イベント解釈（純関数・node:crypto のみ・$env非依存＝テスト可能）。
//   env依存（SECRET未設定スタブ・返信API）は line.env.ts。
import crypto from 'node:crypto';

// x-line-signature = Base64( HMAC-SHA256(channelSecret, rawBody) )
export function verifyLineSignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature) return false;
  const mac = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64');
  const a = Buffer.from(mac);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b); // タイミング安全比較
}

// LINE Webhook イベントから (userId, text) を取り出す（メッセージ/ポストバック）。
export type LineIncoming = { userId: string; text: string; replyToken?: string };
export function parseLineEvents(body: unknown): LineIncoming[] {
  const events = (body as { events?: unknown[] })?.events;
  if (!Array.isArray(events)) return [];
  const out: LineIncoming[] = [];
  for (const ev of events as Record<string, unknown>[]) {
    const userId = ((ev.source as Record<string, unknown>)?.userId as string) ?? '';
    const replyToken = ev.replyToken as string | undefined;
    if (ev.type === 'message' && (ev.message as Record<string, unknown>)?.type === 'text') {
      out.push({ userId, text: (ev.message as Record<string, unknown>).text as string, replyToken });
    } else if (ev.type === 'postback') {
      out.push({ userId, text: ((ev.postback as Record<string, unknown>)?.data as string) ?? '', replyToken });
    }
  }
  return out;
}
