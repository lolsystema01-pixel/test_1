// pglite E2E: number_bands + reception_requests + register_reception + get_reception_public
//   受付登録(N-4)のDB化 第1タスク。帯判定・照合あり/なし・二重受付・冪等・上書き履歴・D章バリデーション・anon実行可。
// 実行: node supabase/reception_write_v0/pglite_test.mjs
import { PGlite } from '../../node_modules/@electric-sql/pglite/dist/index.js';
import { readFileSync } from 'node:fs';

const db = new PGlite();
let pass = 0, fail = 0;
const ok = (n, c) => (c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.error(`  ✗ ${n}`)));
async function throws(n, fn) {
  try { await fn(); fail++; console.error(`  ✗ ${n}（例外が出なかった）`); }
  catch { pass++; console.log(`  ✓ ${n}`); }
}

const HQ  = '00000000-0000-0000-0000-0000000000a1'; // hq
const A01 = '00000000-0000-0000-0000-0000000000a2'; // area A01
const DRV = '00000000-0000-0000-0000-0000000000a3'; // driver

// 呼び出しユーザーとして実行（auth.uid() は request.jwt.claims->>'sub'）。呼び出し内で結果を確定させ、最後にrollback。
async function asUser(uid, fn) {
  await db.exec('begin');
  await db.exec(`set local request.jwt.claims = '${JSON.stringify({ role: 'authenticated', sub: uid })}'`);
  await db.exec('set local role authenticated');
  try { return await fn(); }
  finally { await db.exec('rollback'); await db.exec('reset role'); }
}
// anonとして実行（sub無し＝auth.uid() は NULL）。
async function asAnon(fn) {
  await db.exec('begin');
  await db.exec(`set local request.jwt.claims = '${JSON.stringify({ role: 'anon' })}'`);
  await db.exec('set local role anon');
  try { return await fn(); }
  finally { await db.exec('rollback'); await db.exec('reset role'); }
}

// --- Supabase互換の最小スタブ（前提: auth.uid()・profiles 5ロール・offices・deliveries+5ロールselect＝rls_v0簡略再現）---
await db.exec(`
  create schema if not exists auth;
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub','')::uuid
  $$;
  create role authenticated;
  create role anon;
  grant usage on schema auth, public to authenticated, anon;
  grant execute on function auth.uid() to authenticated, anon;

  create table public.profiles (
    user_id uuid primary key, role text, depot_code text, office_code text, driver_id text, shipper_id text
  );
  create table public.offices (office_code text primary key, depot_code text);

  create or replace function public.my_role()   returns text language sql stable security definer set search_path=public as $$ select role        from public.profiles where user_id=auth.uid() $$;
  create or replace function public.my_office() returns text language sql stable security definer set search_path=public as $$ select office_code from public.profiles where user_id=auth.uid() $$;
  create or replace function public.my_depot()  returns text language sql stable security definer set search_path=public as $$ select depot_code  from public.profiles where user_id=auth.uid() $$;
  create or replace function public.my_driver() returns text language sql stable security definer set search_path=public as $$ select driver_id   from public.profiles where user_id=auth.uid() $$;
  create or replace function public.my_shipper() returns text language sql stable security definer set search_path=public as $$ select shipper_id from public.profiles where user_id=auth.uid() $$;
  create or replace function public.my_depot_offices() returns setof text language sql stable security definer set search_path=public as $$ select office_code from public.offices where depot_code=public.my_depot() $$;

  create table public.deliveries (
    tracking_number text primary key,
    office_code text, driver_id text, shipper_id text,
    status text not null default '未配車'
  );
  alter table public.deliveries enable row level security;
  grant select on public.deliveries to authenticated;
  create policy d_hq     on public.deliveries for select to authenticated using ( public.my_role()='hq' );
  create policy d_depot  on public.deliveries for select to authenticated using ( public.my_role()='depot'  and office_code in (select public.my_depot_offices()) );
  create policy d_area   on public.deliveries for select to authenticated using ( public.my_role()='area'   and office_code = public.my_office() );
  create policy d_driver on public.deliveries for select to authenticated using ( public.my_role()='driver' and driver_id  = public.my_driver() );
  create policy d_shipper on public.deliveries for select to authenticated using ( public.my_role()='shipper' and shipper_id = public.my_shipper() );

  insert into public.profiles (user_id, role, office_code, driver_id, shipper_id) values
    ('${HQ}','hq',null,null,null),
    ('${A01}','area','A01',null,null),
    ('${DRV}','driver',null,'DRV001',null);

  -- 出荷SQLが照合する実在荷物（demo9000帯・照合あり）
  insert into public.deliveries (tracking_number, office_code, status) values
    ('900000000001','A01','不在');
`);

