// pglite E2E: delivery_status_log ＋ record_status_transition（遷移検証・不可分更新・scope認可・RLS継承）。
// 実行: node supabase/status_log_v0/pglite_test.mjs
import { PGlite } from '../../node_modules/@electric-sql/pglite/dist/index.js';
import { readFileSync } from 'node:fs';

const db = new PGlite();
let pass = 0,
  fail = 0;
const ok = (n, c) => (c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.error(`  ✗ ${n}`)));
async function throws(n, fn) {
  try {
    await fn();
    fail++;
    console.error(`  ✗ ${n}（例外が出なかった）`);
  } catch {
    pass++;
    console.log(`  ✓ ${n}`);
  }
}
async function throwsCode(n, code, fn) {
  try {
    await fn();
    fail++;
    console.error(`  ✗ ${n}（例外が出なかった）`);
  } catch (e) {
    if (code && e.code !== code) {
      fail++;
      console.error(`  ✗ ${n}（errcode不一致: expected=${code} actual=${e.code} ${e.message}）`);
    } else {
      pass++;
      console.log(`  ✓ ${n} [${e.code}]`);
    }
  }
}

const A1 = '00000000-0000-0000-0000-0000000000a1'; // area A01
const C1 = '00000000-0000-0000-0000-0000000000c1'; // area C01
const DRV = '00000000-0000-0000-0000-0000000000d1'; // driver DRV001

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

// --- Supabase互換の最小スタブ ---
await db.exec(`
  create schema if not exists auth;
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub','')::uuid
  $$;
  create role authenticated;

  create table public.profiles (user_id uuid primary key, role text, office_code text, driver_id text, shipper_id text);
  create or replace function public.my_role()   returns text language sql stable security definer as $$ select role from public.profiles where user_id=auth.uid() $$;
  create or replace function public.my_office()  returns text language sql stable security definer as $$ select office_code from public.profiles where user_id=auth.uid() $$;
  create or replace function public.my_driver()  returns text language sql stable security definer as $$ select driver_id from public.profiles where user_id=auth.uid() $$;
  create or replace function public.my_shipper() returns text language sql stable security definer as $$ select shipper_id from public.profiles where user_id=auth.uid() $$;
  create or replace function public.my_depot_offices() returns setof text language sql stable security definer as $$ select office_code from public.profiles where user_id=auth.uid() $$;

  create table public.deliveries (
    tracking_number text primary key,
    office_code text, driver_id text, shipper_id text,
    status text not null default '未配車'
  );
  alter table public.deliveries enable row level security;
  grant select on public.deliveries to authenticated;
  create policy d_hq     on public.deliveries for select to authenticated using ( public.my_role()='hq' );
  create policy d_area   on public.deliveries for select to authenticated using ( public.my_role()='area'   and office_code=public.my_office() );
  create policy d_driver on public.deliveries for select to authenticated using ( public.my_role()='driver' and driver_id=public.my_driver() );

  insert into public.profiles values
    ('${A1}','area','A01',null,null),
    ('${C1}','area','C01',null,null),
    ('${DRV}','driver',null,'DRV001',null);
  insert into public.deliveries (tracking_number, office_code, driver_id, status) values
    ('T-A01-1','A01','DRV001','未配車'),
    ('T-A01-2','A01','DRV001','未配車'),
    ('T-A01-3','A01','DRV001','仕分済'),
    ('T-A01-4','A01','DRV001','配送中'),
    ('T-C01-1','C01','DRV003','未配車');
`);

// 本体SQLを適用
await db.exec(readFileSync(new URL('./status_log_v0.sql', import.meta.url), 'utf8'));
await db.exec(readFileSync(new URL('./record_status_transition_v0.sql', import.meta.url), 'utf8'));

const rec = (tn, to, src = '手動') => db.query(`select public.record_status_transition($1,$2,$3) r`, [tn, to, src]);
const statusOf = async (tn) => (await db.query(`select status from public.deliveries where tracking_number=$1`, [tn])).rows[0].status;

