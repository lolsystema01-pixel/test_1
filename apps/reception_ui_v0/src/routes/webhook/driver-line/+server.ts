// ドライバー専用LINE（@608abcuq）webhook：署名検証 → 番号パース → QR画像メッセージ返信。
//   ステートレス（1メッセージ→1返信・FSM不要）。DB非接触。荷受人向け /webhook/line とは完全分離。
import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { parseLineEvents } from '$lib/server/channels/line';
import { buildDriverReply, type LineReplyMessage } from '$lib/server/channels/driverline';
import { verifyDriverSignatureEnv, replyDriverLine, driverQrBaseUrl } from '$lib/server/channels/driverline.env';
import { rateLimit } from '$lib/server/channels/ratelimit';
import { logMasked } from '$lib/mask';

export const POST: RequestHandler = async ({ request, url }) => {
  const raw = await request.text();
  // 署名検証（指示書指定：不正は403。SECRET未設定の検証環境はスタブ通過）
  if (!verifyDriverSignatureEnv(raw, request.headers.get('x-line-signature'))) {
    logMasked('driver-line/bad-signature');
    return new Response('bad signature', { status: 403 });
  }
  let body: unknown;
  try {
    body = JSON.parse(raw || '{}');
  } catch {
    return new Response('bad json', { status: 400 });
  }

  // 公開環境で PUBLIC_APP_BASE_URL 未設定なら 503（QRは物理配布されるため、Hostヘッダ由来URLで生成しない）
  let baseUrl: string;
  try {
    baseUrl = driverQrBaseUrl(url.origin);
  } catch {
    logMasked('driver-line/config-missing（PUBLIC_APP_BASE_URL未設定）');
    return new Response('server misconfigured', { status: 503 });
  }
  const allReplies: LineReplyMessage[] = [];
  for (const ev of parseLineEvents(body)) {
    const rl = rateLimit(`driver-line:${ev.userId}`, 30, 60_000);
    if (!rl.ok) {
      const messages: LineReplyMessage[] = [
        { type: 'text', text: '短時間に操作が多すぎます。少し時間をおいてください。' }
      ];
      await replyDriverLine(ev.replyToken, messages);
      allReplies.push(...messages);
      continue;
    }
    try {
      const { messages, canonical } = buildDriverReply(ev.text, baseUrl);
      await replyDriverLine(ev.replyToken, messages);
      // ログは問合番号を末尾4桁マスク（PII/番号全桁をログに残さない既存方針）。対象外は非PIIキーで記録
      if (canonical) logMasked('driver-line/reply', { tracking_number: canonical });
      else logMasked('driver-line/reply', { result: 'out_of_scope' });
      allReplies.push(...messages);
    } catch (e) {
      logMasked('driver-line/error', { message: e instanceof Error ? e.message : String(e) });
      const messages: LineReplyMessage[] = [
        { type: 'text', text: 'エラーが発生しました。もう一度、数字だけを送ってください。' }
      ];
      await replyDriverLine(ev.replyToken, messages);
      allReplies.push(...messages);
    }
  }
  // LINEは200のみ判定。返信内容の同梱は dev／スモーク用エコーフラグ時のみ
  //（公開エンドポイントで生成QRのURLを呼び出し元へ返さない）
  const echo = dev || env.DRIVER_LINE_DEBUG_ECHO === 'true';
  return json(echo ? { ok: true, replies: allReplies } : { ok: true }, { status: 200 });
};
