// N-7 LINE Webhook：署名検証 → 会話FSMで受付フロー → 返信。読み取り=既存関数 / 登録=N-4 を流用。
import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { parseLineEvents } from '$lib/server/channels/line';
import { verifySignatureEnv, replyLine } from '$lib/server/channels/line.env';
import { rateLimit } from '$lib/server/channels/ratelimit';
import { getSession, setSession } from '$lib/server/channels/session';
import { advance } from '$lib/server/channels/fsm';
import { fsmServices } from '$lib/server/channels/services';
import { logMasked } from '$lib/mask';

export const POST: RequestHandler = async ({ request }) => {
  const raw = await request.text();
  // 署名検証（LINE_CHANNEL_SECRET 未設定の検証環境はスタブ）
  if (!verifySignatureEnv(raw, request.headers.get('x-line-signature'))) {
    logMasked('line/bad-signature');
    return new Response('bad signature', { status: 401 });
  }
  let body: unknown;
  try {
    body = JSON.parse(raw || '{}');
  } catch {
    return new Response('bad json', { status: 400 });
  }

  const allReplies: string[] = [];
  for (const ev of parseLineEvents(body)) {
    const rl = rateLimit(`line:${ev.userId}`, 30, 60_000);
    if (!rl.ok) {
      const msg = ['短時間に操作が多すぎます。少し時間をおいてください。'];
      await replyLine(ev.replyToken, msg);
      allReplies.push(...msg);
      continue;
    }
    try {
      const session = getSession('line', ev.userId);
      const { session: next, replies } = await advance(session, ev.text, fsmServices);
      setSession('line', ev.userId, next);
      await replyLine(ev.replyToken, replies);
      allReplies.push(...replies);
    } catch (e) {
      logMasked('line/error', { message: e instanceof Error ? e.message : String(e) });
      const msg = ['エラーが発生しました。「最初から」と送信してやり直してください。'];
      await replyLine(ev.replyToken, msg);
      allReplies.push(...msg);
    }
  }
  // LINE は本文を見ず 200 のみ判定（リトライ抑止）。ローカル確認用に返信文も同梱。
  return json({ ok: true, replies: allReplies }, { status: 200 });
};
