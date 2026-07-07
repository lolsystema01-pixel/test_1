// =============================================================
// ホーム＝配送一覧（§8.3）：自分のドライバーprofile ＋ 当日担当荷物を配達順に表示
//  ・全て Supabase直＋RLS。anonキーのまま RLS が行を絞る。
//  ・荷物は driver_id で明示フィルタしない → RLS(deliveries_driver)に委譲。
//    これにより「他ドライバーの担当荷物は0件」が自然に成立する（合格条件）。
//  ・対象日(delivery_date)で絞り、配達順(delivery_order)で昇順。読み取り専用。
//  ・未オンボーディング（role≠driver / driver_id未設定）は /incomplete へ。
// =============================================================
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals: { supabase, safeGetSession }, url }) => {
  const { session, user } = await safeGetSession();
  if (!session || !user) {
    // 基本は hooks のガードで弾かれるが、保険
    throw redirect(303, '/login');
  }

  // ① 自分の profiles 行（RLS: profiles_self → 自分の1行のみ）
  const { data: profile } = await supabase
    .from('profiles')
    .select('role, office_code, driver_id')
    .eq('user_id', user.id)
    .maybeSingle();

  // ② 未オンボーディング判定：ロール未設定 or ドライバーID未設定
  if (!profile || profile.role !== 'driver' || !profile.driver_id) {
    throw redirect(303, '/incomplete');
  }

  // ③ 自分のドライバーprofile（RLS: drivers_self → 自分の1行のみ）
  const { data: driver } = await supabase
    .from('drivers')
    .select('driver_id, driver_name, office_code, registration_status')
    .eq('driver_id', profile.driver_id)
    .maybeSingle();

  // ④ 当日担当荷物（RLS: deliveries_driver）。driver_id は明示せず RLS に委譲。
  //    対象日(既定=今日)で絞り、配達順で昇順。
  const date = url.searchParams.get('date') ?? new Date().toISOString().slice(0, 10);
  const { data: deliveries, error: deliveriesError } = await supabase
    .from('deliveries')
    .select('tracking_number, delivery_date, address, recipient_name, status, delivery_order, basket_code, time_window')
    .eq('delivery_date', date)
    .order('delivery_order', { ascending: true, nullsFirst: false });

  return {
    profile,
    driver,
    // 所属営業所：driver ロールには offices の RLS が無いため office_name は取得せず
    // office_code のみ表示（profiles / drivers いずれからでも取れる）。
    officeCode: profile.office_code ?? driver?.office_code ?? null,
    email: user.email ?? null,
    date,
    deliveries: deliveries ?? [],
    deliveriesError: deliveriesError?.message ?? null
  };
};
