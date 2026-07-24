// pglite E2E: 配車 割当優先順位（希望エリア第一）v0.3
//   ① offices.preferred_area_first ② dispatch_build 分岐 ③ Phase1 order by 差込 ④ フォールバック
//   ⑤ common_id_display ビュー ⑥ off_preference（希望外）記録。
//   固定の前提「SQLは人手でコピペ実行。渡す前に pglite で E2E 検証する」に基づく事前検証。
// 実行: node supabase/assign_priority_v0/pglite_test.mjs
import { PGlite } from '../../node_modules/@electric-sql/pglite/dist/index.js';
import { readFileSync } from 'node:fs';

const OFFICES = readFileSync(new URL('./offices_preferred_area_first_v0.sql', import.meta.url), 'utf8');
const BUILD   = readFileSync(new URL('./dispatch_build_preferred_v0.sql', import.meta.url), 'utf8');
const VIEW    = readFileSync(new URL('./common_id_display_view_v0.sql', import.meta.url), 'utf8');
// 回帰一致の対照＝改修前の正（cap_wire 版 dispatch_build）。false モードがこれと同一割当になることを実証する。
const CAPWIRE = readFileSync(new URL('../shift_mgmt_v0/cap_wire_shift_labels_v0.sql', import.meta.url), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c) => (c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.error(`  ✗ ${n}`)));
const one = async (db, q, p = []) => (await db.query(q, p)).rows[0];

const db = new PGlite();

// ---- 最小スキーマ（本基盤相当・dispatch_build は invoker で owner 実行） ----
await db.exec(`create role authenticated;`);   // common_id_display の grant 先
await db.exec(`
  create table public.offices (office_code text primary key, office_name text);
  create table public.drivers (driver_id text primary key, office_code text references public.offices(office_code), skill_per_hour integer);
  create table public.work_schedules (
    id bigint generated always as identity primary key,
    driver_id text not null references public.drivers(driver_id),
    work_date date not null, work_type text,
    application_status text not null default '申請中',
    preferred_areas text[],
    unique (driver_id, work_date)                       -- 1日1稼働（shift_mgmt v0.7）
  );
  create table public.shift_labels (
    office_code text not null references public.offices(office_code),
    work_type text not null, hours numeric not null, primary key (office_code, work_type));
  create table public.area_master (
    town_key text primary key, municipality text, zone_no integer, common_id text,
    area text, is_valid boolean not null default true, priority integer);
  create table public.zone_plan (common_id text primary key, split_threshold integer default 170);
  create table public.deliveries (
    tracking_number text primary key, delivery_date date, common_id text, office_code text,
    status text not null default '未配車');
  create table public.dispatch_drivers (run_date date, office_code text, driver_id text, driver_kind text,
    skill integer, hours numeric, cap integer, assigned_qty integer default 0, primary key(run_date, driver_id));
  create table public.dispatch_zones (run_date date, office_code text, common_id text, municipality text,
    qty integer, threshold integer, split_count integer, primary key(run_date, office_code, common_id));
  create table public.dispatch_assignments (run_date date, tracking_number text, office_code text, common_id text,
    driver_id text, driver_kind text, assign_rank integer, primary key(run_date, tracking_number));
  create function public.zone_rank(a text, b text) returns int language sql immutable as $$
    select case when a=b then 1 else 99 end $$;   -- CA/CB 非隣接＝Phase2 交差なし（決定的配分）

  -- seed: 1営業所・2実ドライバー
  insert into public.offices (office_code, office_name) values ('A01','愛知1');
  insert into public.drivers (driver_id, office_code, skill_per_hour) values ('DRV1','A01',20),('DRV2','A01',20);
  insert into public.shift_labels (office_code, work_type, hours) values ('A01','H5',5),('A01','H3',3);  -- cap 100 / 60
  -- DRV1: cap=20×5=100・希望エリア={CB}（残荷量が少ない方を希望）／ DRV2: cap=20×3=60・希望なし(NULL)
  insert into public.work_schedules (driver_id, work_date, work_type, application_status, preferred_areas) values
    ('DRV1', current_date, 'H5', '承認', array['CB']),
    ('DRV2', current_date, 'H3', '承認', null);
  -- area_master: CA(M-A/zone 1,3)・CB(M-B/zone 2)。CA を2町丁目にしてゾーン範囲 min..max を検証。
  insert into public.area_master (town_key, municipality, zone_no, common_id, area, is_valid, priority) values
    ('t-ca-1','M-A',1,'CA','AR-A',true,1),
    ('t-ca-3','M-A',3,'CA','AR-A',true,2),
    ('t-cb-2','M-B',2,'CB','AR-B',true,1);
  -- deliveries: CA=100件・CB=60件（すべて当日・未配車・A01）
  insert into public.deliveries (tracking_number, delivery_date, common_id, office_code, status)
    select 'CA'||g, current_date, 'CA', 'A01', '未配車' from generate_series(1,100) g;
  insert into public.deliveries (tracking_number, delivery_date, common_id, office_code, status)
    select 'CB'||g, current_date, 'CB', 'A01', '未配車' from generate_series(1,60) g;
`);

