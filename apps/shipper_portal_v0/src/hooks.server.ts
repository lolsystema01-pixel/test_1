// =============================================================
// SvelteKit サーバーフック（荷主ポータル）
//  ・リクエストごとに Supabase サーバークライアント（anonキー）を作る。
//  ・Cookie にセッションを載せ替え、サーバー/クライアント間でセッションを取り回す。
//  ・認証ガード：未ログインは /login へ。公開ルート(/login, /auth/*)は素通り。
//  ※ anonキーのみ（フロント＝RLS委譲・要件定義 11.3）。
//    service role を使うのは /api/v1/imports のサーバ処理だけ（$lib/server）。
// =============================================================
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { type Handle, redirect } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$lib/supabaseEnv';

const supabase: Handle = async ({ event, resolve }) => {
  event.locals.supabase = createServerClient(
    PUBLIC_SUPABASE_URL,
    PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll: () => event.cookies.getAll(),
        setAll: (cookiesToSet: { name: string; value: string; options: CookieOptions }[]) => {
          cookiesToSet.forEach(({ name, value, options }) => {
            event.cookies.set(name, value, { ...options, path: '/' });
          });
        }
      }
    }
  );

  // getSession() だけだと Cookie の中身を検証しない。
  // getUser() で Supabase Auth サーバーに問い合わせて JWT を検証してから返す。
  event.locals.safeGetSession = async () => {
    const {
      data: { session }
    } = await event.locals.supabase.auth.getSession();
    if (!session) {
      return { session: null, user: null };
    }

    const {
      data: { user },
      error
    } = await event.locals.supabase.auth.getUser();
    if (error) {
      // JWT 検証に失敗＝壊れた/期限切れセッション扱い
      return { session: null, user: null };
    }

    return { session, user };
  };

  return resolve(event, {
    filterSerializedResponseHeaders(name) {
      return name === 'content-range' || name === 'x-supabase-api-version';
    }
  });
};

const authGuard: Handle = async ({ event, resolve }) => {
  const { session, user } = await event.locals.safeGetSession();
  event.locals.session = session;
  event.locals.user = user;

  const path = event.url.pathname;
  // 公開ルート：ログイン画面と 認証コールバック/サインアウトのみ
  const isPublicRoute = path === '/login' || path.startsWith('/auth');

  // 未ログインで保護ページ → ログインへ（合格条件：ガード）
  if (!session && !isPublicRoute) {
    throw redirect(303, '/login');
  }

  // ログイン済みでログイン画面 → ホームへ
  if (session && path === '/login') {
    throw redirect(303, '/');
  }

  return resolve(event);
};

export const handle: Handle = sequence(supabase, authGuard);
