// ドライバー用LINE：env依存ラッパ（署名検証スタブ・画像返信API・baseURL解決）。
//   荷受人ボット（line.env.ts）とはチャネル・環境変数を完全分離（既存無改修）。
import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import { logMasked } from '../../mask';
import { verifyLineSignature } from './line';
import type { LineReplyMessage } from './driverline';

// 署名検証（env版）。DRIVER_LINE_CHANNEL_SECRET 未設定の検証環境では true（スタブ）＋警告ログ。
export function verifyDriverSignatureEnv(rawBody: string, signature: string | null): boolean {
  const secret = env.DRIVER_LINE_CHANNEL_SECRET;
  if (!secret) {
    logMasked('driver-line/sig-skip（DRIVER_LINE_CHANNEL_SECRET未設定＝検証スタブ）');
    return true;
  }
  return verifyLineSignature(rawBody, signature, secret);
}

// QR画像URLのベース。PUBLIC_APP_BASE_URL 優先、未設定はリクエストの origin。
export function driverQrBaseUrl(requestOrigin: string): string {
  return publicEnv.PUBLIC_APP_BASE_URL || requestOrigin;
}

// 返信（検証はスタブ＝ログ。トークンがあれば Reply API。画像/テキスト混在可）。
export async function replyDriverLine(
  replyToken: string | undefined,
  messages: LineReplyMessage[]
): Promise<void> {
  const token = env.DRIVER_LINE_CHANNEL_ACCESS_TOKEN;
  if (!token || !replyToken) {
    logMasked('driver-line/reply(stub)', { count: messages.length });
    return;
  }
  const res = await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ replyToken, messages: messages.slice(0, 5) })
  });
  if (!res.ok) {
    // 実機確認時の調査用：LINE返信APIの失敗をログに残す（トークン不正・URL不達等）。PIIなし。
    const detail = (await res.text().catch(() => '')).slice(0, 200);
    logMasked('driver-line/reply-failed', { status: res.status, detail });
  }
}
