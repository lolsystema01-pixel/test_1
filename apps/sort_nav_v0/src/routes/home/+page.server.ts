// =============================================================
// 営業所ホーム 概況カード（§12.0.1）— 初期ロード（対象日×自営業所）
//  ・area ロール＋自営業所が前提（違えば /incomplete）。
//  ・office_home_summary（RLSで自営業所のみ）を対象日で1枚取得。
//  ・以降の更新（Realtime／手動）はブラウザ側 supabase で再取得（+page.svelte）。
//  ・date は ?date= で受ける（既定=today）。
// =============================================================
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export type OfficeHomeCard = {
  office_code: string;
  delivery_date: string;
  received: number;
  real_drivers: number;
  real_items: number;
  virt_drivers: number;
  virt_items: number;
  dispatched_items: number;
  sorted_items: number;
  last_dispatch_at: string | null;
  last_import_at: string | null;
  need_repredict: boolean;
  state_line: string;
  state_color: string;
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

  // 既定はローカル日付（toISOString=UTCだとJST早朝に前日へズレ、クイック選択が二重点灯する）
  const now = new Date();
  const localToday = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const date = url.searchParams.get('date') ?? localToday;

  const { data: card } = await supabase
    .from('office_home_summary')
    .select('*')
    .eq('office_code', profile.office_code)
    .eq('delivery_date', date)
    .maybeSingle();

  // 稼働人数（対象日・承認済み・area RLSで自営業所ドライバーのみ）§12.0.3 セクション1
  const { data: sched } = await supabase
    .from('work_schedules')
    .select('driver_id')
    .eq('work_date', date)
    .eq('application_status', '承認');
  const headcount = sched ? new Set(sched.map((r) => r.driver_id)).size : 0;

  return {
    officeCode: profile.office_code as string,
    date,
    card: (card as OfficeHomeCard | null) ?? null,
    headcount
  };
};
