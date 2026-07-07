// セッションと Cookie をクライアント側 load に引き渡す（取り回しの土台）。
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals: { session }, cookies }) => {
  return {
    session,
    cookies: cookies.getAll()
  };
};
