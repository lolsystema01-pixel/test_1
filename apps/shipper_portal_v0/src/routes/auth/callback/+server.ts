// 認証コールバック：マジックリンク/メール確認のトークンをセッションに交換して確立する。
//  ・PKCE フロー（?code=…）        → exchangeCodeForSession
//  ・メールOTP（?token_hash=&type=）→ verifyOtp
//  どちらの形でリンクが来ても確立できるよう両対応にする。
import { redirect } from '@sveltejs/kit';
import type { EmailOtpType } from '@supabase/supabase-js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, locals: { supabase } }) => {
  const code = url.searchParams.get('code');
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type') as EmailOtpType | null;
  const next = url.searchParams.get('next') ?? '/';
  const dest = next.startsWith('/') ? next : '/'; // 相対パスのみ（オープンリダイレクト防止）

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) throw redirect(303, dest);
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (!error) throw redirect(303, dest);
  }

  // トークンが無い／交換失敗 → ログインへ（エラー表示用フラグ付き）
  throw redirect(303, '/login?error=auth');
};
