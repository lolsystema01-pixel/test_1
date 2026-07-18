// pglite E2E: 置き配写真POD v0（delivery_results.photo_path ＋ 記録口 attach_delivery_photo）。
//   storage.objects は pgliteに（Supabase Storage実装が）無いため、storage.buckets/storage.objects/
//   storage.foldername は「delivery_photo_v0.sql の全文がそのままエラー無く適用できる」ことの確認
//   に必要な最小スタブのみ用意する（auth_rls_remaining_v1/pglite_test_storage.mjs と同方式）。
//   Storageポリシーの実効性（実際のオブジェクトへのINSERT/SELECT拒否）はここでは検証しない
//   ＝ rpc（attach_delivery_photo）と column（photo_path）部分のみを本テストの対象とする。
// 実行: node supabase/delivery_photo_v0/pglite_test.mjs
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

// --- ダミーUUID（正準規格 v1: 愛知A01/C01・DRV001-003・SHIP01 に対応。delivery_result_v0と同じ割当）---
const HQ1 = '00000000-0000-0000-0000-000000000001'; // hq
const DEPOT_D1 = '00000000-0000-0000-0000-0000000000e1'; // depot D01（配下=A01）
const AREA_A1 = '00000000-0000-0000-0000-0000000000a1'; // area A01
const SHIP1 = '00000000-0000-0000-0000-0000000000f1'; // shipper SHIP01
const DRV1 = '00000000-0000-0000-0000-0000000000d1'; // driver DRV001（A01）
const DRV2 = '00000000-0000-0000-0000-0000000000d2'; // driver DRV002（A01・他ドライバー）

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

// --- Supabase互換の最小スタブ（delivery_result_v0/pglite_test.mjs と同一の下地）---
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

  alter table public.drivers enable row level security;
  create policy drivers_hq     on public.drivers for select to authenticated using ( public.my_role()='hq' );
  create policy drivers_area   on public.drivers for select to authenticated using ( public.my_role()='area'   and office_code=public.my_office() );
  create policy drivers_self   on public.drivers for select to authenticated using ( public.my_role()='driver' and driver_id=public.my_driver() );

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
    ('${HQ1}',      'hq',      null,  null,  null,     null),
    ('${DEPOT_D1}', 'depot',   'D01', null,  null,     null),
    ('${AREA_A1}',  'area',    'D01', 'A01', null,     null),
    ('${SHIP1}',    'shipper', null,  null,  null,     'SHIP01'),
    ('${DRV1}',     'driver',  'D01', 'A01', 'DRV001', null),
    ('${DRV2}',     'driver',  'D01', 'A01', 'DRV002', null);

  -- 9000帯12桁（本モジュール専用レンジ 900000000401〜404・他モジュールと非衝突）
  -- status='仕分済' で投入し、record_delivery_result 経由で完了化する（delivery_results 行を
  -- 正規のパスで作らないと photo_path attach の前提行が無いため）。
  insert into public.deliveries (tracking_number, office_code, driver_id, shipper_id, status) values
    ('900000000401','A01','DRV001','SHIP01','仕分済'),  -- T1系: DRV001所有・写真attach対象
    ('900000000402','A01','DRV002','SHIP01','仕分済'),  -- T4: DRV002所有（DRV001が触れない）
    ('900000000403','A01','DRV001','SHIP01','仕分済'),  -- T5: パス接頭辞違反の対象
    ('900000000404','A01','DRV001','SHIP01','仕分済');  -- T7: 非driverロール拒否の対象
  -- 900000000405 は意図的に deliveries/delivery_results どちらにも作らない（T8: 未存在）

  -- storage スキーマの最小スタブ（delivery_photo_v0.sql の全文適用を通すためだけの最小限。
  -- 実オブジェクトのRLS実効性はここでは検証しない＝auth_rls_remaining_v1/pglite_test_storage.mjs と同方式）
  create schema storage;
  create table storage.buckets (
    id text primary key, name text, public boolean,
    file_size_limit bigint, allowed_mime_types text[]
  );
  create table storage.objects (id bigint generated always as identity primary key, bucket_id text, name text);
  create or replace function storage.foldername(name text) returns text[] language sql immutable as $$
    select (string_to_array(name, '/'))[1 : array_length(string_to_array(name, '/'), 1) - 1]
  $$;
  alter table storage.objects enable row level security;
  grant usage on schema storage to authenticated;
  grant select, insert on storage.objects to authenticated;
