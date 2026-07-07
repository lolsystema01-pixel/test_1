// N-11：バリデーション単体テスト（D章7項目）。node --import tsx --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  vTracking,
  vAuthCode,
  vReceptionType,
  vDesiredDate,
  vTimeSlot,
  vDropPlace,
  vMemo,
  needsDateTime,
  needsDropPlace,
  validateAll,
  isEmpty
} from '../src/lib/validation';

test('問合番号：必須・半角英数・桁数', () => {
  assert.equal(vTracking('900000000001'), null);
  assert.equal(vTracking('ABC12345'), null);
  assert.ok(vTracking(''));
  assert.ok(vTracking('123')); // 桁不足
  assert.ok(vTracking('あいうえおかきく')); // 全角
  assert.ok(vTracking('DSP-OKZ_C_01')); // 記号NG（受付仕様は半角英数）
});

test('認証コード：必須・数字6桁', () => {
  assert.equal(vAuthCode('123456'), null);
  assert.ok(vAuthCode('12345')); // 5桁
  assert.ok(vAuthCode('1234567')); // 7桁
  assert.ok(vAuthCode('12a456')); // 数字以外
  assert.ok(vAuthCode(''));
});

test('受付種別：必須選択', () => {
  assert.equal(vReceptionType('再配達'), null);
  assert.equal(vReceptionType('置き配'), null);
  assert.equal(vReceptionType('時間変更'), null);
  assert.ok(vReceptionType(''));
  assert.ok(vReceptionType('その他'));
});

test('希望日：必須・今日以降', () => {
  assert.equal(vDesiredDate('2026-06-25', '2026-06-24'), null);
  assert.equal(vDesiredDate('2026-06-24', '2026-06-24'), null); // 当日OK
  assert.ok(vDesiredDate('2026-06-23', '2026-06-24')); // 過去
  assert.ok(vDesiredDate('', '2026-06-24'));
});

test('時間帯：必須選択', () => {
  assert.equal(vTimeSlot('午前'), null);
  assert.ok(vTimeSlot(''));
  assert.ok(vTimeSlot('深夜'));
});

test('置き配場所：置き配時のみ必須', () => {
  assert.equal(vDropPlace('玄関前', '置き配'), null);
  assert.ok(vDropPlace('', '置き配')); // 置き配で空→NG
  assert.equal(vDropPlace('', '再配達'), null); // 置き配以外は不要
});

test('メモ：任意・200字以内', () => {
  assert.equal(vMemo(''), null);
  assert.equal(vMemo('a'.repeat(200)), null);
  assert.ok(vMemo('a'.repeat(201)));
});

test('分岐：再配達/時間変更→日時 ／ 置き配→場所', () => {
  assert.equal(needsDateTime('再配達'), true);
  assert.equal(needsDateTime('時間変更'), true);
  assert.equal(needsDateTime('置き配'), false);
  assert.equal(needsDropPlace('置き配'), true);
  assert.equal(needsDropPlace('再配達'), false);
});

test('validateAll：再配達は日時必須、置き配は場所必須', () => {
  // 再配達で日時未入力→エラー
  assert.ok(!isEmpty(validateAll({ receptionType: '再配達' }, '2026-06-24')));
  // 再配達で日時OK→空
  assert.ok(isEmpty(validateAll({ receptionType: '再配達', desiredDate: '2026-06-25', timeSlot: '午前' }, '2026-06-24')));
  // 置き配で場所未入力→エラー
  assert.ok(!isEmpty(validateAll({ receptionType: '置き配' }, '2026-06-24')));
  // 置き配で場所OK→空（日時は不要）
  assert.ok(isEmpty(validateAll({ receptionType: '置き配', dropPlace: '玄関前' }, '2026-06-24')));
});
