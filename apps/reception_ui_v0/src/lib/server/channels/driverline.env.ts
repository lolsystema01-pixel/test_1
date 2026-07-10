// ドライバー用LINE：env依存ラッパ（署名検証スタブ・画像返信API・baseURL解決）。
//   荷受人ボット（line.env.ts）とはチャネル・環境変数を完全分離（既存無改修）。
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import { logMasked } from '../../mask';
import { verifyLineSignature } from './line';
import type { LineReplyMessage } from './driverline';

// 署名検証（env版）。fail-closed：SECRET未設定は dev のみスタブ通過、公開環境では拒否（403）。
//   設定漏れのまま公開すると偽イベントが素通りするため、「なぜか動かない」で即表面化させる。
export function verifyDriverSignatureEnv(rawBody: string, signature: string | null): boolean {
  const secret = env.DRIVER_LINE_CHANNEL_SECRET;
  if (!secret) {
    if (!dev) {
      logMasked('driver-line/sig-fail-closed（DRIVER_LINE_CHANNEL_SECRET未設定・公開環境のため拒否）');
      return false;
    }
    logMasked('driver-line/sig-skip（dev・検証スタブ）');
    return true;
  }
  return verifyLineSignature(rawBody, signature, secret);
}

// QR画像URLのベース。公開環境では PUBLIC_APP_BASE_URL を必須にする
//   （Hostヘッダ由来のoriginを使うと、細工されたHostで返信URLを外部ホストに向けられるため）。
export function driverQrBaseUrl(requestOrigin: string): string {
  const base = publicEnv.PUBLIC_APP_BASE_URL;
  if (base) return base;
  if (!dev) throw new Error('PUBLIC_APP_BASE_URL is required in production (QR画像URLのベース)');
  return requestOrigin;
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
