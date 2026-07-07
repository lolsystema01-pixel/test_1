// =============================================================
// 配車表PDF（仕分前／仕分後）出力ページ — 当日(対象日)×ドライバーの明細＋件数
//  ・area ロール＋自営業所が前提（違えば /incomplete）。
//  ・dispatch_sheet（明細）＋ dispatch_sheet_summary（件数）を対象日で取得。RLSで自営業所のみ。
//  ・date / mode は ?date= / ?mode= で受ける（mode: pre=仕分前 / post=仕分後）。
// =============================================================
import { redirect } from '@sveltejs/kit';
import { fetchAllRows } from '$lib/fetchAllRows';
import type { PageServerLoad } from './$types';

type SheetRow = {
  driver_id: string | null;
  delivery_order: number | null;
  basket_code: string | null;
  tracking_number: string;
  address: string | null;
  recipient_name: string | null;
  time_window: string | null;
  status: string | null;
  is_sorted: boolean | null;
};

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
  const mode = url.searchParams.get('mode') === 'post' ? 'post' : 'pre';

  // 明細は当日全ドライバー分（1000件超あり）→ 全件ページング。tracking_number でも並べて安定化。
  const { rows, error: rowsError } = await fetchAllRows<SheetRow>((f, t) =>
    supabase
      .from('dispatch_sheet')
      .select('driver_id, delivery_order, basket_code, tracking_number, address, recipient_name, time_window, status, is_sorted')
      .eq('delivery_date', date)
      .order('driver_id', { ascending: true })
      .order('delivery_order', { ascending: true })
      .order('tracking_number', { ascending: true })
      .range(f, t)
  );

  const { data: summary } = await supabase
    .from('dispatch_sheet_summary')
    .select('driver_id, total, sorted, unsorted')
    .eq('delivery_date', date)
    .order('driver_id', { ascending: true });

  return {
    officeCode: profile.office_code,
    date,
    mode,
    rows,
    summary: summary ?? [],
    loadError: rowsError
  };
};
