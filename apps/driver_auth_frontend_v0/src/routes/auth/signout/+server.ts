// ログアウト：セッションを破棄してログインへ戻す。
// ホーム／登録未完了ページの <form method="POST" action="/auth/signout"> から呼ばれる。
import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals: { supabase } }) => {
  await supabase.auth.signOut();
  throw redirect(303, '/login');
};
