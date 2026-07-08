// GET /qr/KAZ<数字>.png：QR画像のオンザフライ生成。
//   DB非接触・無認証（QRの中身＝URL中の番号そのもの＝新情報を足さない）。Storage保存なし。
import type { RequestHandler } from './$types';
import { parseQrParam, generateQrPng } from '$lib/server/qr';

export const GET: RequestHandler = async ({ params }) => {
  const canonical = parseQrParam(params.number);
  if (!canonical) return new Response('bad number', { status: 400 });
  const png = await generateQrPng(canonical);
  return new Response(new Uint8Array(png), {
    status: 200,
    headers: {
      'content-type': 'image/png',
      'cache-control': 'public, max-age=86400' // 同一番号は不変＝キャッシュ可
    }
  });
};
