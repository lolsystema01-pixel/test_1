// N-4/N-5：受付ファサード reception.ts のテスト（フォールバック経路＝インメモリ）。
//   非公式モード：共有SupabaseへのRPC実呼び出しはしない（.env未設定＝フォールバック固定で検証）。
//   live(RPC)経路はコードとして実装するが、ここではテストしない（実接続禁止のため）。
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { submitReception, getReception } from '../src/lib/server/reception';
import { __resetForTest } from '../src/lib/server/store';

beforeEach(() => __resetForTest());

const TN = '900000000001';

test('登録：受付番号が R- 形式で返る', async () => {
  const r = await submitReception(TN, { type: '再配達', desiredDate: '2026-07-20', timeSlot: '午前' });
  assert.equal(r.ok, true);
  assert.ok(r.receiptNo);
  assert.match(r.receiptNo!, /^R-/);
});

test('二重受付：overwriteなしは duplicate＋existing を返す', async () => {
  const first = await submitReception(TN, { type: '再配達', desiredDate: '2026-07-20', timeSlot: '午前' });
  const dup = await submitReception(TN, { type: '置き配', dropPlace: '玄関前' });
  assert.equal(dup.ok, false);
  assert.equal(dup.duplicate, true);
  assert.equal(dup.existing?.receiptNo, first.receiptNo);
  assert.equal(dup.existing?.type, '再配達');
});

test('上書き：overwrite:true で新しい内容に更新され ok になる', async () => {
  await submitReception(TN, { type: '再配達', desiredDate: '2026-07-20', timeSlot: '午前' });
  const ow = await submitReception(TN, { type: '置き配', dropPlace: '玄関前' }, { overwrite: true });
  assert.equal(ow.ok, true);
  assert.ok(ow.receiptNo);
  const cur = await getReception(TN);
  assert.equal(cur?.type, '置き配');
});

test('getReception：未登録は null', async () => {
  assert.equal(await getReception('900000000099'), null);
});
