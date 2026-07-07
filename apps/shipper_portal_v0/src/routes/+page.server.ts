// =============================================================
// ホーム＝状況確認（7.2）：自社荷物の一覧＋ステータスを表示。
//  ・全て Supabase直＋RLS。anonキーのまま RLS(deliveries_shipper)が「自社の荷物」だけに絞る。
//    荷物は shipper_id で明示フィルタしない → RLS に委譲。
//    これにより「他社の荷物は0件」が自然に成立する（合格条件）。
//  ・荷主名称は shippers（荷主マスタ v0）から表示（shipper RLS=自社行のみ）。
//  ・未オンボーディング（role≠shipper / shipper_id未設定）は /incomplete へ。読み取り専用。
// =============================================================
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals: { supabase, safeGetSession } }) => {
  const { session, user } = await safeGetSession();
  if (!session || !user) {
    throw redirect(303, '/login'); // 保険（基本は hooks ガードで弾かれる）
  }

  // ① 自分の profiles 行（RLS: profiles_self → 自分の1行のみ）
  const { data: profile } = await supabase
    .from('profiles')
    .select('role, shipper_id')
    .eq('user_id', user.id)
    .maybeSingle();

  // ② 未オンボーディング判定：荷主ロール未設定 or 荷主ID未設定
  if (!profile || profile.role !== 'shipper' || !profile.shipper_id) {
    throw redirect(303, '/incomplete');
  }

  // ③ 自社の荷主名称（RLS: shippers_shipper → 自社行のみ）
  const { data: shipper } = await supabase
    .from('shippers')
    .select('shipper_id, shipper_name')
    .eq('shipper_id', profile.shipper_id)
    .maybeSingle();

  // ④ 自社荷物の状況（RLS: deliveries_shipper）。shipper_id は明示せず RLS に委譲。
  const { data: deliveries, error: deliveriesError } = await supabase
    .from('deliveries')
    .select('tracking_number, delivery_date, address, recipient_name, status, time_window, import_batch_id')
    .order('delivery_date', { ascending: false, nullsFirst: false })
    .order('tracking_number', { ascending: true });

  return {
    shipperId: profile.shipper_id,
    shipperName: shipper?.shipper_name ?? null,
    email: user.email ?? null,
    deliveries: deliveries ?? [],
    deliveriesError: deliveriesError?.message ?? null
  };
};
