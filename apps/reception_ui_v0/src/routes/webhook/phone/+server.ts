// N-9 電話受け口API：IVR／オペレータ入力（or 後段P3のAI音声）からの受付内容を N-4 へ funnel する枠。
//   ・本人確認は §5.2（IVR/オペレータ）で実施済み前提＝受け口はそれを信頼して登録。
//   ・読み取り（存在確認）は既存関数 lookup。登録は N-4（registerReception）。二重受付は N-5（duplicate）。
import type { RequestHandler } from './$types';
import { lookupDelivery } from '$lib/server/lookup';
import { registerReception } from '$lib/server/store';
import { rateLimit } from '$lib/server/channels/ratelimit';
import { validateAll, needsDateTime, needsDropPlace } from '$lib/validation';
import { ok, fail, todayLocal } from '$lib/server/respond';
import { logMasked } from '$lib/mask';

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      operatorId?: string;
      trackingNumber?: string;
      type?: string;
      desiredDate?: string;
      timeSlot?: string;
      dropPlace?: string;
      overwrite?: boolean;
    };
    const op = (body.operatorId ?? 'ivr').trim();
    const rl = rateLimit(`phone:${op}`, 60, 60_000);
    if (!rl.ok) return fail('RATE_LIMITED', '受け口が混み合っています。少し待って再送してください。', 429);

    const tn = (body.trackingNumber ?? '').trim();
    // 存在確認（既存 SECURITY DEFINER 関数 / env未設定はダミー）
    const found = await lookupDelivery(tn);
    if (!found) return fail('NOT_FOUND', '問合番号が見つかりません。', 404);

    // D章バリデーション（分岐に応じた必須）
    const errors = validateAll(
      { receptionType: body.type, desiredDate: body.desiredDate, timeSlot: body.timeSlot, dropPlace: body.dropPlace },
      todayLocal()
    );
    if (Object.keys(errors).length > 0) return fail('VALIDATION_ERROR', '受付内容に誤りがあります。', 400);

    const r = registerReception(
      tn,
      {
        type: body.type as string,
        desiredDate: needsDateTime(body.type) ? body.desiredDate : undefined,
        timeSlot: needsDateTime(body.type) ? body.timeSlot : undefined,
        dropPlace: needsDropPlace(body.type) ? body.dropPlace : undefined
      },
      body.overwrite === true
    );
    if (!r.ok && r.duplicate) {
      logMasked('phone/duplicate', { trackingNumber: tn });
      return fail('DUPLICATE_RECEPTION', `すでに受付済みです（受付番号 ${r.existing?.receiptNo}）。overwrite=true で上書き可。`, 409);
    }
    logMasked('phone/ok', { trackingNumber: tn, type: body.type, operatorId: op });
    return ok({ receiptNo: r.receiptNo, type: body.type });
  } catch (e) {
    logMasked('phone/error', { message: e instanceof Error ? e.message : String(e) });
    return fail('INTERNAL_ERROR', '受付に失敗しました。', 500);
  }
};
