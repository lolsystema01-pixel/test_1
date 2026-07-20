// =============================================================
// 初期設定（§12.14）— 営業所新規追加時の初回のみ表示する2項目入力
//  ・完了判定＝offices.gdrive_folder_url が NULL かどうか（専用フラグ列は作らない）。
//  ・既に完了している営業所でこの画面を開いたら /home へ戻す（初回のみの画面のため）。
//  ・保存は SECURITY DEFINER 関数 save_office_init_setup 経由（offices に write policy は無い）。
//    権限は関数側が判定する（hq=常時／area=自営業所かつ初回のみ）。
//  ・保存は他画面（管理者設定§12.13）と同じくブラウザ側 supabase.rpc で行う（+page.svelte）。
// =============================================================
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/** printer_model の CHECK 制約（offices_printer_model_chk）と一致させること。
 *  ※ +page.server.ts は load/actions 等の決められた名前しか export できないため、
 *    モジュール内の定数として持つ（export すると build が Invalid export で落ちる）。 */
const PRINTER_MODELS = ['Brother TD-2350', '汎用サーマル'] as const;

export const load: PageServerLoad = async ({ locals: { supabase, safeGetSession } }) => {
  const { session, user } = await safeGetSession();
  if (!session || !user) throw redirect(303, '/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, office_code')
    .eq('user_id', user.id)
    .maybeSingle();

  // area（自営業所）が対象。hq は管理者設定（§12.13）で編集する。
  if (!profile || profile.role !== 'area' || !profile.office_code) {
    throw redirect(303, '/incomplete');
  }

  const { data: office, error } = await supabase
    .from('offices')
    .select('office_code, office_name, gdrive_folder_url, printer_model')
    .eq('office_code', profile.office_code)
    .maybeSingle();

  // 取得失敗は握りつぶさない（office_home_v0 の規約）。
  // 「未完だから表示」と「取得できなかった」を取り違えると、初回設定を促せない。
  if (error) {
    return {
      officeCode: profile.office_code,
      officeName: profile.office_code,
      printerModel: null as string | null,
      printerModels: PRINTER_MODELS,
      loadError: error.message as string | null
    };
  }

  // 既に完了している＝この画面は出さない（初回のみ）。再編集は §12.13。
  if (office?.gdrive_folder_url) throw redirect(303, '/home');

  return {
    officeCode: office?.office_code ?? profile.office_code,
    officeName: office?.office_name ?? profile.office_code,
    printerModel: office?.printer_model ?? null,
    printerModels: PRINTER_MODELS,
    loadError: null as string | null
  };
};
