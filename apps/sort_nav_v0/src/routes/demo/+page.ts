// /demo は営業所ホームの予測対象日(?date=)を引き継ぐ（§12.0.2 日付連動）。
import type { PageLoad } from './$types';

export const load: PageLoad = ({ url }) => ({
  date: url.searchParams.get('date') ?? '2026-07-04'
});
