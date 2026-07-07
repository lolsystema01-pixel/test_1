// 入口（不在票QR/URL）。問合番号があれば ?tn= で引き継いで受付開始へ。
import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

export const load: PageLoad = ({ url }) => {
  const tn = url.searchParams.get('tn') ?? '';
  throw redirect(307, `/reception/tracking${tn ? `?tn=${encodeURIComponent(tn)}` : ''}`);
};
