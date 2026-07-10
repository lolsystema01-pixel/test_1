// =============================================================
// 営業所ホーム 概況カード（§12.0.1）— 初期ロード（対象日×自営業所）
//  ・area ロール＋自営業所が前提（違えば /incomplete）。
//  ・office_home_summary（RLSで自営業所のみ）を対象日で1枚取得。
//  ・以降の更新（Realtime／手動）はブラウザ側 supabase で再取得（+page.svelte）。
//  ・date は ?date= で受ける（既定=JSTの今日。実行環境TZに依存させない）。
//  ・取得失敗は loadError で返す。「データ無し(緑)」と「取得失敗」を画面で区別するため
//    （状態行は業務判断に使うので、握りつぶして完了色を出さない）。
// =============================================================
import { redirect } from '@sveltejs/kit';
import { todayJst } from '$lib/jstDate';
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

  // 既定は「JSTの今日」。実行環境(UTC/ローカル)に依存させない（クライアントの today() と一致）
  const date = url.searchParams.get('date') ?? todayJst();

  const { data: card, error: cardError } = await supabase
    .from('office_home_summary')
    .select('*')
    .eq('office_code', profile.office_code)
    .eq('delivery_date', date)
    .maybeSingle();

  // 稼働人数（対象日・承認済み・area RLSで自営業所ドライバーのみ）§12.0.3 セクション1
  const { data: sched, error: schedError } = await supabase
    .from('work_schedules')
    .select('driver_id')
    .eq('work_date', date)
    .eq('application_status', '承認');
  const headcount = schedError ? null : new Set((sched ?? []).map((r) => r.driver_id)).size;

  return {
    officeCode: profile.office_code as string,
    date,
    // 取得失敗時は card=null かつ loadError あり。画面側で「データ無し(緑)」と区別する。
    card: cardError ? null : ((card as OfficeHomeCard | null) ?? null),
    loadError: cardError?.message ?? null,
    headcount,
    headcountError: schedError?.message ?? null
  };
};
