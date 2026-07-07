// prompt.ts 単体テスト（純関数）。`npm run test:prompt` で実行。
import assert from 'node:assert/strict';
import {
  buildSystemPrompt,
  buildUserMessage,
  STATUS_GUIDE,
  ALLOWED_KEYS,
  type MaskedDelivery
} from '../src/prompt.js';

let pass = 0;
const ok = (name: string, cond: boolean) => {
  assert.ok(cond, name);
  pass++;
  console.log(`PASS ${name}`);
};

// システムプロンプト
const sys = buildSystemPrompt();
ok('system: ステータス語彙(配送中)を含む', sys.includes('配送中'));
ok('system: 不在の言い回しを含む', sys.includes('持ち戻'));
ok('system: 最終回答のみ指示', sys.includes('最終的な回答文のみ'));
ok('system: 詳細住所を述べない指示', sys.includes('詳細住所'));

// ユーザーメッセージ（状況別の値が入る）
const masked: MaskedDelivery = {
  tracking_number: '900000000001',
  status: '配送中',
  delivery_date: '2026-06-18',
  time_window: '午前',
  delivery_order: 3,
  municipality: '岡崎市'
};
const um = buildUserMessage(masked, 'いつ届きますか？');
ok('user: 問合番号を含む', um.includes('900000000001'));
ok('user: 状況を含む', um.includes('配送中'));
ok('user: 予定日を含む', um.includes('2026-06-18'));
ok('user: 市レベルを含む', um.includes('岡崎市'));
ok('user: 質問を含む', um.includes('いつ届きますか？'));

// 質問省略時は既定文
ok('user: 質問省略で既定文', buildUserMessage(masked).includes('配送状況と配達予定'));

// ★PII非混入：MaskedDelivery は許可キーのみ（氏名・住所・連絡先のキーが無い）
const keys = Object.keys(masked);
ok('mask: キーは許可6個のみ', keys.length === ALLOWED_KEYS.length && keys.every((k) => (ALLOWED_KEYS as string[]).includes(k)));
ok('mask: recipient_name キーが無い', !keys.includes('recipient_name'));
ok('mask: address キーが無い', !keys.includes('address'));
ok('mask: contact キーが無い', !keys.includes('contact'));

// STATUS_GUIDE は 6.10 の主要ステータスを網羅
for (const s of ['未配車', '配車済', '仕分済', '配送中', '完了', '不在']) {
  ok(`STATUS_GUIDE に ${s}`, s in STATUS_GUIDE);
}

console.log(`\n==== ${pass} passed ====`);
