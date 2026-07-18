// pglite E2E: delivery_results ＋ record_delivery_result（8.11最小・driver専用・冪等・GPS付き）。
// 依存: status_log_v0.sql / record_status_transition_v0.sql を先に適用（記録口を内部再利用）。
// 実行: node supabase/delivery_result_v0/pglite_test.mjs
import { PGlite } from '../../node_modules/@electric-sql/pglite/dist/index.js';
import { readFileSync } from 'node:fs';

const db = new PGlite();
let pass = 0,
  fail = 0;
const ok = (n, c) => (c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.error(`  ✗ ${n}`)));
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

// --- ダミーUUID（正準規格 v1: 愛知A01/C01・DRV001-003・SHIP01 に対応）---
const HQ1 = '00000000-0000-0000-0000-000000000001'; // hq
const AREA_A1 = '00000000-0000-0000-0000-0000000000a1'; // area A01
const SHIP1 = '00000000-0000-0000-0000-0000000000f1'; // shipper SHIP01
const DRV1 = '00000000-0000-0000-0000-0000000000d1'; // driver DRV001（A01）
const DRV2 = '00000000-0000-0000-0000-0000000000d2'; // driver DRV002（A01・他ドライバー）
const DRV3 = '00000000-0000-0000-0000-0000000000d3'; // driver DRV003（C01）

