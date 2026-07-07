// サーバー/ブラウザ両対応の Supabase クライアントを作る（anonキー）。
//  ・ブラウザ：createBrowserClient（document.cookie を使う）
//  ・サーバー：createServerClient（+layout.server.ts が渡した Cookie を使う）
import { createBrowserClient, createServerClient, isBrowser } from '@supabase/ssr';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$lib/supabaseEnv';
import type { LayoutLoad } from './$types';

export const load: LayoutLoad = async ({ data, depends, fetch }) => {
  // onAuthStateChange でこの依存を無効化し、セッション変化を全体へ反映する。
  depends('supabase:auth');

  const supabase = isBrowser()
    ? createBrowserClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
        global: { fetch }
      })
    : createServerClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
        global: { fetch },
        cookies: {
          getAll: () => data.cookies
        }
      });

  const {
    data: { session }
  } = await supabase.auth.getSession();

  const {
    data: { user }
  } = await supabase.auth.getUser();

  return { supabase, session, user };
};
