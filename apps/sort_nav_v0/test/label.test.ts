// label.ts 単体テスト（tsx で実行）。ラベル内容＝数字のみ・大/小・履歴項目・PII非混入。
import { toLabelText, barcodeValue, toPrintItems, LABEL_HEIGHT_MM, type LabelPayload } from '../src/lib/label';

let pass = 0;
let fail = 0;
function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) {
    pass++;
  } else {
    fail++;
    console.error(`✗ ${name}\n   got : ${g}\n   want: ${w}`);
  }
}
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`✗ ${name}`);
  }
}

const p = (o: Partial<LabelPayload>): LabelPayload => ({
  office_code: 'A01',
  delivery_date: '2026-06-17',
  driver_id: 'DRV001',
  tracking_number: '9000000000012',
  basket_code: 'A',
  delivery_order: 1,
  ...o
});

// 大＝かご記号＋配達順 / 小＝問合番号
eq('大ラベル＝かご記号＋配達順', toLabelText(p({})).large, 'A 1');
eq('小ラベル＝問合番号', toLabelText(p({})).small, '9000000000012');
eq('大ラベル M01/2', toLabelText(p({ basket_code: 'M01', delivery_order: 2 })).large, 'M01 2');
eq('かご記号nullは配達順のみ', toLabelText(p({ basket_code: null, delivery_order: 3 })).large, '3');
eq('配達順nullはかご記号のみ', toLabelText(p({ delivery_order: null })).large, 'A');
eq('両方nullは空', toLabelText(p({ basket_code: null, delivery_order: null })).large, '');

// 小ラベルは数字のみ（住所/氏名を含まない＝そもそも型に無い）
ok('小ラベルは問合番号(数字)', /^\d+$/.test(toLabelText(p({})).small));
ok('LabelPayload に氏名キーが無い', !('recipient_name' in p({})));
ok('LabelPayload に住所キーが無い', !('address' in p({})));

// バーコード値＝問合番号
eq('バーコード値＝問合番号', barcodeValue(p({})), '9000000000012');

// 高さ約30mm
eq('ラベル高さ30mm', LABEL_HEIGHT_MM, 30);

// 履歴項目（record_prints へ渡す形）
const items = toPrintItems([p({}), p({ tracking_number: '9000000000099', basket_code: 'B', delivery_order: 2 })], 'print', 'T-001');
eq('履歴2件', items.length, 2);
eq('履歴 kind', items[0].kind, 'print');
eq('履歴 terminal_id', items[0].terminal_id, 'T-001');
eq('履歴 tracking_number', items[0].tracking_number, '9000000000012');
ok('履歴項目に氏名/住所を含めない', !('recipient_name' in items[0]) && !('address' in items[0]));
eq('履歴 kind=reprint', toPrintItems([p({})], 'reprint', null)[0].kind, 'reprint');
eq('terminal_id 未設定は null', toPrintItems([p({})], 'pdf', null)[0].terminal_id, null);

console.log(`\nlabel.ts: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
