// =============================================================
// 仕分けナビ ホーム（保護ページ）：当日一括取得
//  ・area ロール＋自営業所が前提（違えば /incomplete）。
//  ・index_today（採番一式の成果物）を一括取得＝自営業所・当日・全ドライバー（RLS委譲）。
//  ・分類用に deliveries_today（status付き）も一括取得（保留/対象外/担当者不明）。
//  ・以降の照会はクライアント側のブラウザ内参照で解決する（照会400ms未満の土台）。
//  ・DBへは一切書き込まない（書き込みRLS未整備のため・指示書の範囲外）。
// =============================================================
import { redirect } from '@sveltejs/kit';
import { fetchAllRows } from '$lib/fetchAllRows';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals: { supabase, safeGetSession } }) => {
  const { session, user } = await safeGetSession();
  if (!session || !user) {
    throw redirect(303, '/login');
  }

  // 自分の profiles（RLS: profiles_self）
  const { data: profile } = await supabase
    .from('profiles')
    .select('role, office_code')
    .eq('user_id', user.id)
    .maybeSingle();

  // 営業所(area)＋自営業所が無ければ権限なしへ
  if (!profile || profile.role !== 'area' || !profile.office_code) {
    throw redirect(303, '/incomplete');
  }

  // ① 当日一括取得：問合Index（自営業所・当日・全ドライバー）。RLSが範囲を絞る。全件ページング。
  type IndexRow = {
    tracking_number: string;
    driver_id: string | null;
    delivery_order: number | null;
    basket_code: string;
    common_id: string | null;
    address: string | null;
    time_window: string | null;
  };
  const idx = await fetchAllRows<IndexRow>((f, t) =>
    supabase
      .from('index_today')
      .select('tracking_number, driver_id, delivery_order, basket_code, common_id, address, time_window')
      .order('tracking_number', { ascending: true })
      .range(f, t)
  );

  // ② 分類用：当日の自営業所荷物（status付き）。保留/対象外/担当者不明 の判別に使う。全件ページング。
  type TodayRow = { tracking_number: string; status: string; driver_id: string | null };
  const tod = await fetchAllRows<TodayRow>((f, t) =>
    supabase
      .from('deliveries_today')
      .select('tracking_number, status, driver_id')
      .order('tracking_number', { ascending: true })
      .range(f, t)
  );

  return {
    officeCode: profile.office_code,
    email: user.email ?? null,
    index: idx.rows,
    today: tod.rows,
    loadError: idx.error ?? tod.error
  };
};
