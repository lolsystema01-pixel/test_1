// pglite E2E: 配車サマリ（仮割当・保留・希望外）v0.2 — deliveries ベース集計ビュー
//   3指標／ドライバー別内訳／明細カテゴリ／RLS範囲外0件（area自営業所のみ）／希望外の#28同一条件。
// 実行: node supabase/dispatch_summary_v0/pglite_test.mjs
import { PGlite } from '../../node_modules/@electric-sql/pglite/dist/index.js';
import { readFileSync } from 'node:fs';

const VIEW = readFileSync(new URL('./dispatch_summary_v0.sql', import.meta.url), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c) => (c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.error(`  ✗ ${n}`)));
const one = async (db, q, p = []) => (await db.query(q, p)).rows[0];

const A01 = '00000000-0000-0000-0000-0000000000a1';  // area A01
const C01 = '00000000-0000-0000-0000-0000000000c1';  // area C01

const db = new PGlite();
await db.exec(`create role authenticated;`);
await db.exec(`
  create schema if not exists auth;
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub','')::uuid $$;
  grant usage on schema auth, public to authenticated;
  grant execute on function auth.uid() to authenticated;

  create table public.profiles (user_id uuid primary key, role text, office_code text);
  create or replace function public.my_role()   returns text language sql stable security definer set search_path=public as $$ select role from public.profiles where user_id=auth.uid() $$;
  create or replace function public.my_office() returns text language sql stable security definer set search_path=public as $$ select office_code from public.profiles where user_id=auth.uid() $$;

  create table public.offices (office_code text primary key);
  create table public.drivers (driver_id text primary key, office_code text);
  create table public.work_schedules (
    id bigint generated always as identity primary key,
    driver_id text not null, work_date date not null, work_type text,
    application_status text not null default '申請中', preferred_areas text[],
    unique (driver_id, work_date));                                   -- 1日1稼働（shift_mgmt v0.7）
  create table public.deliveries (
    tracking_number text primary key, delivery_date date, common_id text,
    office_code text, driver_id text, status text not null default '未配車');
  alter table public.deliveries enable row level security;
  grant select on public.deliveries to authenticated;
  grant select on public.work_schedules to authenticated;   -- security_invoker: 希望外の join 先も呼出元が読める必要（実Supabaseは付与済み＋RLS）
  create policy d_area on public.deliveries for select to authenticated
    using ( public.my_role()='area' and office_code = public.my_office() );

  insert into public.offices values ('A01'),('C01');
  insert into public.profiles values ('${A01}','area','A01'),('${C01}','area','C01');
  insert into public.drivers values ('DRV1','A01'),('DRV2','A01'),('DRV3','A01'),('CDRV1','C01');

  -- 承認稼働＋希望エリア（DRV1={ZA}希望内 / DRV2={ZA}→ZBは希望外 / DRV3=NULL希望なし）
  insert into public.work_schedules (driver_id, work_date, work_type, application_status, preferred_areas) values
    ('DRV1', current_date, 'フル', '承認', array['ZA']),
    ('DRV2', current_date, 'フル', '承認', array['ZA']),
    ('DRV3', current_date, 'フル', '承認', null),
    ('CDRV1',current_date, 'フル', '承認', array['ZD']);

  -- deliveries（配車後の実体：driver_id 書戻し済みを模す）
  --   A01: ZA×5(DRV1・希望内) / ZB×3(DRV2・希望外) / ZC×4(仮1・仮割当) / 保留×2 / ZA×2(DRV3・希望なし)
  insert into public.deliveries (tracking_number, delivery_date, common_id, office_code, driver_id, status)
    select 'A-ZA-'||g, current_date, 'ZA','A01','DRV1','配車済' from generate_series(1,5) g;
  insert into public.deliveries (tracking_number, delivery_date, common_id, office_code, driver_id, status)
    select 'A-ZB-'||g, current_date, 'ZB','A01','DRV2','配車済' from generate_series(1,3) g;
  insert into public.deliveries (tracking_number, delivery_date, common_id, office_code, driver_id, status)
    select 'A-ZC-'||g, current_date, 'ZC','A01','仮1','配車済' from generate_series(1,4) g;
  insert into public.deliveries (tracking_number, delivery_date, common_id, office_code, driver_id, status)
    select 'A-HD-'||g, current_date, null,'A01',null,'保留' from generate_series(1,2) g;
  insert into public.deliveries (tracking_number, delivery_date, common_id, office_code, driver_id, status)
    select 'A-ZA2-'||g, current_date, 'ZA','A01','DRV3','配車済' from generate_series(1,2) g;
  -- C01: ZD×3(CDRV1) ＝ RLS範囲内>0 の対
  insert into public.deliveries (tracking_number, delivery_date, common_id, office_code, driver_id, status)
    select 'C-ZD-'||g, current_date, 'ZD','C01','CDRV1','配車済' from generate_series(1,3) g;
`);

await db.exec(VIEW);

