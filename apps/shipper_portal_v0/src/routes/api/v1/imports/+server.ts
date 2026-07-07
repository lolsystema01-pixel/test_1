// =============================================================
// POST /api/v1/imports … 荷主CSVアップロード取込（7.2 / 6.1・API契約v0 2.1）
//  ★ service_role を使わない。ログイン荷主自身の JWT で動く（locals.supabase）。
//    実際の書込みは DB の SECURITY DEFINER 関数 shipper_import_deliveries が行い、
//    shipper_id を my_shipper() に固定＝自社の荷物しか登録できない。
//    deliveries の RLS は SELECT 専用のまま（書込みRLSポリシーは足さない）。
//  ・取込：import_v0 準拠（問合番号で重複排除・status=未配車・取込バッチID）。
//  ・統一エラー形式（API契約v0 1.5）。
// =============================================================
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { preprocessImport, type CanonicalRow } from '$lib/importCore';

function errorResponse(code: string, message: string, status: number, details?: unknown) {
  return json({ error: { code, message, ...(details ? { details } : {}) } }, { status });
}

export const POST: RequestHandler = async ({ request, locals: { supabase, safeGetSession } }) => {
  // 1) 認証（セッション検証）
  const { session, user } = await safeGetSession();
  if (!session || !user) {
    return errorResponse('UNAUTHENTICATED', 'ログインが必要です。', 401);
  }

  // 2) 入力（クライアントが列マッピング済みの正準行を送る）
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse('VALIDATION_ERROR', 'JSON ボディを解釈できませんでした。', 400);
  }
  const rows = (body as { rows?: unknown })?.rows;
  if (!Array.isArray(rows)) {
    return errorResponse('VALIDATION_ERROR', 'rows（配列）が必要です。', 400);
  }
  if (rows.length === 0) {
    return errorResponse('VALIDATION_ERROR', '取込対象の行がありません。', 422);
  }

  // 3) 前処理（検証・CSV内重複排除・日付パース）。shipper_id はここでは扱わない。
  const { rows: importRows, counts, errors } = preprocessImport(rows as CanonicalRow[]);

  // 4) 取込（ユーザーJWTで SECURITY DEFINER 関数を呼ぶ＝自社のみ・重複排除はDB側）
  const { data, error } = await supabase.rpc('shipper_import_deliveries', { p_rows: importRows });

  if (error) {
    // 関数内 raise（42501＝shipper以外）は PostgREST が 403 に変換。code でも判定。
    if (error.code === '42501' || error.code === 'PGRST301') {
      return errorResponse('FORBIDDEN', '荷主アカウントではありません。', 403);
    }
    return errorResponse('INTERNAL_ERROR', `取込に失敗しました：${error.message}`, 500);
  }

  const result = (data ?? {}) as { batch_id?: string; shipper_id?: string; inserted?: number };
  const inserted = result.inserted ?? 0;

  // 5) 結果（取込/重複除外/エラー件数）を返す
  return json(
    {
      data: {
        batch_id: result.batch_id ?? null,
        shipper_id: result.shipper_id ?? null,
        csv_rows: counts.csv_rows,
        valid_rows: counts.valid_rows,
        unique_in_csv: counts.unique_in_csv,
        csv_internal_dup_excluded: counts.csv_internal_dup_excluded,
        inserted,
        existing_dup_skipped: counts.unique_in_csv - inserted,
        error_count: errors.length,
        errors
      }
    },
    { status: 201 }
  );
};
