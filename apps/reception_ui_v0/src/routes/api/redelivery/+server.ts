// N-4 受付登録 ＋ N-5 二重受付チェック: POST /api/redelivery
//   ヘッダ Authorization: Bearer <token>（N-3で取得）。body＝受付内容。
//   ・トークンから問合番号を解決（body の番号は信用しない＝なりすまし防止）。
//   ・サーバ側でも D章バリデーションを再実行（多層防御）。
//   ・既存受付があり overwrite=false なら 409（二重受付警告）。
import type { RequestHandler } from './$types';
import { trackingFromToken } from '$lib/server/store';
import { submitReception } from '$lib/server/reception';
import { validateAll, needsDateTime, needsDropPlace } from '$lib/validation';
import { ok, fail, bearer, todayLocal } from '$lib/server/respond';
import { logMasked } from '$lib/mask';

export const POST: RequestHandler = async ({ request }) => {
  try {
    const token = bearer(request);
    const tn = trackingFromToken(token);
    if (!tn) return fail('UNAUTHORIZED', '認証が必要です。最初からやり直してください。', 401);

    const body = (await request.json().catch(() => ({}))) as {
      type?: string;
      desiredDate?: string;
      timeSlot?: string;
      dropPlace?: string;
      memo?: string;
      overwrite?: boolean;
    };

    // サーバ側バリデーション（分岐に応じた必須）
    const errors = validateAll(
      {
        receptionType: body.type,
        desiredDate: body.desiredDate,
        timeSlot: body.timeSlot,
        dropPlace: body.dropPlace,
        memo: body.memo
      },
      todayLocal()
    );
    if (Object.keys(errors).length > 0) {
      return fail('VALIDATION_ERROR', '入力内容に誤りがあります。', 400);
    }

    // memo は v0.2 で reception_requests.memo に保存される（LOL指摘・レビューHIGH-1対応。
    //   500字上限はDB側で強制・非PIIサマリ（get_reception_public）には出ない＝§4の設計どおり）。
    const r = await submitReception(
      tn,
      {
        type: body.type as string,
        desiredDate: needsDateTime(body.type) ? body.desiredDate : undefined,
        timeSlot: needsDateTime(body.type) ? body.timeSlot : undefined,
        dropPlace: needsDropPlace(body.type) ? body.dropPlace : undefined,
        memo: body.memo?.trim() ? body.memo.trim() : undefined
      },
      { overwrite: body.overwrite === true, channel: 'web' }
    );

    if (!r.ok && r.duplicate) {
      logMasked('redelivery/duplicate', { trackingNumber: tn });
      // N-5：二重受付。クライアントは確認のうえ overwrite=true で再送できる。
      return fail('DUPLICATE_RECEPTION', `この問合番号はすでに受付済みです（受付番号 ${r.existing?.receiptNo}・${r.existing?.type}）。上書きしますか？`, 409);
    }
    if (!r.ok) {
      logMasked('redelivery/failed', { trackingNumber: tn });
      return fail('INTERNAL_ERROR', '受付に失敗しました。時間をおいて再度お試しください。', 500);
    }

    logMasked('redelivery/ok', { trackingNumber: tn, type: body.type });
    return ok({ receiptNo: r.receiptNo, type: body.type });
  } catch (e) {
    logMasked('redelivery/error', { message: e instanceof Error ? e.message : String(e) });
    return fail('INTERNAL_ERROR', '受付に失敗しました。時間をおいて再度お試しください。', 500);
  }
};
