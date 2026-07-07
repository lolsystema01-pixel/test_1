// Google OAuth コールバック：認可コードをセッションに交換して確立する。
import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, locals: { supabase } }) => {
  const code = url.searchParams.get('code');
  const next = url.searchParams.get('next') ?? '/';

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // 相対パスのみ許可（オープンリダイレクト防止）
      const dest = next.startsWith('/') ? next : '/';
      throw redirect(303, dest);
    }
  }

  // コードが無い／交換失敗 → ログインへ（エラー表示用フラグ付き）
  throw redirect(303, '/login?error=auth');
};