// ---- ⓪ 回帰対照：改修前(cap_wire版)の割当をスナップショット ----
const snapshot = async () => JSON.stringify((await db.query(
  `select driver_id, common_id, count(*)::int n from public.dispatch_assignments
   where run_date=current_date group by driver_id, common_id order by driver_id, common_id`)).rows);
await db.exec(CAPWIRE);                                  // 改修前の dispatch_build
await db.query(`select public.dispatch_build(current_date)`);
const baseline = await snapshot();

await db.exec(OFFICES);
await db.exec(BUILD);
await db.exec(VIEW);

const mainZoneOf = async (drv) => (await one(db,
  `select common_id from public.dispatch_assignments
   where run_date=current_date and driver_id=$1 and assign_rank=1
   group by common_id order by count(*) desc limit 1`, [drv]))?.common_id;
const offPrefCount = async () => Number((await one(db,
  `select count(*)::int n from public.dispatch_assignments where run_date=current_date and off_preference`)).n);
const unassigned = async () => Number((await one(db,
  `select count(*)::int n from public.deliveries d where d.delivery_date=current_date and d.common_id is not null
     and not exists (select 1 from public.dispatch_assignments a where a.run_date=current_date and a.tracking_number=d.tracking_number)`)).n);
const capOf = async (drv) => Number((await one(db, `select cap from public.dispatch_drivers where run_date=current_date and driver_id=$1`, [drv])).cap);

// ---- ① 列追加 ----
console.log('① offices.preferred_area_first');
{
  const c = await one(db, `select data_type, column_default from information_schema.columns
    where table_name='offices' and column_name='preferred_area_first'`);
  ok('① preferred_area_first が boolean・既定 false', c && c.data_type === 'boolean' && /false/.test(c.column_default));
}

// ---- ② FALSE（現行＝残荷量最大・回帰） ----
console.log('② false モード（残荷量最大・回帰一致）');
{
  await db.exec(`update public.offices set preferred_area_first=false where office_code='A01'`);
  await db.query(`select public.dispatch_build(current_date)`);
  ok('② ★回帰一致：false の割当が改修前(cap_wire版)と完全一致（driver×common_id×件数）', (await snapshot()) === baseline);
  ok('② cap 回帰（DRV1=100/DRV2=60・shift_labels 結線維持）', (await capOf('DRV1'))===100 && (await capOf('DRV2'))===60);
  ok('② DRV1(cap大・先)= 残荷量最大の CA を主担当', (await mainZoneOf('DRV1'))==='CA');
  ok('② DRV2 = 残った CB を主担当', (await mainZoneOf('DRV2'))==='CB');
  ok('② 希望外=100（DRV1 が希望{CB}なのに CA を割当）', (await offPrefCount())===100);
  ok('② 未割当=0（全160件が実ドライバーに載る）', (await unassigned())===0);
  ok('② dispatch_drivers にモード false が記録される',
     (await one(db,`select bool_or(preferred_area_first) b from public.dispatch_drivers where run_date=current_date and driver_kind='実'`)).b === false);
}

