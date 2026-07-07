// =============================================================
// ラベル印刷ブリッジ v0.4 — ラベル/印刷ページ（内製分）
//  ・area ロール＋自営業所が前提（違えば /incomplete）。
//  ・label_payload（採番済の機種非依存ペイロード）＋ print_history（履歴）を取得。RLSで自営業所のみ。
//  ・PDF生成・ON/OFF送信フック・再印刷・バーコード枠はクライアント側（label.ts＋jsPDF）。
// =============================================================
import { redirect } from '@sveltejs/kit';
import { fetchAllRows } from '$lib/fetchAllRows';
import type { PageServerLoad } from './$types';

type PayloadRow = {
  office_code: string | null;
  delivery_date: string | null;
  driver_id: string | null;
  tracking_number: string;
  basket_code: string | null;
  delivery_order: number | null;
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

  // ラベルペイロード（採番済・自営業所）。1000件超あり→全件ページング。
  const { rows: payloads, error: payloadError } = await fetchAllRows<PayloadRow>((f, t) =>
    supabase
      .from('label_payload')
      .select('office_code, delivery_date, driver_id, tracking_number, basket_code, delivery_order')
      .eq('delivery_date', date)
      .order('driver_id', { ascending: true })
      .order('delivery_order', { ascending: true })
      .order('tracking_number', { ascending: true })
      .range(f, t)
  );

  // 印刷履歴（直近・自営業所）
  const { data: history } = await supabase
    .from('print_history')
    .select('id, printed_at, tracking_number, basket_code, delivery_order, kind, terminal_id')
    .order('printed_at', { ascending: false })
    .limit(50);

  return {
    officeCode: profile.office_code,
    date,
    payloads,
    history: history ?? [],
    payloadError: payloadError
  };
};