console.log('\n[線形遷移：未配車→配車済→仕分済→配送中→完了（system/SQL Editor）]');
await rec('T-A01-1', '配車済', '配車');
ok('step1 status=配車済', (await statusOf('T-A01-1')) === '配車済');
await rec('T-A01-1', '仕分済', '仕分け');
ok('step2 status=仕分済', (await statusOf('T-A01-1')) === '仕分済');
await rec('T-A01-1', '配送中', '配達');
ok('step3 status=配送中', (await statusOf('T-A01-1')) === '配送中');
const r4 = (await rec('T-A01-1', '完了', '配達')).rows[0].r;
ok('step4 status=完了', (await statusOf('T-A01-1')) === '完了');
ok('戻り値に from=配送中 / to=完了', r4.from_status === '配送中' && r4.to_status === '完了');

console.log('\n[ログ：from/to/actor/source が1行ずつ・status一致]');
const logs = (await db.query(`select from_status,to_status,actor,source from public.delivery_status_log where tracking_number='T-A01-1' order by id`)).rows;
ok('ログ4行（各遷移1行）', logs.length === 4);
ok('1行目 from=未配車/to=配車済/source=配車', logs[0].from_status === '未配車' && logs[0].to_status === '配車済' && logs[0].source === '配車');
ok('actor=system（SQL Editor呼び出し）', logs.every((l) => l.actor === 'system'));
const latest = (await db.query(`select to_status from public.delivery_status_log where tracking_number='T-A01-1' order by changed_at desc, id desc limit 1`)).rows[0].to_status;
ok('★deliveries.status と最新ログ to_status が一致（完了）', (await statusOf('T-A01-1')) === latest && latest === '完了');

console.log('\n[不正遷移は拒否（status/ログとも不変）]');
await throws('順序飛ばし 未配車→仕分済 拒否', () => rec('T-A01-2', '仕分済'));
ok('拒否後 T-A01-2 は未配車のまま', (await statusOf('T-A01-2')) === '未配車');
await throws('逆行 完了→配送中 拒否', () => rec('T-A01-1', '配送中'));
await throws('同一 完了→完了 拒否', () => rec('T-A01-1', '完了'));
await throws('存在しない荷物は拒否', () => rec('NOPE', '配車済'));
const logCount2 = (await db.query(`select count(*)::int n from public.delivery_status_log where tracking_number='T-A01-2'`)).rows[0].n;
ok('拒否でログは増えない（T-A01-2=0行）', logCount2 === 0);

console.log('\n[scope認可：他営業所/他ドライバーの荷物は変更不可]');
await asUser(C1, async () => {
  await throws('area C01 は A01 の荷物を変更不可', () => rec('T-A01-2', '配車済'));
});
await asUser(A1, async () => {
  const r = (await rec('T-A01-2', '配車済', '配車')).rows[0].r;
  ok('area A01 は自営業所の荷物を変更可（配車済）', r.to_status === '配車済');
  ok('actor=area が記録される', (await db.query(`select actor from public.delivery_status_log where tracking_number='T-A01-2' order by id desc limit 1`)).rows[0].actor === 'area');
});
await asUser(DRV, async () => {
  await throws('driver は仕分済→配送中以外の不正遷移を拒否（配車済→配送中は線形外）', () => rec('T-A01-2', '配送中'));
});

console.log('\n[RLS：見える荷物のログだけ見える（deliveries継承）]');
await asUser(A1, async () => {
  const rows = (await db.query(`select distinct l.tracking_number from public.delivery_status_log l`)).rows.map((r) => r.tracking_number);
  ok('A01 は A01荷物のログのみ', rows.every((t) => t.startsWith('T-A01')));
  ok('★A01 から C01荷物のログは0件', !rows.includes('T-C01-1'));
});
// C01 の荷物にログを付けてから C01/A01 の可視を確認
await rec('T-C01-1', '配車済', '配車');
await asUser(C1, async () => {
  const seen = (await db.query(`select count(*)::int n from public.delivery_status_log where tracking_number='T-C01-1'`)).rows[0].n;
  ok('C01 は自分(C01)のログが見える', seen === 1);
});
await asUser(A1, async () => {
  const seen = (await db.query(`select count(*)::int n from public.delivery_status_log where tracking_number='T-C01-1'`)).rows[0].n;
  ok('★A01 から C01ログ=0件（RLS）', seen === 0);
});

