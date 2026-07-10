// =============================================================
// 【一時ページ】Storage RLS 実機確認（指示書 認証・権限 残課題 v1.1 ③ チェックリスト B-1）
//  ・SQLでは通らない Storage API 経路で「自営業所は読める／他営業所は読めない」を確認する。
//  ・area ロール＋自営業所が前提（違えば /incomplete）。読み取りのみ・書き込みはしない。
//  ・確認が終わったらこのルートごと削除してよい。
// =============================================================
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals: { supabase, safeGetSession } }) => {
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

  return { officeCode: profile.office_code as string };
};
