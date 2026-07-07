// =============================================================
// GoDoor用CSV出力ページ — 自営業所×対象日×仕分済 を GoDoor Ver4.0 様式で出力
//  ・area ロール＋自営業所が前提（違えば /incomplete）。
//  ・godoor_csv ビュー（仕分済×有効ドライバー）を対象日で取得。RLSで自営業所のみ。
//  ・21列整形・サニタイズ・全体/ドライバー別・BOM・Storage はクライアント側（GAS27準拠）。
// =============================================================
import { redirect } from '@sveltejs/kit';
import { fetchAllRows } from '$lib/fetchAllRows';
import type { PageServerLoad } from './$types';

type GodoorRow = {
  driver_id: string | null;
  driver_name: string | null;
  delivery_order: number | null;
  basket_code: string | null;
  tracking_number: string;
  recipient_name: string | null;
  address: string | null;
  time_window: string | null;
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

  // 仕分済×有効ドライバーの対象行（並び・整形はクライアント側）。1000件超あり→全件ページング。
  const { rows, error: rowsError } = await fetchAllRows<GodoorRow>((f, t) =>
    supabase
      .from('godoor_csv')
      .select('driver_id, driver_name, delivery_order, basket_code, tracking_number, recipient_name, address, time_window')
      .eq('delivery_date', date)
      .order('tracking_number', { ascending: true })
      .range(f, t)
  );

  return {
    officeCode: profile.office_code,
    date,
    rows,
    loadError: rowsError
  };
};
