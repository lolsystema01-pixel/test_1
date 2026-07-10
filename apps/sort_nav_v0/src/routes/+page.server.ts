// =============================================================
// ルート / … ロール別の入口へ振り分ける。
//  ・hq（本部/管理者）→ /admin/settings（§12.13）。hq は営業所ホームを持たないため。
//  ・area（営業所）    → /home（営業所ホーム）。
//  ・未ログイン        → /login。
//  ・その他のロール    → /home（そこで /incomplete に振られる）。
//  ・仕分けナビ（スキャン画面）は /sort。
// =============================================================
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals: { supabase, safeGetSession } }) => {
  const { session, user } = await safeGetSession();
  if (!session || !user) throw redirect(303, '/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();

  if (profile?.role === 'hq') throw redirect(307, '/admin/settings');
  throw redirect(307, '/home');
};