`);

// 依存記録口＋本体を適用
await db.exec(readFileSync(new URL('../status_log_v0/status_log_v0.sql', import.meta.url), 'utf8'));
await db.exec(readFileSync(new URL('../status_log_v0/record_status_transition_v0.sql', import.meta.url), 'utf8'));
await db.exec(readFileSync(new URL('../delivery_result_v0/delivery_result_v0.sql', import.meta.url), 'utf8'));

// delivery_photo_v0.sql: ⑤の確認クエリ（pg_policies等）は末尾に含まれるが postgres専用の情報照会でしかない
// ため、そのまま流してもpgliteで害はない（結果は捨てる）。全文が例外なく適用できることを確認する。
let applyOk = true;
try {
  await db.exec(readFileSync(new URL('./delivery_photo_v0.sql', import.meta.url), 'utf8'));
} catch (e) {
  applyOk = false;
  console.error('delivery_photo_v0.sql 適用時エラー:', e.message);
}
ok('delivery_photo_v0.sql が例外なく適用できる（Storageスタブ込み）', applyOk);

console.log('\n[0. スキーマ確認：photo_path列・Storageポリシー2件]');
{
  const col = await db.query(
    `select data_type from information_schema.columns where table_schema='public' and table_name='delivery_results' and column_name='photo_path'`
  );
  ok('delivery_results.photo_path 列が存在する（text）', col.rows.length === 1 && col.rows[0].data_type === 'text');
  const pol = await db.query(
    `select policyname from pg_policies where schemaname='storage' and tablename='objects' and policyname in ('delivery_photos_insert','delivery_photos_select')`
  );
  ok('Storageポリシーが2件（insert/select）登録されている', pol.rows.length === 2);
}

const call = (tn, path) => db.query(`select public.attach_delivery_photo($1,$2) r`, [tn, path]);
const photoOf = async (tn) =>
  (await db.query(`select photo_path from public.delivery_results where tracking_number=$1 order by id desc limit 1`, [tn])).rows[0]
    ?.photo_path;

// まず DRV001/DRV002 として record_delivery_result 経由で delivery_results 行を作る
// （attach_delivery_photo は delivery_results 行の存在＋所有者一致が前提のため）
await asUser(DRV1, async () => {
  await db.query(`select public.record_delivery_result($1,'完了')`, ['900000000401']);
  await db.query(`select public.record_delivery_result($1,'完了')`, ['900000000403']);
  await db.query(`select public.record_delivery_result($1,'完了')`, ['900000000404']);
}, { commit: true });
await asUser(DRV2, async () => {
  await db.query(`select public.record_delivery_result($1,'完了')`, ['900000000402']);
}, { commit: true });

console.log('\n[1. 本人紐付けOK：DRV001が自分のフォルダ配下のパスをattach → recorded]');
await asUser(DRV1, async () => {
  const r = (await call('900000000401', 'DRV001/900000000401.jpg')).rows[0].r;
  ok('result=recorded', r.result === 'recorded');
  ok('photo_path が返り値に含まれる', r.photo_path === 'DRV001/900000000401.jpg');
}, { commit: true });
ok('delivery_results.photo_path が保存されている', (await photoOf('900000000401')) === 'DRV001/900000000401.jpg');

console.log('\n[2. 冪等：同一パスを再送 → already・値は変わらない]');
await asUser(DRV1, async () => {
  const r = (await call('900000000401', 'DRV001/900000000401.jpg')).rows[0].r;
  ok('result=already', r.result === 'already');
}, { commit: true });
ok('photo_path は変化しない', (await photoOf('900000000401')) === 'DRV001/900000000401.jpg');

console.log('\n[3. 既に別の写真がある行への上書きは拒否（23505ではない明示エラー）]');
await asUser(DRV1, async () => {
  await throwsCode('別パスでのattachは拒否される（P0001＝明示エラー・23505ではない）', 'P0001', () =>
    call('900000000401', 'DRV001/900000000401_retake.jpg')
  );
});
ok('photo_path は書き換わっていない（上書き防止）', (await photoOf('900000000401')) === 'DRV001/900000000401.jpg');

console.log('\n[4. 他人拒否：DRV001がDRV002所有の delivery_results 行にattach → 42501]');
await asUser(DRV1, async () => {
  await throwsCode('DRV001 は DRV002 所有の実績にattachできない', '42501', () =>
    call('900000000402', 'DRV001/900000000402.jpg')
  );
});
ok('T4は未attachのまま（photo_path=null）', (await photoOf('900000000402')) == null);

console.log('\n[5. パス接頭辞検証：自分以外のフォルダ・ルート直下は拒否 → 42501]');
await asUser(DRV1, async () => {
  await throwsCode('他人（DRV002）のフォルダを指すパスは拒否', '42501', () =>
    call('900000000403', 'DRV002/900000000403.jpg')
  );
});
await asUser(DRV1, async () => {
  await throwsCode('ルート直下（フォルダ無し）のパスは拒否', '42501', () => call('900000000403', '900000000403.jpg'));
});
ok('T5は未attachのまま（photo_path=null）', (await photoOf('900000000403')) == null);

console.log('\n[6. 入力検証：300文字超のパスは拒否 → 23514]');
await asUser(DRV1, async () => {
  const longPath = 'DRV001/' + 'a'.repeat(300) + '.jpg';
  await throwsCode('300文字超のパスは拒否', '23514', () => call('900000000403', longPath));
});

console.log('\n[7. 非driver拒否：area/hq/shipper/anon は attach_delivery_photo を呼べない → 42501]');
await asUser(AREA_A1, async () => {
  await throwsCode('area は attach_delivery_photo を呼べない', '42501', () =>
    call('900000000404', 'A01/x.jpg')
  );
});
await asUser(HQ1, async () => {
  await throwsCode('hq は attach_delivery_photo を呼べない', '42501', () => call('900000000404', 'x/x.jpg'));
});
await asUser(SHIP1, async () => {
  await throwsCode('shipper は attach_delivery_photo を呼べない', '42501', () => call('900000000404', 'x/x.jpg'));
});
await asAnon(async () => {
  await throwsCode('anon は attach_delivery_photo を呼べない（GRANT無し）', '42501', () =>
    call('900000000404', 'x/x.jpg')
  );
});
ok('T7は未attachのまま（photo_path=null）', (await photoOf('900000000404')) == null);

console.log('\n[8. delivery_results 未存在は拒否 → P0002]');
await asUser(DRV1, async () => {
  await throwsCode('delivery_results 行が無い問合番号は拒否', 'P0002', () =>
    call('900000000405', 'DRV001/900000000405.jpg')
  );
});

console.log(`\ndelivery_photo pglite: ${pass} passed, ${fail} failed`);
await db.close();
if (fail > 0) process.exit(1);
