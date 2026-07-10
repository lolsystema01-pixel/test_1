// =============================================================
// 管理者設定（§12.13）— 営業所別の運用設定4項目
//  ・編集は hq のみ（保存は SECURITY DEFINER 関数 update_office_settings 経由）。
//  ・area は自営業所を参照のみ（offices の select ポリシーで自営業所しか見えない）。
//  ・日常的には触らない。不具合や設定変更時のみ使用（§12.13）。
// =============================================================
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export type OfficeSetting = {
  office_code: string;
  office_name: string;
  basket_cart_limit: number | null;
  basket_order: string;
  auto_logout_enabled: boolean | null;
  auto_logout_minutes: number | null;
  printer_model: string | null;
};

export const load: PageServerLoad = async ({ locals: { supabase, safeGetSession } }) => {
  const { session, user } = await safeGetSession();
  if (!session || !user) throw redirect(303, '/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, office_code')
    .eq('user_id', user.id)
    .maybeSingle();

  // hq=全営業所を編集／area=自営業所を参照のみ。それ以外は権限なし。
  if (!profile || (profile.role !== 'hq' && profile.role !== 'area')) {
    throw redirect(303, '/incomplete');
  }

  // RLS が範囲を絞る（hq=全件／area=自営業所のみ）。明示フィルタはしない。
  const { data: offices, error } = await supabase
    .from('offices')
    .select('office_code, office_name, basket_cart_limit, basket_order, auto_logout_enabled, auto_logout_minutes, printer_model')
    .order('office_code', { ascending: true });

  return {
    role: profile.role as 'hq' | 'area',
    canEdit: profile.role === 'hq',
    offices: (offices as OfficeSetting[] | null) ?? [],
    loadError: error?.message ?? null
  };
};
