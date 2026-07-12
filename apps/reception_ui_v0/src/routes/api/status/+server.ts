// N-6 状態取得・反映確認: GET /api/status
//   ヘッダ Authorization: Bearer <token>。
//   ・配送状況・市レベルは実DB（delivery_status_public・anon・非PII）／env未設定はダミー。
//   ・受付サマリは N-6ファサード（get_reception_public・非PII）経由。live/fallback とも
//     receiptNo/type/desiredDate/timeSlot/dropPlace のみ（caller_phone・memo等のPIIは返さない）。
import type { RequestHandler } from './$types';
import { trackingFromToken } from '$lib/server/store';
import { getReception } from '$lib/server/reception';
import { lookupDelivery } from '$lib/server/lookup';
import { ok, fail, bearer } from '$lib/server/respond';
import { maskTracking, logMasked } from '$lib/mask';

export const GET: RequestHandler = async ({ request }) => {
  try {
    const token = bearer(request);
    const tn = trackingFromToken(token);
    if (!tn) return fail('UNAUTHORIZED', '認証が必要です。最初からやり直してください。', 401);

    const view = await lookupDelivery(tn);
    if (!view) return fail('NOT_FOUND', '状態を取得できませんでした。', 404);

    logMasked('status/ok', { trackingNumber: tn });
    return ok({
      tracking_number_masked: maskTracking(tn),
      delivery_status: view.status,
      municipality: view.municipality,
      reception: await getReception(tn)
    });
  } catch (e) {
    logMasked('status/error', { message: e instanceof Error ? e.message : String(e) });
    return fail('INTERNAL_ERROR', '状態取得に失敗しました。', 500);
  }
};
