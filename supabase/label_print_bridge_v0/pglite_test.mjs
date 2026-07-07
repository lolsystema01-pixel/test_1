// pglite E2E: label_payload ビュー（area RLS・PII非混入）＋ print_history/record_prints。
// 実行: node supabase/label_print_bridge_v0/pglite_test.mjs
import { PGlite } from '../../node_modules/@electric-sql/pglite/dist/index.js';
import { readFileSync } from 'node:fs';

const db = new PGlite();
let pass = 0,
  fail = 0;
const ok = (n, c) => (c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.error(`  ✗ ${n}`)));

const A1 = '00000000-0000-0000-0000-0000000000a1'; // area A01
const C1 = '00000000-0000-0000-0000-0000000000c1'; // area C01

async function asUser(uid, fn) {
  await db.exec('begin');
  await db.exec(`set local request.jwt.claims = '${JSON.stringify({ role: 'authenticated', sub: uid })}'`);
  await db.exec('set local role authenticated');
  try {
    return await fn();
  } finally {
    await db.exec('rollback');
    await db.exec('reset role');
  }
}

// --- 認証/ロール・スタブ（Supabase互換の最小形）---
await db.exec(`
  create schema if not exists auth;
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claims', true)::jsonb->>'sub','')::uuid
  $$;
  create role authenticated;

  create table public.profiles (
    user_id uuid primary key, role text not null, office_code text
  );
  create or replace function public.my_role() returns text language sql stable security definer as $$
    select role from public.profiles where user_id = auth.uid()
  $$;
  create or replace function public.my_office() returns text language sql stable security definer as $$
    select office_code from public.profiles where user_id = auth.uid()
  $$;

  -- deliveries（label_payload の源。area RLSを付与）
  create table public.deliveries (
    tracking_number text primary key,
    office_code text,
    delivery_date date,
    driver_id text,
    basket_code text,
    delivery_order integer,
    recipient_name text,   -- PII（label_payload には出さない）
    address text,          -- PII（同上）
    status text
  );
  alter table public.deliveries enable row level security;
  grant select on public.deliveries to authenticated;
  create policy d_hq on public.deliveries for select to authenticated
    using ( public.my_role() = 'hq' );
  create policy d_area on public.deliveries for select to authenticated
    using ( public.my_role() = 'area' and office_code = public.my_office() );

  insert into public.profiles values
    ('${A1}','area','A01'), ('${C1}','area','C01');
  insert into public.deliveries (tracking_number, office_code, delivery_date, driver_id, basket_code, delivery_order, recipient_name, address, status) values
    ('9000000000012','A01', current_date, 'DRV001','A',1,'田中太郎','岡崎市箱柳町12-3','配車済'),
    ('9000000000013','A01', current_date, 'DRV001','A',2,'佐藤花子','岡崎市…','配車済'),
    ('9000000000099','A01', current_date, null,    null,null,'未割当','—','未配車'),  -- 採番前→対象外
    ('9000000000200','C01', current_date, 'DRV003','M01',1,'山田次郎','豊田市…','配車済');
`);

// label_payload_v0.sql を適用（末尾の確認SELECTは害なし）
const sql = readFileSync(new URL('./label_payload_v0.sql', import.meta.url), 'utf8');
await db.exec(sql);

console.log('\n[label_payload：ペイロード＋PII非混入]');
// 列に PII が無い
const cols = (
  await db.query(
    `select column_name from information_schema.columns where table_schema='public' and table_name='label_payload'`
  )
).rows.map((r) => r.column_name);
ok('列に recipient_name が無い', !cols.includes('recipient_name'));
ok('列に address が無い', !cols.includes('address'));
ok('列に basket_code/delivery_order/tracking_number がある', ['basket_code', 'delivery_order', 'tracking_number'].every((c) => cols.includes(c)));

console.log('\n[area A01：採番済のみ・自営業所のみ]');
await asUser(A1, async () => {
  const rows = (await db.query(`select * from public.label_payload where delivery_date = current_date order by delivery_order`)).rows;
  ok('A01 は採番済2件のみ（未採番99は出ない）', rows.length === 2);
  ok('大ラベル材料＝かご記号+配達順', rows[0].basket_code === 'A' && rows[0].delivery_order === 1);
  ok('小ラベル＝問合番号', rows[0].tracking_number === '9000000000012');
  const other = (await db.query(`select count(*)::int n from public.label_payload where office_code <> 'A01'`)).rows[0].n;
  ok('★他営業所(C01)=範囲外0件', other === 0);
});

console.log('\n[area C01：自営業所のみ]');
await asUser(C1, async () => {
  const rows = (await db.query(`select * from public.label_payload`)).rows;
  ok('C01 は1件（自営業所のみ）', rows.length === 1 && rows[0].office_code === 'C01');
  ok('A01 の問合番号は見えない', !rows.some((r) => r.tracking_number === '9000000000012'));
});

console.log('\n[record_prints / print_history：記録・再印刷・自営業所固定]');
await asUser(A1, async () => {
  const n1 = (await db.query(`select public.record_prints($1::jsonb) n`, [
    JSON.stringify([{ tracking_number: '9000000000012', basket_code: 'A', delivery_order: 1, kind: 'print', terminal_id: 'T-001', office_code: 'C01' }])
  ])).rows[0].n;
  ok('印刷1件 記録', n1 === 1);
  const n2 = (await db.query(`select public.record_prints($1::jsonb) n`, [
    JSON.stringify([{ tracking_number: '9000000000012', basket_code: 'A', delivery_order: 1, kind: 'reprint', terminal_id: 'T-001' }])
  ])).rows[0].n;
  ok('再印刷1件 記録', n2 === 1);
  const hist = (await db.query(`select * from public.print_history where tracking_number='9000000000012' order by id`)).rows;
  ok('履歴2件（print+reprint）', hist.length === 2);
  ok('再印刷kindがある', hist.some((h) => h.kind === 'reprint'));
  ok('★office_codeはitemのC01でなく自営業所A01に固定', hist.every((h) => h.office_code === 'A01'));
  ok('printed_by=自分(A01)に固定', hist.every((h) => h.printed_by === A1));
});

console.log('\n[print_history RLS：他営業所の履歴は見えない]');
// A01 が記録 → C01 では見えない（別トランザクションで永続させて確認）
await db.exec('begin');
await db.exec(`set local request.jwt.claims = '${JSON.stringify({ role: 'authenticated', sub: A1 })}'`);
await db.exec('set local role authenticated');
await db.query(`select public.record_prints($1::jsonb)`, [JSON.stringify([{ tracking_number: 'PERSIST-A01', basket_code: 'A', delivery_order: 9, kind: 'print' }])]);
await db.exec('reset role');
await db.exec('commit');
await asUser(C1, async () => {
  const seen = (await db.query(`select count(*)::int n from public.print_history where tracking_number='PERSIST-A01'`)).rows[0].n;
  ok('★C01 から A01 の履歴=0件（area RLS）', seen === 0);
});
await asUser(A1, async () => {
  const seen = (await db.query(`select count(*)::int n from public.print_history where tracking_number='PERSIST-A01'`)).rows[0].n;
  ok('A01 自身は自分の履歴を見られる', seen === 1);
});

console.log(`\nlabel_print pglite: ${pass} passed, ${fail} failed`);
await db.close();
if (fail > 0) process.exit(1);
