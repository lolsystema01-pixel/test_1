// N-4/N-6：reception.ts の live(RPC) 経路マッピングのテスト（スタブ client・ネットワーク不使用）。
//   非公式モード：共有Supabaseへの実接続は禁止。__setClientForTest で rpc() をスタブし、
//   register_reception / get_reception_public の jsonb 戻り値 → SubmitResult / getReception の
//   マッピングのみを検証する（Task 4レビュー指摘：この分岐に単体テストが無かったため追加）。
//   既存の reception.test.ts（フォールバック経路）は変更しない＝本ファイルは独立した新規ファイル。
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { submitReception, getReception, __setClientForTest } from '../src/lib/server/reception';

const TN = '900000000001';

// register_reception の jsonb 戻り値を模したスタブ（reception_write_v0.sql §3 準拠）
function stubRpc(result: unknown, error: unknown = null) {
  return { rpc: async (_fn: string, _args: Record<string, unknown>) => ({ data: result, error }) };
}

afterEach(() => __setClientForTest(undefined)); // 次のテスト（フォールバック等）に影響させない

// 引数キャプチャ付きスタブ（v0.2 memo配線の実引数検証用・レビューHIGH-1対応）
function stubRpcCapture(result: unknown) {
  const captured: { args?: Record<string, unknown> } = {};
  return {
    client: { rpc: async (_fn: string, args: Record<string, unknown>) => { captured.args = args; return { data: result, error: null }; } },
    captured
  };
}

test('v0.2: memoあり → p_memo がRPC実引数に渡る（フォーム→RPCの配線検証）', async () => {
  const { client, captured } = stubRpcCapture({ result: 'created', receipt_no: 'R-260724-0001', band_key: 'demo9000', verified: true, existing_receipt_no: null, existing_type: null });
  __setClientForTest(client);
  const r = await submitReception(TN, { type: '再配達', desiredDate: '2026-07-25', timeSlot: '午前', memo: '玄関前はチャイム不要でお願いします' });
  assert.equal(r.ok, true);
  assert.equal(captured.args?.p_memo, '玄関前はチャイム不要でお願いします');
});

test('v0.2: memoなし → p_memo は null（後方互換）', async () => {
  const { client, captured } = stubRpcCapture({ result: 'created', receipt_no: 'R-260724-0002', band_key: 'demo9000', verified: true, existing_receipt_no: null, existing_type: null });
  __setClientForTest(client);
  await submitReception(TN, { type: '再配達', desiredDate: '2026-07-25', timeSlot: '午前' });
  assert.equal(captured.args?.p_memo, null);
});

test('register_reception: created → ok:true + receiptNo', async () => {
  __setClientForTest(
    stubRpc({
      result: 'created',
      receipt_no: 'R-260712-0001',
      band_key: 'demo9000',
      verified: true,
      existing_receipt_no: null,
      existing_type: null
    })
  );
  const r = await submitReception(TN, { type: '再配達', desiredDate: '2026-07-20', timeSlot: '午前' });
  assert.deepEqual(r, { ok: true, receiptNo: 'R-260712-0001' });
});

test('register_reception: overwritten → ok:true + receiptNo', async () => {
  __setClientForTest(
    stubRpc({
      result: 'overwritten',
      receipt_no: 'R-260712-0002',
      band_key: 'demo9000',
      verified: true,
      existing_receipt_no: 'R-260712-0001',
      existing_type: '再配達'
    })
  );
  const r = await submitReception(TN, { type: '置き配', dropPlace: '玄関前' }, { overwrite: true });
  assert.deepEqual(r, { ok: true, receiptNo: 'R-260712-0002' });
});

test('register_reception: unchanged → ok:true + receiptNo（既存行を維持）', async () => {
  __setClientForTest(
    stubRpc({
      result: 'unchanged',
      receipt_no: 'R-260712-0001',
      band_key: 'demo9000',
      verified: true,
      existing_receipt_no: null,
      existing_type: null
    })
  );
  const r = await submitReception(TN, { type: '再配達', desiredDate: '2026-07-20', timeSlot: '午前' }, { overwrite: true });
  assert.deepEqual(r, { ok: true, receiptNo: 'R-260712-0001' });
});

test('register_reception: duplicate → ok:false + duplicate:true + existing', async () => {
  __setClientForTest(
    stubRpc({
      result: 'duplicate',
      receipt_no: null,
      band_key: 'demo9000',
      verified: null,
      existing_receipt_no: 'R-260712-0001',
      existing_type: '再配達'
    })
  );
  const r = await submitReception(TN, { type: '置き配', dropPlace: '玄関前' });
  assert.deepEqual(r, { ok: false, duplicate: true, existing: { receiptNo: 'R-260712-0001', type: '再配達' } });
});

test('register_reception: format_error → ok:false（帯に該当なし）', async () => {
  __setClientForTest(
    stubRpc({
      result: 'format_error',
      receipt_no: null,
      band_key: null,
      verified: null,
      existing_receipt_no: null,
      existing_type: null
    })
  );
  const r = await submitReception('UNKNOWN_FORMAT', { type: '再配達', desiredDate: '2026-07-20', timeSlot: '午前' });
  assert.deepEqual(r, { ok: false });
});

test('register_reception: not_found → ok:false（照合あり帯でdeliveries不在）', async () => {
  __setClientForTest(
    stubRpc({
      result: 'not_found',
      receipt_no: null,
      band_key: 'demo9000',
      verified: null,
      existing_receipt_no: null,
      existing_type: null
    })
  );
  const r = await submitReception('900099999999', { type: '再配達', desiredDate: '2026-07-20', timeSlot: '午前' });
  assert.deepEqual(r, { ok: false });
});

test('register_reception: RPCエラー → ok:false（フォールバックしない）', async () => {
  __setClientForTest(stubRpc(null, { message: 'network error' }));
  const r = await submitReception(TN, { type: '再配達', desiredDate: '2026-07-20', timeSlot: '午前' });
  assert.deepEqual(r, { ok: false });
});

test('get_reception_public: 該当あり → receiptNo/type/desiredDate/timeSlot/dropPlace', async () => {
  __setClientForTest(
    stubRpc({
      receipt_no: 'R-260712-0001',
      type: '再配達',
      desired_date: '2026-07-20',
      time_slot: '午前',
      drop_place: null,
      status: '受付済'
    })
  );
  const r = await getReception(TN);
  assert.deepEqual(r, {
    receiptNo: 'R-260712-0001',
    type: '再配達',
    desiredDate: '2026-07-20',
    timeSlot: '午前',
    dropPlace: null
  });
});

test('get_reception_public: 該当なし(data=null) → null', async () => {
  __setClientForTest(stubRpc(null));
  assert.equal(await getReception('900000000099'), null);
});

test('get_reception_public: RPCエラー → null', async () => {
  __setClientForTest(stubRpc(null, { message: 'network error' }));
  assert.equal(await getReception(TN), null);
});
