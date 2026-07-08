// QR生成の単体テスト：生成PNGを実際にデコードして中身＝正準値の一致を実証（合格条件2）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQrParam, generateQrPng } from '../src/lib/server/qr';
import { readBarcodes } from 'zxing-wasm/reader';

// --- parseQrParam（ルートパラメータ検証） ---
test('正準形式 KAZ+10〜14桁.png を受理する', () => {
  assert.equal(parseQrParam('KAZ90000000001.png'), 'KAZ90000000001');
  assert.equal(parseQrParam('KAZ9000000001.png'), 'KAZ9000000001'); // 10桁
});
test('形式不正は null（→ルートが400を返す）', () => {
  assert.equal(parseQrParam('KAZ123.png'), null);             // 桁足らず
  assert.equal(parseQrParam('KAZ900000000000015.png'), null); // 桁超過
  assert.equal(parseQrParam('kaz90000000001.png'), null);     // 小文字（正準値はKAZ固定）
  assert.equal(parseQrParam('ABC90000000001.png'), null);     // 接頭辞違い
  assert.equal(parseQrParam('KAZ90000000001'), null);         // .png無し
  assert.equal(parseQrParam('KAZ9000000a001.png'), null);     // 非数字
});

// --- generateQrPng（生成→デコード一致） ---
test('生成したQR PNGをデコードすると中身が正準値と一致する', async () => {
  const canonical = 'KAZ90000000001';
  const png = await generateQrPng(canonical);
  assert.ok(png.length > 100, 'PNGバイナリが生成される');
  assert.deepEqual([...png.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], 'PNGシグネチャ');
  const results = await readBarcodes(new Blob([new Uint8Array(png)]), {
    formats: ['QRCode'], tryHarder: true, maxNumberOfSymbols: 1
  });
  assert.equal(results.length, 1, 'QRが1個読める');
  assert.equal(results[0].text, canonical, 'デコード値＝KAZ＋送った数字');
});