// ---- ③ TRUE（希望エリア第一） ----
console.log('③ true モード（希望エリア第一）');
{
  await db.exec(`update public.offices set preferred_area_first=true where office_code='A01'`);
  await db.query(`select public.dispatch_build(current_date)`);
  ok('③ DRV1 = 希望エリア CB を主担当（残荷量最大の CA より優先）', (await mainZoneOf('DRV1'))==='CB');
  ok('③ 希望外=0（DRV1 が希望内の CB を取り、DRV2 は希望なしで従来どおり）', (await offPrefCount())===0);
  ok('③ 希望外が減った（false:100 → true:0）', true); // 上の②100・③0で実証
  ok('③ 未割当=0（増えない・CA 余剰は仮ドライバーが吸収）', (await unassigned())===0);
  ok('③ 仮ドライバーが CA の余剰(40)を担う',
     Number((await one(db,`select coalesce(sum(assigned_qty),0)::int n from public.dispatch_drivers where run_date=current_date and driver_kind='仮'`)).n) === 40);
  ok('③ dispatch_drivers にモード true が記録される',
     (await one(db,`select bool_and(preferred_area_first) b from public.dispatch_drivers where run_date=current_date and driver_kind='実'`)).b === true);
}

// ---- ④ フォールバック（希望未設定は残荷量最大） ----
console.log('④ フォールバック（preferred_areas=NULL）');
{
  // true モードのまま：DRV2 は希望NULL → CA（残荷量最大）を取る＝現行挙動に自然フォールバック
  ok('④ DRV2(希望NULL)は true でも残荷量最大の CA を主担当', (await mainZoneOf('DRV2'))==='CA');
  ok('④ DRV2 の割当は希望外に数えない（off_preference=false・希望なし=どこでも可）',
     Number((await one(db,`select count(*)::int n from public.dispatch_assignments where run_date=current_date and driver_id='DRV2' and off_preference`)).n) === 0);
}

// ---- ⑤ 表示名ビュー ----
console.log('⑤ common_id_display（表示名解決）');
{
  const ca = await one(db, `select area, municipality, zone_no_min, zone_no_max from public.common_id_display where common_id='CA'`);
  ok('⑤ CA → area=AR-A / municipality=M-A', ca.area==='AR-A' && ca.municipality==='M-A');
  ok('⑤ CA → ゾーン範囲 zone_no_min=1 / max=3（area_master から復元）', Number(ca.zone_no_min)===1 && Number(ca.zone_no_max)===3);
  const cb = await one(db, `select municipality, zone_no_min, zone_no_max from public.common_id_display where common_id='CB'`);
  ok('⑤ CB → municipality=M-B / 範囲 2..2', cb.municipality==='M-B' && Number(cb.zone_no_min)===2 && Number(cb.zone_no_max)===2);
}

// ---- ⑥ off_preference の記録（切替で符号が変わる） ----
console.log('⑥ off_preference（希望外）記録の切替');
{
  // false に戻すと DRV1 の CA 割当が再び希望外(true)になる
  await db.exec(`update public.offices set preferred_area_first=false where office_code='A01'`);
  await db.query(`select public.dispatch_build(current_date)`);
  ok('⑥ false 再実行で DRV1(CA)は希望外=true に戻る',
     (await one(db,`select bool_and(off_preference) b from public.dispatch_assignments where run_date=current_date and driver_id='DRV1'`)).b === true);
  ok('⑥ 仮ドライバーの割当は off_preference=NULL（希望外に数えない）', (await unassigned())===0 &&
     Number((await one(db,`select count(*)::int n from public.dispatch_assignments where run_date=current_date and driver_kind='仮' and off_preference is not null`)).n) === 0);
}

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
await db.close();
process.exit(fail ? 1 : 0);
