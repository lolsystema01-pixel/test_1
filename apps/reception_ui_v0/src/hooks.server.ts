// 公開ゲート（PR #1 マージ後レビュー対応）：
//   検証本番（Netlify等・dev以外）では「ドライバーQR関連」だけを公開し、
//   受付UI・荷受人/SMS/電話チャネルは RECEPTION_UI_PUBLIC=true を設定するまで 404 を返す。
//   ・受付側はインメモリダミー＋レート制限がサーバレスで弱まるため、公開の可否を明示的に選ばせる。
//   ・ローカル: `npm run dev` は常に全開。`vite preview` は .env に RECEPTION_UI_PUBLIC=true で全開。
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import type { Handle } from '@sveltejs/kit';

// 公開を許可するパス（QR画像配信・ドライバー用webhookのみ）
const PUBLIC_PATHS = [/^\/qr\/[^/]+$/, /^\/webhook\/driver-line\/?$/];

export const handle: Handle = async ({ event, resolve }) => {
  const path = event.url.pathname;
  const open = dev || env.RECEPTION_UI_PUBLIC === 'true' || PUBLIC_PATHS.some((re) => re.test(path));
  if (!open) return new Response('Not Found', { status: 404 });
  return resolve(event);
};
