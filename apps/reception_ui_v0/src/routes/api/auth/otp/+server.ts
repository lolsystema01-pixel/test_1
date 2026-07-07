// N-3 認証API（OTP送信）: POST /api/auth/otp { trackingNumber }
//   問合番号が存在すればOTPを「送信」（ダミー＝固定コード）。存在しなければ404。
import type { RequestHandler } from './$types';
import { issueOtp } from '$lib/server/store';
import { lookupDelivery } from '$lib/server/lookup';
import { vTracking } from '$lib/validation';
import { ok, fail } from '$lib/server/respond';
import { logMasked } from '$lib/mask';

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = (await request.json().catch(() => ({}))) as { trackingNumber?: string };
    const tn = (body.trackingNumber ?? '').trim();
    const vmsg = vTracking(tn);
    if (vmsg) return fail('VALIDATION_ERROR', vmsg, 400);

    // 存在チェックは実DB（delivery_status_public・anon・非PII）／env未設定ならダミー。
    const found = await lookupDelivery(tn);
    if (!found) {
      logMasked('otp/not_found', { trackingNumber: tn });
      return fail('NOT_FOUND', '問合番号が見つかりません。番号をご確認ください。', 404);
    }
    const r = issueOtp(tn);
    logMasked('otp/sent', { trackingNumber: tn });
    // devCode は検証環境のダミー（実運用はSMS/メール送信で本文には出さない）。
    return ok({ sent: true, devCode: r.devCode });
  } catch (e) {
    logMasked('otp/error', { message: e instanceof Error ? e.message : String(e) });
    return fail('INTERNAL_ERROR', '送信に失敗しました。時間をおいて再度お試しください。', 500);
  }
};