console.log('\n[日内再訪：不在→配送中→完了 が通る（完了からの戻しは引き続き無い）]');
await rec('T-A01-4', '不在', '配達');
ok('T-A01-4 は不在', (await statusOf('T-A01-4')) === '不在');
await rec('T-A01-4', '配送中', '配達');
ok('★不在→配送中（日内再訪・LOL確定2026-07-18）が通る', (await statusOf('T-A01-4')) === '配送中');
await rec('T-A01-4', '完了', '配達');
ok('再度完了まで進む', (await statusOf('T-A01-4')) === '完了');
await throws('完了からの戻し（完了→配送中）は引き続き拒否（完了は終端のまま）', () => rec('T-A01-4', '配送中'));
ok('T-A01-4 は完了のまま（戻し拒否後も不変）', (await statusOf('T-A01-4')) === '完了');
const logs4 = (
  await db.query(`select from_status,to_status from public.delivery_status_log where tracking_number='T-A01-4' order by id`)
).rows;
ok('T-A01-4 のログは3行（配送中→不在／不在→配送中／配送中→完了）', logs4.length === 3);
ok('2行目が不在→配送中', logs4[1].from_status === '不在' && logs4[1].to_status === '配送中');

console.log('\n[MED-2：driverからの直接呼び出しで完了/不在への遷移を拒否]');
// ★1トランザクション内で複数throwsCodeを直列に呼ぶと、1回目のraiseでトランザクションがabort状態になり
//   2回目が意図せず 25P02（current transaction is aborted）になってしまう＝asUserは1操作=1トランザクションに分ける。
await asUser(DRV, async () => {
  await throwsCode('driverが完了へ直接遷移させることはできない（record_delivery_result経由必須）', '42501', () =>
    rec('T-A01-3', '完了', 'CS')
  );
});
await asUser(DRV, async () => {
  await throwsCode('driverが不在へ直接遷移させることはできない', '42501', () => rec('T-A01-3', '不在', 'CS'));
});
ok('T-A01-3は仕分済のまま（ブロックにより未変更）', (await statusOf('T-A01-3')) === '仕分済');

console.log('\n[MED-2：driverの許可遷移（仕分済→配送中）は直接呼び出しでも通るが source は詐称できず配達に固定]');
await db.exec('begin');
await db.exec(`set local request.jwt.claims = '${JSON.stringify({ role: 'authenticated', sub: DRV })}'`);
await db.exec('set local role authenticated');
const rSrc = (await rec('T-A01-3', '配送中', 'CS')).rows[0].r;
await db.exec('commit');
await db.exec('reset role');
ok('driverの仕分済→配送中は許可遷移として通る', rSrc.to_status === '配送中');
ok('★戻り値のsourceはCSに詐称できず配達に固定される', rSrc.source === '配達');

ok('T-A01-3は配送中まで進んだ（driverの正規の許可遷移は機能する）', (await statusOf('T-A01-3')) === '配送中');
const logSrc = (
  await db.query(`select source from public.delivery_status_log where tracking_number='T-A01-3' order by id desc limit 1`)
).rows[0].source;
ok('★ログにもCSではなく配達が記録される（source詐称防止）', logSrc === '配達');

console.log('\n[MED-2：record_status_transition_internal は authenticated から直接rpc呼び出しできない（GRANT無し）]');
await asUser(DRV, async () => {
  await throwsCode('record_status_transition_internal への直接rpc呼び出しは42501（authenticatedへGRANT無し）', '42501', () =>
    db.query(`select public.record_status_transition_internal($1,$2,$3) r`, ['T-A01-3', '完了', '配達'])
  );
});

console.log('\n[MED-2：system（auth.uid()なし・SQL Editor/配車バッチ等）は従来どおり完了へ直接到達できる（管理訂正用途は温存）]');
await rec('T-C01-1', '仕分済', '仕分け');
await rec('T-C01-1', '配送中', '配達');
const rSys = (await rec('T-C01-1', '完了', '手動')).rows[0].r;
ok('systemはdriverガードの対象外＝完了へ到達できる', rSys.to_status === '完了');

console.log(`\nstatus_log pglite: ${pass} passed, ${fail} failed`);
await db.close();
if (fail > 0) process.exit(1);
