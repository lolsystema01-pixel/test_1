// N-7 LINE：env依存ラッパ（署名検証スタブ・返信API）。endpointから利用（$env）。
import { env } from '$env/dynamic/private';
import { logMasked } from '../../mask';
import { verifyLineSignature } from './line';

// 署名検証（env版）。SECRET 未設定の検証環境では true（スタブ）＋警告ログ。
export function verifySignatureEnv(rawBody: string, signature: string | null): boolean {
  const secret = env.LINE_CHANNEL_SECRET;
  if (!secret) {
    logMasked('line/sig-skip（LINE_CHANNEL_SECRET未設定＝検証スタブ）');
    return true;
  }
  return verifyLineSignature(rawBody, signature, secret);
}

// 返信（検証はスタブ＝ログ。トークンがあれば Reply API）。
export async function replyLine(replyToken: string | undefined, messages: string[]): Promise<void> {
  const token = env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token || !replyToken) {
    logMasked('line/reply(stub)', { count: messages.length });
    return;
  }
  await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ replyToken, messages: messages.slice(0, 5).map((t) => ({ type: 'text', text: t })) })
  });
}
