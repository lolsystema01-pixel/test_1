// =============================================================
// かご持出表PDF 出力ページ — 自営業所×対象日を ドライバー×かご記号 で集計
//  ・area ロール＋自営業所が前提（違えば /incomplete）。
//  ・basket_carry_sheet（明細）＋ basket_carry_sheet_summary（かご数/合計）を対象日で取得。
//    RLS(security_invoker)で自営業所のみ。
//  ・date は ?date= で受ける。配車表PDF(/sheet)と同じ土台。
// =============================================================
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals: { supabase, safeGetSession }, url }) => {
  const { session, user } = await safeGetSession();
  if (!session || !user) throw redirect(303, '/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, office_code')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!profile || profile.role !== 'area' || !profile.office_code) {
    throw redirect(303, '/incomplete');
  }

  const date = url.searchParams.get('date') ?? new Date().toISOString().slice(0, 10);

  // 明細：ドライバー × かご記号 → 担当個数（かご記号順）
  const { data: rows, error: rowsError } = await supabase
    .from('basket_carry_sheet')
    .select('driver_id, driver_name, basket_code, item_count')
    .eq('delivery_date', date)
    .order('driver_id', { ascending: true })
    .order('basket_code', { ascending: true, nullsFirst: false });

  // サマリ：ドライバー別 かご数 / 合計個数
  const { data: summary } = await supabase
    .from('basket_carry_sheet_summary')
    .select('driver_id, driver_name, basket_count, total_count')
    .eq('delivery_date', date)
    .order('driver_id', { ascending: true });

  return {
    officeCode: profile.office_code,
    date,
    rows: rows ?? [],
    summary: summary ?? [],
    loadError: rowsError?.message ?? null
  };
};