// ── 出荷SQLをそのまま適用 ──
await db.exec(readFileSync(new URL('./reception_write_v0.sql', import.meta.url), 'utf8'));
ok('reception_write_v0.sql が適用できる', true);

const reg = (args) => db.query(
  `select public.register_reception($1,$2,$3,$4,$5,$6,$7,$8) r`,
  args
).then((res) => res.rows[0].r);
const countActive = async (tn) => Number(
  (await db.query(`select count(*)::int n from public.reception_requests where tracking_number=$1 and status='受付済'`, [tn])).rows[0].n
);
const countAll = async (tn) => Number(
  (await db.query(`select count(*)::int n from public.reception_requests where tracking_number=$1`, [tn])).rows[0].n
);

console.log('\n[2) 帯判定（最長prefix優先。register_receptionと同一ロジックを直接照会・副作用なし）]');
{
  const matchBand = async (tn) => {
    const rows = (await db.query(
      `select band_key, verify_on_reception from public.number_bands
       where enabled and $1 like prefix || '%'
         and (digits is null or substring($1 from char_length(prefix)+1) ~ ('^[0-9]{'||digits||'}$'))
       order by char_length(prefix) desc limit 1`, [tn]
    )).rows;
    return rows[0] ?? null;
  };
  const cases = [
    ['900000000001', 'demo9000', true],
    ['REQ-00099', 'req', true],
    ['DSP-OKZ_C_01_08-0001', 'dsp', true],
    ['KAZ26181000520', 'kaz', false],
    ['A12345', 'a', false],
    ['4001234567', 'four', false],
  ];
  for (const [tn, band, verify] of cases) {
    const m = await matchBand(tn);
    ok(`${tn} → band=${band}/verify=${verify}`, m?.band_key === band && m?.verify_on_reception === verify);
  }
  const none = await matchBand('ZZZ999');
  ok("ZZZ999 → どの帯にも不一致", none === null);
}

console.log('\n[3) 照合あり帯・deliveries不在 → not_found（行は増えない）]');
{
  const r = await reg(['900000009999', '再配達', '2026-07-20', '午前', null, 'web', null, false]);
  ok("900000009999(demo9000だがdeliveries不在) → result=not_found", r.result === 'not_found');
  ok('not_foundで行は増えない（0行）', (await countAll('900000009999')) === 0);
}

console.log('\n[4) 照合あり帯・deliveries実在 → created（receipt_noはR-始まり・verified=true）]');
let receiptV1;
{
  const r = await reg(['900000000001', '再配達', '2026-07-20', '午前', null, 'web', null, false]);
  ok('900000000001 → result=created', r.result === 'created');
  ok("receipt_no が 'R-' で始まる", typeof r.receipt_no === 'string' && r.receipt_no.startsWith('R-'));
  ok('verified=true', r.verified === true);
  ok('band_key=demo9000', r.band_key === 'demo9000');
  receiptV1 = r.receipt_no;
}

console.log('\n[5) 二重受付：同番号・overwrite=false → duplicate（existing_receipt_no=初回の値・行は増えない）]');
{
  const r = await reg(['900000000001', '再配達', '2026-07-21', '午前', null, 'web', null, false]);
  ok('result=duplicate', r.result === 'duplicate');
  ok('existing_receipt_no=初回の受付番号', r.existing_receipt_no === receiptV1);
  ok('duplicateで行は増えない（activeは1行のまま）', (await countActive('900000000001')) === 1);
}

console.log('\n[6) 冪等：同一内容・overwrite=true → unchanged（行は増えない）]');
{
  const r = await reg(['900000000001', '再配達', '2026-07-20', '午前', null, 'web', null, true]);
  ok('result=unchanged', r.result === 'unchanged');
  ok('unchangedで行は増えない（totalは1行のまま）', (await countAll('900000000001')) === 1);
  ok('receipt_noは維持される（初回のまま）', r.receipt_no === receiptV1);
}