// asUser: 既定はロールバック（読み取り確認・失敗させたい書込み用）。
// commit:true は成功させたい書込み（record_delivery_result は本人ログイン必須のため、
// 永続化したいテストは commit させる。失敗時は abort→commit が暗黙rollbackになるため安全）。
async function asUser(uid, fn, { commit = false } = {}) {
  await db.exec('begin');
  await db.exec(`set local request.jwt.claims = '${JSON.stringify({ role: 'authenticated', sub: uid })}'`);
  await db.exec('set local role authenticated');
  try {
    return await fn();
  } finally {
    await db.exec(commit ? 'commit' : 'rollback');
    await db.exec('reset role');
  }
}
async function asAnon(fn) {
  await db.exec('begin');
  await db.exec('set local role anon');
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
  create role anon;

  create table public.profiles (
    user_id uuid primary key, role text,
    depot_code text, office_code text, driver_id text, shipper_id text
  );
  create table public.offices (office_code text primary key, depot_code text);
  create table public.drivers (driver_id text primary key, office_code text);
  -- 本番は rls_v0.sql が既に grant 済み（drivers は delivery_results の depot分岐で直接参照されるため必要）。
  grant select on public.drivers to authenticated;

  create or replace function public.my_role()   returns text language sql stable security definer as $$ select role from public.profiles where user_id=auth.uid() $$;
  create or replace function public.my_office() returns text language sql stable security definer as $$ select office_code from public.profiles where user_id=auth.uid() $$;
  create or replace function public.my_depot()  returns text language sql stable security definer as $$ select depot_code from public.profiles where user_id=auth.uid() $$;
  create or replace function public.my_driver() returns text language sql stable security definer as $$ select driver_id from public.profiles where user_id=auth.uid() $$;
  create or replace function public.my_shipper() returns text language sql stable security definer as $$ select shipper_id from public.profiles where user_id=auth.uid() $$;
  create or replace function public.my_depot_offices() returns setof text language sql stable security definer as $$
    select office_code from public.offices where depot_code = public.my_depot() $$;
  create or replace function public.my_office_drivers() returns setof text language sql stable security definer as $$
    select driver_id from public.drivers where office_code = public.my_office() $$;

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
  create policy d_shipper on public.deliveries for select to authenticated using ( public.my_role()='shipper' and shipper_id=public.my_shipper() );

  insert into public.offices (office_code, depot_code) values ('A01','D01'), ('C01','D02');
  insert into public.drivers (driver_id, office_code) values ('DRV001','A01'), ('DRV002','A01'), ('DRV003','C01');

  insert into public.profiles (user_id, role, depot_code, office_code, driver_id, shipper_id) values
    ('${HQ1}',    'hq',      null,  null,  null,     null),
    ('${AREA_A1}','area',    'D01', 'A01', null,     null),
    ('${SHIP1}',  'shipper', null,  null,  null,     'SHIP01'),
    ('${DRV1}',   'driver',  'D01', 'A01', 'DRV001', null),
    ('${DRV2}',   'driver',  'D01', 'A01', 'DRV002', null),
    ('${DRV3}',   'driver',  'D02', 'C01', 'DRV003', null);

  -- 9000帯12桁（dummy_data_standard_v1）。愛知A01/C01・SHIP01。
  insert into public.deliveries (tracking_number, office_code, driver_id, shipper_id, status) values
    ('900000000201','A01','DRV001','SHIP01','仕分済'),  -- T1: 完了（2遷移）
    ('900000000202','A01','DRV001','SHIP01','仕分済'),  -- T2: 不在（2遷移）
    ('900000000203','A01','DRV001','SHIP01','配送中'),  -- T3: 完了（1遷移のみ）
    ('900000000204','A01','DRV001','SHIP01','仕分済'),  -- T4: 冪等（二度押し）
    ('900000000205','A01','DRV002','SHIP01','仕分済'),  -- T5: 他ドライバー所有（DRV001が触れない）
    ('900000000206','A01','DRV001','SHIP01','仕分済'),  -- T6: 認可（area/hq/shipper/anon拒否）の対象
    ('900000000207','A01','DRV001','SHIP01','仕分済'),  -- T7: 不正result
    ('900000000208','A01','DRV001','SHIP01','仕分済'),  -- T8a: 不正座標
    ('900000000209','A01','DRV001','SHIP01','仕分済'),  -- T8b: 座標null許容
    ('900000000210','A01', null,   'SHIP01','未配車'),  -- T9a: 未配車（担当なし）
    ('900000000211','A01','DRV001','SHIP01','配車済'),  -- T9b: 配車済（線形遷移外）
    ('900000000212','A01','DRV002','SHIP01','仕分済'),  -- T10a: RLS用（DRV002完了）
    ('900000000213','C01','DRV003','SHIP01','仕分済');  -- T10b: RLS用（DRV003=C01完了）
`);

// 依存記録口＋本体を適用
await db.exec(readFileSync(new URL('../status_log_v0/status_log_v0.sql', import.meta.url), 'utf8'));
await db.exec(readFileSync(new URL('../status_log_v0/record_status_transition_v0.sql', import.meta.url), 'utf8'));
await db.exec(readFileSync(new URL('./delivery_result_v0.sql', import.meta.url), 'utf8'));

const call = (tn, result, lat = null, lng = null) =>
  db.query(`select public.record_delivery_result($1,$2,$3,$4) r`, [tn, result, lat, lng]);
const statusOf = async (tn) =>
  (await db.query(`select status from public.deliveries where tracking_number=$1`, [tn])).rows[0].status;
const logRows = async (tn) =>
  (await db.query(`select from_status,to_status,source from public.delivery_status_log where tracking_number=$1 order by id`, [tn])).rows;
const resultRows = async (tn) =>
  (await db.query(`select * from public.delivery_results where tracking_number=$1 order by id`, [tn])).rows;

console.log('\n[1. driver本人：仕分済の自担当荷物に完了 → 2遷移＋delivery_results 1行（lat/lng保存）]');
await asUser(DRV1, async () => {
  const r = (await call('900000000201', '完了', 35.1, 137.2)).rows[0].r;
  ok('戻り値 result=recorded', r.result === 'recorded');
  ok('戻り値 gps=true', r.gps === true);
}, { commit: true });
ok('status=完了', (await statusOf('900000000201')) === '完了');
const logs1 = await logRows('900000000201');
ok('ログ2行（仕分済→配送中→完了）', logs1.length === 2);
ok('1行目 仕分済→配送中', logs1[0].from_status === '仕分済' && logs1[0].to_status === '配送中');
ok('2行目 配送中→完了', logs1[1].from_status === '配送中' && logs1[1].to_status === '完了');
const rr1 = await resultRows('900000000201');
ok('delivery_results 1行・lat/lng保存', rr1.length === 1 && Number(rr1[0].lat) === 35.1 && Number(rr1[0].lng) === 137.2);
ok('driver_id=DRV001・result=完了', rr1[0].driver_id === 'DRV001' && rr1[0].result === '完了');

console.log('\n[2. 不在 → 同様に2行遷移＋result=不在]');
await asUser(DRV1, async () => {
  await call('900000000202', '不在', 35.2, 137.3);
}, { commit: true });
ok('status=不在', (await statusOf('900000000202')) === '不在');
const logs2 = await logRows('900000000202');
ok('ログ2行', logs2.length === 2);
const rr2 = await resultRows('900000000202');
ok('delivery_results result=不在', rr2.length === 1 && rr2[0].result === '不在');

console.log('\n[3. 配送中の荷物に完了 → 1遷移のみで完了]');
await asUser(DRV1, async () => {
  await call('900000000203', '完了');
}, { commit: true });
ok('status=完了', (await statusOf('900000000203')) === '完了');
const logs3 = await logRows('900000000203');
ok('ログ1行のみ（配送中→完了）', logs3.length === 1 && logs3[0].from_status === '配送中' && logs3[0].to_status === '完了');

console.log('\n[4. 冪等：既に完了済みに再度「完了」→ already・行が増えない]');
await asUser(DRV1, async () => {
  const r1 = (await call('900000000204', '完了')).rows[0].r;
  ok('1回目 result=recorded', r1.result === 'recorded');
  const r2 = (await call('900000000204', '完了')).rows[0].r;
  ok('2回目 result=already（行が増えない）', r2.result === 'already' && r2.status === '完了');
}, { commit: true });
const rr4 = await resultRows('900000000204');
ok('delivery_results 1行のまま（二度押し無害）', rr4.length === 1);
const logs4 = await logRows('900000000204');
ok('ログも2行のまま（仕分済→配送中→完了のみ）', logs4.length === 2);

console.log('\n[5. 他ドライバーの荷物 → errcode 42501 で拒否]');
await asUser(DRV1, async () => {
  await throwsCode('DRV001 は DRV002 の荷物を完了にできない', '42501', () => call('900000000205', '完了'));
});
ok('T5は仕分済のまま（未変更）', (await statusOf('900000000205')) === '仕分済');

console.log('\n[6. area/hq/shipper/anonロール → 42501（driver専用口）]');
await asUser(AREA_A1, async () => {
  await throwsCode('area は record_delivery_result を呼べない', '42501', () => call('900000000206', '完了'));
});
await asUser(HQ1, async () => {
  await throwsCode('hq は record_delivery_result を呼べない', '42501', () => call('900000000206', '完了'));
});
await asUser(SHIP1, async () => {
  await throwsCode('shipper は record_delivery_result を呼べない', '42501', () => call('900000000206', '完了'));
});
await asAnon(async () => {
  await throwsCode('anon は record_delivery_result を呼べない（GRANT無し）', '42501', () => call('900000000206', '完了'));
});
ok('T6は仕分済のまま（未変更）', (await statusOf('900000000206')) === '仕分済');

console.log('\n[7. p_result=破棄 等 → 23514 拒否]');
await asUser(DRV1, async () => {
  await throwsCode('result=破棄 は拒否', '23514', () => call('900000000207', '破棄'));
});

console.log('\n[8. lat=91/lng=181 → 23514 拒否／lat/lng=null は成功]');
await asUser(DRV1, async () => {
  await throwsCode('lat=91（範囲外）は拒否', '23514', () => call('900000000208', '完了', 91, 137));
});
await asUser(DRV1, async () => {
  await throwsCode('lng=181（範囲外）は拒否', '23514', () => call('900000000208', '完了', 35, 181));
});
ok('T8aは仕分済のまま（未変更）', (await statusOf('900000000208')) === '仕分済');
await asUser(DRV1, async () => {
  const r = (await call('900000000209', '完了', null, null)).rows[0].r;
  ok('lat/lng=null でも成功（GPS失敗でも止めない）', r.result === 'recorded' && r.gps === false);
}, { commit: true });
const rr8b = await resultRows('900000000209');
ok('delivery_results lat/lng=null で保存', rr8b.length === 1 && rr8b[0].lat === null && rr8b[0].lng === null);

console.log('\n[9. 未配車/配車済の荷物への完了 → 拒否（線形遷移が守られる）]');
await asUser(DRV1, async () => {
  await throwsCode('未配車（担当なし）は拒否', '42501', () => call('900000000210', '完了'));
});
await asUser(DRV1, async () => {
  await throwsCode('配車済（線形遷移外）は拒否', '23514', () => call('900000000211', '完了'));
});
ok('T9aは未配車のまま', (await statusOf('900000000210')) === '未配車');
ok('T9bは配車済のまま', (await statusOf('900000000211')) === '配車済');

console.log('\n[10. RLS：delivery_results を hq=全件・area=自営業所分・driver=自分のみ・shipper=0件・anon=権限エラー]');
// RLS確認用の追加データ（DRV002＝A01／DRV003＝C01 でそれぞれ完了させる）
await asUser(DRV2, async () => {
  await call('900000000212', '完了');
}, { commit: true });
await asUser(DRV3, async () => {
  await call('900000000213', '完了');
}, { commit: true });

const countAll = async () => (await db.query(`select count(*)::int n from public.delivery_results`)).rows[0].n;
await asUser(HQ1, async () => {
  ok('hq=全件7件', (await countAll()) === 7);
});
await asUser(AREA_A1, async () => {
  const n = await countAll();
  ok('area(A01)=自営業所分6件（DRV001×5＋DRV002×1）', n === 6);
  const rows = (await db.query(`select distinct driver_id from public.delivery_results`)).rows.map((r) => r.driver_id);
  ok('★area(A01)からDRV003(C01)の行は0件', !rows.includes('DRV003'));
});
await asUser(DRV1, async () => {
  ok('driver(DRV001)=自分のみ5件', (await countAll()) === 5);
});
await asUser(SHIP1, async () => {
  ok('★shipper=0件', (await countAll()) === 0);
});
await asAnon(async () => {
  await throwsCode('anon は delivery_results を読めない（GRANT無し）', '42501', () => db.query(`select count(*) from public.delivery_results`));
});

console.log(`\ndelivery_result pglite: ${pass} passed, ${fail} failed`);
await db.close();
if (fail > 0) process.exit(1);
