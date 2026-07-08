// ドライバー向けLINE QR返信：番号パーサ・返信組み立ての単体テスト（ダミー帯 9000…番号のみ使用）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDriverNumber, buildQrUrl, buildDriverReply, GUIDE_MESSAGE
} from '../src/lib/server/channels/driverline';

// --- parseDriverNumber: 受理（正準値 KAZ＋数字を返す） ---
test('11桁数字（現場実測の桁数）を受理して KAZ を補完する', () => {
  assert.equal(parseDriverNumber('90000000001'), 'KAZ90000000001');
});
test('12桁数字（当初ヒアリング）も可変受理する', () => {
  assert.equal(parseDriverNumber('900000000012'), 'KAZ900000000012');
});
test('境界: 10桁・14桁は受理する', () => {
  assert.equal(parseDriverNumber('9000000001'), 'KAZ9000000001');
  assert.equal(parseDriverNumber('90000000000014'), 'KAZ90000000000014');
});
test('KAZ/kaz付きで送られても受理する（除去して補完し直す）', () => {
  assert.equal(parseDriverNumber('KAZ90000000001'), 'KAZ90000000001');
  assert.equal(parseDriverNumber('kaz90000000001'), 'KAZ90000000001');
});
test('全角数字・全角KAZを半角化して受理する', () => {
  assert.equal(parseDriverNumber('９００００００００２２'), 'KAZ90000000022');
  assert.equal(parseDriverNumber('ＫＡＺ９００００００００２２'), 'KAZ90000000022');
});
test('空白・ハイフン混入を除去して受理する', () => {
  assert.equal(parseDriverNumber(' 9000 0000-001 '), 'KAZ90000000001');
  assert.equal(parseDriverNumber('9000　0000‐001'), 'KAZ90000000001'); // 全角スペース・別種ハイフン
});

// --- parseDriverNumber: 拒否（null） ---
test('境界外: 9桁・15桁は拒否する', () => {
  assert.equal(parseDriverNumber('900000001'), null);
  assert.equal(parseDriverNumber('900000000000015'), null);
});
test('数字以外を含む・空・日本語は拒否する', () => {
  assert.equal(parseDriverNumber('9000000000a'), null);
  assert.equal(parseDriverNumber(''), null);
  assert.equal(parseDriverNumber('こんにちは'), null);
});
test('受理範囲は引数で絞れる（桁数確定後の設定変更用）', () => {
  assert.equal(parseDriverNumber('90000000001', 11, 11), 'KAZ90000000001'); // 11桁固定
  assert.equal(parseDriverNumber('900000000012', 11, 11), null);
});

// --- buildQrUrl ---
test('QR画像URLを組み立てる（末尾スラッシュも吸収）', () => {
  assert.equal(buildQrUrl('http://localhost:4173', 'KAZ90000000001'), 'http://localhost:4173/qr/KAZ90000000001.png');
  assert.equal(buildQrUrl('http://localhost:4173/', 'KAZ90000000001'), 'http://localhost:4173/qr/KAZ90000000001.png');
});

// --- buildDriverReply ---
test('受理範囲内→画像メッセージ（original/preview 同一URL）＋番号の案内文', () => {
  const { messages, canonical } = buildDriverReply('90000000001', 'http://x.example');
  assert.equal(canonical, 'KAZ90000000001');
  assert.equal(messages[0].type, 'image');
  if (messages[0].type === 'image') {
    assert.equal(messages[0].originalContentUrl, 'http://x.example/qr/KAZ90000000001.png');
    assert.equal(messages[0].previewImageUrl, 'http://x.example/qr/KAZ90000000001.png');
  }
  assert.equal(messages[1].type, 'text');
});
test('受理範囲外→使い方ガイド文のみ（QRは返さない）', () => {
  const { messages, canonical } = buildDriverReply('よろしく', 'http://x.example');
  assert.equal(canonical, null);
  assert.equal(messages.length, 1);
  assert.deepEqual(messages[0], { type: 'text', text: GUIDE_MESSAGE });
});
