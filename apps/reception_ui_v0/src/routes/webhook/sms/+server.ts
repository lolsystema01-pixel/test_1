// N-8 SMS Webhook（双方向）：受信SMS(From,Body)→会話FSM→返信SMS。最小は送信(OTP/通知)だが双方向も対応。
//   送信単体は sms.ts（sendSms/sendOtp）。本endpointはプロバイダからの inbound を受ける枠。
import type { RequestHandler } from './$types';
import { rateLimit } from '$lib/server/channels/ratelimit';
import { getSession, setSession } from '$lib/server/channels/session';
import { advance } from '$lib/server/channels/fsm';
import { fsmServices } from '$lib/server/channels/services';
import { sendSms } from '$lib/server/channels/sms';
import { ok, fail } from '$lib/server/respond';
import { logMasked } from '$lib/mask';

export const POST: RequestHandler = async ({ request }) => {
  // プロバイダ仕様に合わせて form/json 両対応（Twilio は form）。
  let from = '';
  let bodyText = '';
  const ct = request.headers.get('content-type') ?? '';
  try {
    if (ct.includes('application/json')) {
      const j = (await request.json()) as { from?: string; From?: string; body?: string; Body?: string };
      from = (j.from ?? j.From ?? '').trim();
      bodyText = (j.body ?? j.Body ?? '').trim();
    } else {
      const f = await request.formData();
      from = String(f.get('From') ?? f.get('from') ?? '').trim();
      bodyText = String(f.get('Body') ?? f.get('body') ?? '').trim();
    }
  } catch {
    return fail('VALIDATION_ERROR', 'リクエストを解釈できませんでした。', 400);
  }
  if (!from) return fail('VALIDATION_ERROR', '送信元が不明です。', 400);

  const rl = rateLimit(`sms:${from}`, 20, 60_000);
  if (!rl.ok) {
    await sendSms(from, '短時間の操作が多すぎます。時間をおいてください。', 'ratelimit');
    return ok({ accepted: false });
  }

  try {
    const session = getSession('sms', from);
    const { session: next, replies } = await advance(session, bodyText, fsmServices);
    setSession('sms', from, next);
    await sendSms(from, replies.join('\n'), 'reply');
    return ok({ accepted: true, replies }); // replies はローカル確認用（実SMSは sendSms 経由）

  } catch (e) {
    logMasked('sms/error', { message: e instanceof Error ? e.message : String(e) });
    return fail('INTERNAL_ERROR', '処理に失敗しました。', 500);
  }
};
