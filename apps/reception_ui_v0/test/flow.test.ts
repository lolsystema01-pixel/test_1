// N-11：内製API（N-3〜N-6・N-10）の結合テスト＝ストア関数で3経路を通す。node --import tsx --test
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  issueOtp,
  verifyOtp,
  trackingFromToken,
  registerReception,
  existingReception,
  statusByTracking,
  findDelivery,
  DUMMY_OTP,
  MAX_ATTEMPTS,
  __resetForTest
} from '../src/lib/server/store';
import { maskObject, maskTracking } from '../src/lib/mask';

beforeEach(() => __resetForTest());

const TN = '900000000001';

test('荷物存在チェック（ダミー照合）＋OTP発行', () => {
  // 存在チェックは endpoint で lookupDelivery（実DB or ダミー）。ここではダミー源を確認。
  assert.ok(findDelivery(TN));
  assert.equal(findDelivery('999999999999'), null);
  const r = issueOtp(TN);
  assert.equal(r.ok, true);
  assert.equal(r.devCode, DUMMY_OTP);
});

test('OTP未発行での照合は expired', () => {
  const r = verifyOtp('900000000002', '123456');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'expired');
});

test('N-3 認証：誤コードで残回数→上限でロック→正コードで通過', () => {
  issueOtp(TN);
  for (let i = 1; i < MAX_ATTEMPTS; i++) {
    const r = verifyOtp(TN, '000000');
    assert.equal(r.ok, false);
    assert.equal(r.locked, false);
  }
  // MAX回目でロック
  const locked = verifyOtp(TN, '000000');
  assert.equal(locked.locked, true);
  // ロック中は正コードでも通らない
  assert.equal(verifyOtp(TN, DUMMY_OTP).ok, false);
});

test('N-3 認証：正コードでトークン発行→トークンから問合番号を解決', () => {
  issueOtp(TN);
  const r = verifyOtp(TN, DUMMY_OTP);
  assert.equal(r.ok, true);
  assert.ok(r.token);
  assert.equal(trackingFromToken(r.token!), TN);
  assert.equal(trackingFromToken('bogus'), null);
});

function authToken(tn = TN): string {
  issueOtp(tn);
  return verifyOtp(tn, DUMMY_OTP).token!;
}

test('経路①再配達：受付登録→受付番号→状態取得', () => {
  authToken();
  const r = registerReception(TN, { type: '再配達', desiredDate: '2026-06-25', timeSlot: '午前' });
  assert.equal(r.ok, true);
  assert.ok(r.receiptNo);
  const s = statusByTracking(TN)!;
  assert.equal(s.reception?.type, '再配達');
  assert.equal(s.reception?.desiredDate, '2026-06-25');
});

test('経路②時間変更：日時で受付', () => {
  const r = registerReception('900000000002', { type: '時間変更', desiredDate: '2026-06-26', timeSlot: '18-20' });
  assert.equal(r.ok, true);
  assert.equal(existingReception('900000000002')?.timeSlot, '18-20');
});

test('経路③置き配：場所で受付', () => {
  const r = registerReception('900000000003', { type: '置き配', dropPlace: '玄関前', memo: '不在時よろしく' });
  assert.equal(r.ok, true);
  assert.equal(existingReception('900000000003')?.dropPlace, '玄関前');
});

test('N-5 二重受付：同番号は duplicate、overwrite で上書き', () => {
  registerReception(TN, { type: '再配達', desiredDate: '2026-06-25', timeSlot: '午前' });
  const dup = registerReception(TN, { type: '置き配', dropPlace: '宅配ボックス' });
  assert.equal(dup.ok, false);
  assert.equal(dup.duplicate, true);
  assert.ok(dup.existing?.receiptNo);
  const ow = registerReception(TN, { type: '置き配', dropPlace: '宅配ボックス' }, true);
  assert.equal(ow.ok, true);
  assert.equal(existingReception(TN)?.type, '置き配');
});

test('N-6 状態：PII（氏名・連絡先・住所）を返さない／問合番号はマスク', () => {
  const s = statusByTracking(TN)!;
  const json = JSON.stringify(s);
  assert.ok(!json.includes('田中')); // 氏名
  assert.ok(!json.includes('090-')); // 連絡先
  assert.ok(!json.includes('箱柳町')); // 詳細住所
  assert.equal(s.tracking_number_masked, maskTracking(TN));
  assert.equal(s.municipality, '岡崎市'); // 市レベルは可
});

test('N-10 マスキング：ログ用にPIIを伏せる', () => {
  const masked = maskObject({ trackingNumber: TN, memo: '個人情報メモ', authCode: '123456', other: 'ok' }) as Record<string, string>;
  assert.equal(masked.trackingNumber, maskTracking(TN));
  assert.ok(!masked.memo.includes('個人情報'));
  assert.equal(masked.authCode, '******');
  assert.equal(masked.other, 'ok'); // 非PIIはそのまま
});
