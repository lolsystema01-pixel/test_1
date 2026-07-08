// =============================================================
// ルート / … 起動時は営業所ホーム(/home)へ。
//  ・仕分けナビ（スキャン画面）は /sort に移動。
//  ・未ログインは /home 側で /login にリダイレクトされる。
// =============================================================
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  throw redirect(307, '/home');
};
