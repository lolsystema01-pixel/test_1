// N-11（チャネル）：会話FSM 3経路・ロック・二重受付・LINE署名検証・レート制限・イベント解釈。
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { advance, newSession, type FsmServices, type ChSession } from '../src/lib/server/channels/fsm';
import { verifyLineSignature, parseLineEvents } from '../src/lib/server/channels/line';
import { rateLimit, __resetRateLimit } from '../src/lib/server/channels/ratelimit';
import { issueOtp, verifyOtp, registerReception, findDelivery, DUMMY_OTP, __resetForTest } from '../src/lib/server/store';
import crypto from 'node:crypto';

// FSM に注入する検証用サービス（実DBではなくダミー store を使用）
const svc: FsmServices = {
  lookup: async (tn) => {
    const d = findDelivery(tn);
    return d ? { status: d.status, municipality: d.municipality } : null;
  },
  issueOtp: (tn) => issueOtp(tn),
  verifyOtp: (tn, code) => verifyOtp(tn, code),
  register: (tn, payload, overwrite) => registerReception(tn, payload, overwrite),
  sendOtp: () => {},
  today: () => '2026-06-24'
};

beforeEach(() => {
  __resetForTest();
  __resetRateLimit();
});

// 会話を順に進めるヘルパ
async function run(inputs: string[]): Promise<ChSession> {
  let s = newSession('line');
  for (const i of inputs) {
    const res = await advance(s, i, svc);
    s = res.session;
  }
  return s;
}

test('経路①再配達：問合番号→OTP→種別→日付→時間帯→確認→完了', async () => {
  const s = await run(['900000000001', DUMMY_OTP, '1', '2030-01-01', '午前', 'はい']);
  assert.equal(s.step, 'done');
  assert.ok(s.receiptNo);
  assert.equal(s.receptionType, '再配達');
});

test('経路②時間変更（番号入力で種別を数字3）', async () => {
  const s = await run(['900000000002', DUMMY_OTP, '3', '2030-02-02', '18-20', 'はい']);
  assert.equal(s.step, 'done');
  assert.equal(s.receptionType, '時間変更');
  assert.equal(s.timeSlot, '18-20');
});

test('経路③置き配：種別2→置き配場所→確認→完了', async () => {
  const s = await run(['900000000003', DUMMY_OTP, '2', '玄関前', 'はい']);
  assert.equal(s.step, 'done');
  assert.equal(s.receptionType, '置き配');
  assert.ok(s.receiptNo);
});

test('未知番号は次へ進めない（trackingのまま）', async () => {
  let s = newSession('line');
  const res = await advance(s, '999999999999', svc);
  assert.equal(res.session.step, 'tracking');
  assert.match(res.replies[0], /見つかりません/);
});

test('OTP誤り→残回数、上限でロック', async () => {
  let s = (await advance(newSession('line'), '900000000001', svc)).session; // otp待ち
  for (let i = 1; i < 5; i++) {
    const res = await advance(s, '000000', svc);
    s = res.session;
    assert.equal(s.step, 'otp');
  }
  const locked = await advance(s, '000000', svc);
  assert.match(locked.replies[0], /ロック/);
});

test('バリデーション：種別が不正なら聞き直し', async () => {
  let s = await run(['900000000001', DUMMY_OTP]);
  const res = await advance(s, 'なにか', svc);
  assert.equal(res.session.step, 'type');
  assert.match(res.replies[0], /受付種別/);
});

test('二重受付→上書き確認→はいで上書き', async () => {
  // 1回目
  await run(['900000000001', DUMMY_OTP, '1', '2030-01-01', '午前', 'はい']);
  // 同番号で再受付（OTP再発行）→確認で duplicate→overwrite
  let s = await run(['900000000001', DUMMY_OTP, '2', '玄関前']);
  const conf = await advance(s, 'はい', svc); // confirm→duplicate
  assert.equal(conf.session.step, 'overwrite');
  assert.match(conf.replies[0], /すでに受付済み/);
  const ow = await advance(conf.session, 'はい', svc);
  assert.equal(ow.session.step, 'done');
});

test('「最初から」でリセット', async () => {
  let s = await run(['900000000001', DUMMY_OTP, '1']);
  const res = await advance(s, '最初から', svc);
  assert.equal(res.session.step, 'tracking');
});

test('LINE署名検証：正しい署名のみ通す', () => {
  const secret = 'test-secret';
  const body = '{"events":[]}';
  const sig = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('base64');
  assert.equal(verifyLineSignature(body, sig, secret), true);
  assert.equal(verifyLineSignature(body, 'wrong', secret), false);
  assert.equal(verifyLineSignature(body, null, secret), false);
});

test('LINEイベント解釈：text/postback を取り出す', () => {
  const evs = parseLineEvents({
    events: [
      { type: 'message', message: { type: 'text', text: 'こんにちは' }, source: { userId: 'U1' }, replyToken: 'r1' },
      { type: 'postback', postback: { data: '再配達' }, source: { userId: 'U2' } },
      { type: 'follow', source: { userId: 'U3' } }
    ]
  });
  assert.equal(evs.length, 2);
  assert.equal(evs[0].text, 'こんにちは');
  assert.equal(evs[1].text, '再配達');
});

test('レート制限：上限超でブロック', () => {
  for (let i = 0; i < 3; i++) assert.equal(rateLimit('k', 3, 60_000, 1000).ok, true);
  assert.equal(rateLimit('k', 3, 60_000, 1000).ok, false);
  // ウィンドウ経過で復活
  assert.equal(rateLimit('k', 3, 60_000, 70_000).ok, true);
});
