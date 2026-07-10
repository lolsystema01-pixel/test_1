// HTTPスモーク（driver-line QR）：previewを署名付きモードで起動し、実HTTPで合格条件を検証。
//   前提: npm run build 済み。ポート4173。ダミー帯番号のみ使用。
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { readBarcodes } from 'zxing-wasm/reader';

const BASE = 'http://localhost:4173';
const SECRET = 'smoke-test-secret';
const results = [];
const check = (name, ok) => { results.push([name, ok]); console.log(`${ok ? '✅' : '❌'} ${name}`); };

const sign = (body) => crypto.createHmac('sha256', SECRET).update(body, 'utf8').digest('base64');
const lineBody = (text) => JSON.stringify({
  events: [{ type: 'message', source: { userId: 'U-smoke' }, message: { type: 'text', text } }]
});
const postSigned = (body, sig) => fetch(`${BASE}/webhook/driver-line`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-line-signature': sig ?? sign(body) },
  body
});

// preview起動（署名必須モード＋ベースURL固定）
const server = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], {
  cwd: new URL('..', import.meta.url).pathname,
  env: { ...process.env, DRIVER_LINE_CHANNEL_SECRET: SECRET, PUBLIC_APP_BASE_URL: BASE, DRIVER_LINE_DEBUG_ECHO: 'true' },
  stdio: 'ignore'
});
try {
  // 起動待ち（最大10秒）
  let up = false;
  for (let i = 0; i < 20 && !up; i++) {
    await new Promise((r) => setTimeout(r, 500));
    up = await fetch(BASE).then((r) => r.ok || r.status < 500).catch(() => false);
  }
  if (!up) throw new Error('preview server did not start');

  // 1) /qr 正準番号 → 200 image/png ＋ デコード一致
  const qr = await fetch(`${BASE}/qr/KAZ90000000001.png`);
  check('/qr 正準番号→200', qr.status === 200);
  check('/qr content-type=image/png', (qr.headers.get('content-type') ?? '').includes('image/png'));
  const buf = new Uint8Array(await qr.arrayBuffer());
  const decoded = await readBarcodes(new Blob([buf]), { formats: ['QRCode'], tryHarder: true });
  check('/qr デコード値=KAZ90000000001', decoded[0]?.text === 'KAZ90000000001');

  // 2) /qr 形式不正 → 400
  check('/qr 桁不足→400', (await fetch(`${BASE}/qr/KAZ123.png`)).status === 400);
  check('/qr 非数字→400', (await fetch(`${BASE}/qr/KAZabcdefghijk.png`)).status === 400);

  // 3) webhook 正署名＋受理番号 → 200・画像メッセージにqr URL
  const okBody = lineBody('90000000001');
  const r1 = await postSigned(okBody);
  const j1 = await r1.json();
  check('webhook 受理→200', r1.status === 200);
  check('webhook 画像URL=/qr/KAZ90000000001.png',
    j1.replies?.[0]?.type === 'image' && j1.replies[0].originalContentUrl === `${BASE}/qr/KAZ90000000001.png`);

  // 4) webhook 正署名＋対象外テキスト → ガイド文（QRは返さない）
  const r2 = await postSigned(lineBody('こんにちは'));
  const j2 = await r2.json();
  check('webhook 対象外→ガイド文', j2.replies?.length === 1 && j2.replies[0].type === 'text');

  // 5) webhook 全角数字 → 正規化して受理
  const r3 = await postSigned(lineBody('９００００００００２２'));
  const j3 = await r3.json();
  check('webhook 全角→正規化受理', j3.replies?.[0]?.originalContentUrl === `${BASE}/qr/KAZ90000000022.png`);

  // 6) webhook 署名不正 → 403
  const r4 = await postSigned(okBody, 'invalid-signature==');
  check('webhook 署名不正→403', r4.status === 403);
} finally {
  server.kill();
}

const pass = results.filter(([, ok]) => ok).length;
console.log(`\nPASS ${pass}/${results.length}`);
process.exit(pass === results.length ? 0 : 1);
