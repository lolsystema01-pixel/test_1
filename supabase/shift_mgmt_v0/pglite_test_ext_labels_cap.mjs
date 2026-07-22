// pglite: shift_mgmt v0.7 前半3ファイル（列拡張・shift_labels移行・cap結線）の検証
//   固定の前提「SQLは人手でコピペ実行。渡す前に pglite で E2E 検証する」に基づく事前検証。
//
//   検証:
//     A. 列拡張: preferred_areas/is_virtual/is_absent が default 無しで追加・既存行不変・CHECK
//     B. shift_labels 移行: shift_hours 全行 × 全営業所 に複製・hours 一致（cap回帰の下地）
//     C. seed_office_shift_labels: hqのみ・冪等・新設営業所へ配布
//     D. cap 回帰: dispatch_build の cap が shift_labels 差替後も従来（shift_hours 由来）と同値
//     E. ★ラベル未定義は名指しで raise（フォールバックしない・静かな劣化にしない）
// 実行: node supabase/shift_mgmt_v0/pglite_test_ext_labels_cap.mjs
import { PGlite } from '../../node_modules/@electric-sql/pglite/dist/index.js';
import { readFileSync } from 'node:fs';

const EXT   = readFileSync(new URL('./work_schedules_ext_v0.sql', import.meta.url), 'utf8');
const LABELS= readFileSync(new URL('./shift_labels_office_v0.sql', import.meta.url), 'utf8');
const CAP   = readFileSync(new URL('./cap_wire_shift_labels_v0.sql', import.meta.url), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c) => (c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.error(`  ✗ ${n}`)));
const one = async (db, q, p=[]) => (await db.query(q, p)).rows[0];

const db = new PGlite();
await db.exec(`create role authenticated;`);

// ---- 最小スキーマ（本基盤相当）＋ my_* スタブ ----
await db.exec(`
  create table public.offices (office_code text primary key, office_name text, request_period_days integer);
  create table public.drivers (driver_id text primary key, office_code text references public.offices(office_code),
                               skill_per_hour integer, registration_status text default '登録済');
  create table public.work_schedules (
    id bigint generated always as identity primary key,
    driver_id text not null references public.drivers(driver_id),
    work_date date not null, work_type text,
    application_status text not null default '申請中'
      check (application_status in ('申請中','承認','却下'))
  );
  create table public.deliveries (
    tracking_number text primary key, delivery_date date, common_id text,
    office_code text, status text
  );
  create table public.area_master (town_key text primary key, municipality text, common_id text,
                                    is_valid boolean default true, priority integer);
  create table public.zone_plan (common_id text primary key, adjacent_zones text, split_threshold integer default 170);
  create table public.dispatch_drivers (run_date date, office_code text, driver_id text, driver_kind text,
    skill integer, hours numeric, cap integer, assigned_qty integer default 0, primary key(run_date, driver_id));
  create table public.dispatch_zones (run_date date, office_code text, common_id text, municipality text,
    qty integer, threshold integer, split_count integer, primary key(run_date, office_code, common_id));
  create table public.dispatch_assignments (run_date date, tracking_number text, office_code text, common_id text,
    driver_id text, driver_kind text, assign_rank integer, primary key(run_date, tracking_number));
  -- 旧グローバル shift_hours（移行元）
  create table public.shift_hours (work_type text primary key, hours numeric not null);
  insert into public.shift_hours values ('フル',8),('6時間',6),('6中',6),('2時間',2),('半日',4);
  -- zone_rank スタブ（cap回帰テストは配分結果まで見ないので簡易実装で十分）
  create function public.zone_rank(a text, b text) returns int language sql immutable as $$
    select case when a=b then 1 else 99 end $$;
  -- my_* スタブ
  create table public._who (role text, office text, driver text);
  insert into public._who values (null,null,null);
  create function public.my_role() returns text language sql stable as $$ select role from public._who limit 1 $$;
  create function public.my_office() returns text language sql stable as $$ select office from public._who limit 1 $$;
  create function public.my_driver() returns text language sql stable as $$ select driver from public._who limit 1 $$;

  -- seed: 2営業所・4ドライバー
  insert into public.offices values ('A01','愛知1',30),('C01','愛知2',30);
  insert into public.drivers (driver_id, office_code, skill_per_hour) values
    ('DRV001','A01',20),('DRV002','A01',18),('DRV003','C01',22);
`);
const as = (role, office, driver) =>
  db.query(`update public._who set role=$1, office=$2, driver=$3`, [role, office, driver]);

// 承認済み稼働を入れておく（cap 回帰の対象）
await db.exec(`
  insert into public.work_schedules (driver_id, work_date, work_type, application_status) values
    ('DRV001', current_date, 'フル',  '承認'),   -- cap=20×8=160
    ('DRV002', current_date, '6時間', '承認'),   -- cap=18×6=108
    ('DRV003', current_date, 'フル',  '承認');   -- cap=22×8=176（C01）
`);

