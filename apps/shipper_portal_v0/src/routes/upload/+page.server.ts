// CSVアップロード画面のガード：荷主ロールのみ。表示用に荷主名称を返す。
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals: { supabase, safeGetSession } }) => {
  const { session, user } = await safeGetSession();
  if (!session || !user) {
    throw redirect(303, '/login');
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, shipper_id')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!profile || profile.role !== 'shipper' || !profile.shipper_id) {
    throw redirect(303, '/incomplete');
  }

  const { data: shipper } = await supabase
    .from('shippers')
    .select('shipper_name')
    .eq('shipper_id', profile.shipper_id)
    .maybeSingle();

  return {
    shipperId: profile.shipper_id,
    shipperName: shipper?.shipper_name ?? null
  };
};