console.log('\n[7) 上書き：内容を変えてoverwrite=true → overwritten（旧行=取消・新行=受付済・計2行）]');
let receiptV2;
{
  const r = await reg(['900000000001', '時間変更', '2026-07-22', '18-20', null, 'web', null, true]);
  ok('result=overwritten', r.result === 'overwritten');
  ok('existing_receipt_no=旧受付番号', r.existing_receipt_no === receiptV1);
  ok("新receipt_noは旧と異なる（'R-'始まり）", r.receipt_no !== receiptV1 && r.receipt_no.startsWith('R-'));
  receiptV2 = r.receipt_no;
  const rows = (await db.query(`select receipt_no, status from public.reception_requests where tracking_number='900000000001' order by created_at`)).rows;
  ok('計2行（旧+新）', rows.length === 2);
  ok('旧行 status=取消', rows.find((x) => x.receipt_no === receiptV1)?.status === '取消');
  ok('新行 status=受付済', rows.find((x) => x.receipt_no === receiptV2)?.status === '受付済');
}

console.log('\n[8) 照合なし帯：KAZ帯 → created・verified=false（deliveries不在でも登録できる）]');
{
  const r = await reg(['KAZ26181000520', '再配達', '2026-07-25', '午前', null, 'web', null, false]);
  ok('KAZ26181000520 → result=created', r.result === 'created');
  ok('verified=false（照合なし帯）', r.verified === false);
  ok('band_key=kaz', r.band_key === 'kaz');
}

console.log('\n[9) 形式不一致：ZZZ999 → format_error]');
{
  const r = await reg(['ZZZ999', '置き配', null, null, '玄関前', 'web', null, false]);
  ok('ZZZ999 → result=format_error', r.result === 'format_error');
  ok('format_errorはband_key=null', r.band_key === null);
}

console.log('\n[10) 種別バリデーション（D章相当）：再配達でdesired_date未指定 → 例外]');
await throws('再配達なのにdesired_date=null → 例外', () =>
  reg(['900000000001', '再配達', null, '午前', null, 'web', null, true])
);
await throws('置き配なのにdrop_place=null → 例外', () =>
  reg(['KAZ99999999999', '置き配', null, null, null, 'web', null, false])
);
await throws('不正な受付種別 → 例外', () =>
  reg(['KAZ99999999999', '不明種別', null, null, null, 'web', null, false])
);

console.log('\n[11) anonからregister_reception実行可（grant確認）・get_reception_publicは非PIIサマリを返す]');
await asAnon(async () => {
  const r = await reg(['4009999999', '置き配', null, null, '宅配ボックス', 'web', null, false]);
  ok('anonでもregister_receptionを実行できる（grant済み）', r.result === 'created' && r.band_key === 'four');
  // reception_requestsへのSELECTはanonに与えていない仕様のため、確認は role をリセットして行う（同一トランザクション内・rollback前）。
  await db.exec('reset role');
  const row = (await db.query(`select created_by from public.reception_requests where tracking_number='4009999999'`)).rows[0];
  ok('anon実行時 created_by は NULL（auth.uid()なし）', row.created_by === null);
});
await asAnon(async () => {
  const pub = (await db.query(`select public.get_reception_public($1) p`, ['900000000001'])).rows[0].p;
  ok('get_reception_publicがanonから呼べ、活性受付の非PIIサマリを返す', pub !== null && pub.receipt_no === receiptV2);
  ok('type/desired_date/time_slot/statusが上書き後の値と一致', pub.type === '時間変更' && pub.time_slot === '18-20' && pub.status === '受付済');
  ok('caller_phone・created_byはキーに含まれない（非PII源流強制）', !('caller_phone' in pub) && !('created_by' in pub));
});
{
  const none = (await db.query(`select public.get_reception_public($1) p`, ['NOTREGISTERED'])).rows[0].p;
  ok('未登録の問合番号はNULL', none === null);
}

console.log('\n[補足: write policyは置かない（規約どおり）]');
{
  const n = (await db.query(
    `select count(*)::int n from pg_policies where schemaname='public' and tablename='reception_requests' and cmd <> 'SELECT'`
  )).rows[0].n;
  ok('reception_requests に SELECT以外のポリシーは0本', n === 0);
}

console.log(`\nreception_write pglite: ${pass} passed, ${fail} failed`);
await db.close();
if (fail > 0) process.exit(1);