// ---- A. 列拡張 ----
console.log('A. work_schedules 列拡張');
await db.exec(EXT);
{
  const cols = (await db.query(`
    select column_name, is_nullable, column_default from information_schema.columns
    where table_schema='public' and table_name='work_schedules'
      and column_name in ('preferred_areas','is_virtual','is_absent') order by column_name`)).rows;
  ok('A. 3列が追加され default 無し・nullable',
     cols.length === 3 && cols.every(c => c.is_nullable === 'YES' && c.column_default === null));
  ok('A. preferred_areas は text[]',
     (await one(db, `select data_type from information_schema.columns
       where table_name='work_schedules' and column_name='preferred_areas'`)).data_type === 'ARRAY');
  // CHECK: 重複要素を弾く
  let dup = null;
  try { await db.exec(`update public.work_schedules set preferred_areas = array['X','X'] where driver_id='DRV001'`); }
  catch (e) { dup = e.message; }
  ok('A. 希望エリアの重複要素は CHECK で拒否', dup !== null);
  ok('A. 正常な希望エリアは通る',
     await db.exec(`update public.work_schedules set preferred_areas = array['OKZ_C_01_06','GM2_07_07'] where driver_id='DRV001'`)
       .then(()=>true).catch(()=>false));
}

// ---- B. shift_labels 移行 ----
console.log('B. shift_labels 移行（全営業所複製）');
await db.exec(LABELS);
{
  const r = await one(db, `select
    (select count(*) from public.offices)*(select count(*) from public.shift_hours) as expected,
    (select count(*) from public.shift_labels) as actual`);
  ok('B. 全営業所×全ラベルが複製された（expected=actual）', Number(r.expected) === Number(r.actual) && Number(r.actual) === 10);
  const diff = (await db.query(`select count(*)::int as n from public.shift_labels sl
    join public.shift_hours sh on sh.work_type=sl.work_type where sl.hours<>sh.hours`)).rows[0].n;
  ok('B. hours が shift_hours と一致（cap回帰の下地・差分0）', diff === 0);
}

// ---- C. seed_office_shift_labels ----
console.log('C. seed_office_shift_labels（配布口）');
{
  await db.exec(`insert into public.offices values ('B99','新設',30)`);
  await as('hq', null, null);
  const n = (await one(db, `select public.seed_office_shift_labels('B99') as n`)).n;
  ok('C. hq が新設営業所へ標準ラベルを配布（5件）', Number(n) === 5);
  ok('C. 再実行は0件（冪等・上書きしない）', Number((await one(db, `select public.seed_office_shift_labels('B99') as n`)).n) === 0);
  await as('area', 'A01', null);
  let e = null; try { await db.query(`select public.seed_office_shift_labels('A01')`); } catch (x) { e = x.message; }
  ok('C. area は配布できない（hqのみ）', e !== null);
  await db.exec(`delete from public.shift_labels where office_code='B99'; delete from public.offices where office_code='B99'`);
}

// ---- D/E. cap 結線 ----
console.log('D/E. cap 結線（dispatch_build）');
await db.exec(CAP);
{
  // 未配車の荷物を少量（配分は簡易 zone_rank だが cap 値だけ検証する）
  await db.exec(`
    insert into public.area_master values ('t','岡崎市','OKZ_C_01_06',true,1);
    insert into public.zone_plan values ('OKZ_C_01_06', null, 170);
    insert into public.deliveries
      select 'D'||g, current_date, 'OKZ_C_01_06', 'A01', '未配車' from generate_series(1,5) g;
  `);
  await db.query(`select public.dispatch_build(current_date)`);
  // D. cap が従来（skill×shift_hours.hours）と同値
  const caps = Object.fromEntries((await db.query(`
    select driver_id, cap from public.dispatch_drivers where run_date=current_date and driver_kind='実'`)).rows
    .map(r => [r.driver_id, Number(r.cap)]));
  ok('D. DRV001 cap=160（20×8・shift_labels 差替後も同値）', caps['DRV001'] === 160);
  ok('D. DRV002 cap=108（18×6）', caps['DRV002'] === 108);
  ok('D. DRV003 cap=176（22×8・別営業所C01）', caps['DRV003'] === 176);

  // E. ラベル未定義 → 名指し raise
  await db.exec(`delete from public.shift_labels where office_code='A01' and work_type='フル'`);
  let err = null;
  try { await db.query(`select public.dispatch_build(current_date)`); } catch (e) { err = e.message; }
  ok('E. A01/フル のラベルを消すと dispatch_build が停止する（silent に落とさない）', err !== null);
  ok('E. エラーが営業所と稼働区分を名指しする（A01／フル）',
     err !== null && /A01/.test(err) && /フル/.test(err));
  ok('E. エラーが管理者設定/配布口へ誘導する', err !== null && /管理者設定|seed_office_shift_labels/.test(err));
}

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
await db.close();
process.exit(fail ? 1 : 0);
