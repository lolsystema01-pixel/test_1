// =============================================================
// /incomplete … area ロール／所属営業所が未設定のときの案内。
//  ・hq（本部/管理者）がここに迷い込んだ場合に備え、管理者設定への出口を出す。
//    （hq は営業所ホームを持たないため、area 前提のページからここへ飛ぶことがある）
// =============================================================
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals: { supabase, safeGetSession } }) => {
  const { session, user } = await safeGetSession();
  if (!session || !user) return { role: null as string | null };

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();

  return { role: (profile?.role as string | null) ?? null };
};