const asArea = async (uid, sql) => {
  await db.exec('begin');
  await db.exec(`set local request.jwt.claims = '${JSON.stringify({ role: 'authenticated', sub: uid })}'`);
  await db.exec('set local role authenticated');
  try { return (await db.query(sql)).rows; } finally { await db.exec('rollback'); await db.exec('reset role'); }
};

// ---- ① 3指標（owner・A01/当日） ----
console.log('① dispatch_summary 3指標（A01/当日）');
{
  const s = await one(db, `select * from public.dispatch_summary where office_code='A01' and delivery_date=current_date`);
  ok('① 受信=16', Number(s.received) === 16);
  ok('① 仮割当 件数=4 / 人数=1（driver_id LIKE 仮%）', Number(s.virtual_items) === 4 && Number(s.virtual_drivers) === 1);
  ok('① 保留=2（common_id NULL かつ status=保留）', Number(s.hold_items) === 2);
  ok('① 希望外=3（DRV2 の ZB×3・実／common_id∉preferred／NULLでない）', Number(s.off_preference_items) === 3);
  // 概況カード整合の代理検証：仮割当は「driver_id LIKE 仮%」定義と一致
  const vm = Number((await one(db, `select count(*)::int n from public.deliveries where office_code='A01' and delivery_date=current_date and driver_id like '仮%'`)).n);
  ok('① 仮割当は office_home_summary と同一定義（driver_id LIKE 仮%）で一致', Number(s.virtual_items) === vm);
}

// ---- ② 希望外の #28 同一条件（NULL は数えない・実のみ） ----
console.log('② 希望外の条件（#28 同一・NULL は数えない・実のみ）');
{
  const d = Object.fromEntries((await db.query(
    `select driver_id, is_virtual, items, off_preference_items from public.dispatch_summary_by_driver
     where office_code='A01' and delivery_date=current_date`)).rows.map(r => [r.driver_id, r]));
  ok('② DRV1(希望{ZA}・ZA担当)=希望外0', Number(d['DRV1'].off_preference_items) === 0);
  ok('② DRV2(希望{ZA}・ZB担当)=希望外3', Number(d['DRV2'].off_preference_items) === 3);
  ok('② DRV3(希望NULL)=希望外0（希望なし＝数えない）', Number(d['DRV3'].off_preference_items) === 0);
  ok('② 仮1 は is_virtual=true・希望外0（仮は希望外に数えない）', d['仮1'].is_virtual === true && Number(d['仮1'].off_preference_items) === 0);
}

// ---- ③ 明細カテゴリ ----
console.log('③ dispatch_summary_detail（明細カテゴリ）');
{
  const cat = Object.fromEntries((await db.query(
    `select category, count(*)::int n from public.dispatch_summary_detail
     where office_code='A01' and delivery_date=current_date group by category`)).rows.map(r => [r.category, Number(r.n)]));
  ok('③ 仮割当=4 / 保留=2 / 希望外=3 / 正常=7（ZA5+ZA2）', cat['仮割当']===4 && cat['保留']===2 && cat['希望外']===3 && cat['正常']===7);
}

// ---- ④ RLS：area は自営業所のみ・範囲外0件（範囲内>0 と対で） ----
console.log('④ RLS（security_invoker・area 自営業所のみ）');
{
  const a01 = await asArea(A01, `select office_code, received, virtual_items from public.dispatch_summary`);
  ok('④ area A01：自営業所 A01 が見える（範囲内>0・受信16）', a01.length===1 && a01[0].office_code==='A01' && Number(a01[0].received)===16);
  ok('④ area A01：C01 は見えない（範囲外0件）', !a01.some(r => r.office_code==='C01'));
  const c01 = await asArea(C01, `select office_code, received from public.dispatch_summary`);
  ok('④ area C01：自営業所 C01 が見える（範囲内>0・受信3）', c01.length===1 && c01[0].office_code==='C01' && Number(c01[0].received)===3);
  ok('④ area C01：A01 は見えない（範囲外0件）', !c01.some(r => r.office_code==='A01'));
  // detail も同型
  const det = await asArea(A01, `select distinct office_code from public.dispatch_summary_detail`);
  ok('④ detail も area A01 は A01 のみ（範囲外0件）', det.length===1 && det[0].office_code==='A01');
}

// ---- ⑤ 希望外は preferred_areas 未投入なら0（#28/シフトv0.7 前の状態） ----
console.log('⑤ 希望外フォールバック（preferred_areas 全NULL→0）');
{
  await db.exec('begin');
  await db.exec(`update public.work_schedules set preferred_areas = null`);
  const off = Number((await one(db, `select off_preference_items n from public.dispatch_summary where office_code='A01' and delivery_date=current_date`)).n);
  await db.exec('rollback');
  ok('⑤ 希望が全て未設定なら希望外=0（実装前は常に0）', off === 0);
}

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
await db.close();
process.exit(fail ? 1 : 0);
