// N-3 認証API（照合）: POST /api/auth/verify { trackingNumber, code }
//   正コードでトークン発行。失敗で残回数、上限でロック（423）。
import type { RequestHandler } from './$types';
import { verifyOtp } from '$lib/server/store';
import { vTracking, vAuthCode } from '$lib/validation';
import { ok, fail } from '$lib/server/respond';
import { logMasked } from '$lib/mask';

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = (await request.json().catch(() => ({}))) as { trackingNumber?: string; code?: string };
    const tn = (body.trackingNumber ?? '').trim();
    const code = (body.code ?? '').trim();
    const tmsg = vTracking(tn);
    if (tmsg) return fail('VALIDATION_ERROR', tmsg, 400);
    const cmsg = vAuthCode(code);
    if (cmsg) return fail('VALIDATION_ERROR', cmsg, 400);

    const r = verifyOtp(tn, code);
    if (r.ok) {
      logMasked('verify/ok', { trackingNumber: tn });
      return ok({ token: r.token });
    }
    if (r.locked) {
      logMasked('verify/locked', { trackingNumber: tn });
      return fail('AUTH_LOCKED', '認証に複数回失敗したためロックされました。しばらくしてからお試しください。', 423);
    }
    if (r.reason === 'expired') {
      return fail('AUTH_EXPIRED', '認証の有効期限が切れています。お手数ですが最初からやり直してください。', 401);
    }
    logMasked('verify/failed', { trackingNumber: tn, remaining: r.remaining });
    return fail('AUTH_FAILED', `認証コードが正しくありません。（残り${r.remaining ?? 0}回）`, 401);
  } catch (e) {
    logMasked('verify/error', { message: e instanceof Error ? e.message : String(e) });
    return fail('INTERNAL_ERROR', '認証に失敗しました。時間をおいて再度お試しください。', 500);
  }
};
