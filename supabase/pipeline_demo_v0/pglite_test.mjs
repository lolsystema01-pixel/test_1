// pglite: demo_* 関数がコンパイル・実行できるか（pipelineはスタブ）を検証。
import { PGlite } from '../../node_modules/@electric-sql/pglite/dist/index.js';
import { readFileSync } from 'node:fs';
const db = new PGlite();
let pass = 0, fail = 0;
const ok = (n, c) => (c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.error(`  ✗ ${n}`)));
const D = '2026-06-29';

await db.exec(`
  create role anon; create role authenticated;
  create table public.deliveries (
    tracking_number text primary key, delivery_date date, address text,
    common_id text, zone_no int, driver_id text, delivery_order int, basket_code text, status text
  );
  create table public.dispatch_assignments (run_date date, tracking_number text, driver_id text);
  create table public.dispatch_zones (run_date date);
  create table public.dispatch_drivers (run_date date, driver_kind text, assigned_qty int);
  create table public.renumber_plan (run_date date, tracking_number text, driver_id text, delivery_order int, basket_code text, common_id text);
  create table public.delivery_index (tracking_number text primary key, driver_id text, delivery_order int, basket_code text, common_id text);
  create table public.delivery_status_log (id bigint generated always as identity primary key, tracking_number text, from_status text, to_status text, changed_at timestamptz default now(), changed_by uuid, actor text, source text, note text);
  insert into public.deliveries values ('T1','${D}','兵庫県西宮市高須町1-1','NSM_SW_31_37',32,null,null,null,'未配車');

  -- pipeline スタブ（冪等：delete→insert）
  create function public.dispatch_build(p_date date) returns void language plpgsql as $$
  begin delete from public.dispatch_assignments where run_date=p_date;
    insert into public.dispatch_assignments select p_date, tracking_number, 'ITD001' from public.deliveries where delivery_date=p_date and status='未配車'; end $$;
  create function public.renumber_build(p_date date) returns void language plpgsql as $$
  begin delete from public.renumber_plan where run_date=p_date;
    insert into public.renumber_plan select p_date, tracking_number, driver_id, 1, 'E', common_id from public.deliveries where delivery_date=p_date and driver_id is not null; end $$;
`);

// demo関数を適用
await db.exec(readFileSync(new URL('./demo_functions_v0.sql', import.meta.url), 'utf8'));

console.log('\n[demo_* 関数のコンパイル・実行]');
// dry-run（プレビュー）→ deliveries はまだ未配車のまま
const dprev = (await db.query(`select public.demo_dispatch_preview($1::date) r`, [D])).rows[0].r;
ok('demo_dispatch_preview（割当1・deliveries未書込）', dprev.to_dispatch === 1 &&
  (await db.query(`select status from public.deliveries where tracking_number='T1'`)).rows[0].status === '未配車');
const disp = (await db.query(`select public.demo_dispatch($1::date) r`, [D])).rows[0].r;
ok('demo_dispatch 実行→配車済1', disp.dispatched === 1 && disp.drivers === 1);
const logn = (await db.query(`select count(*)::int n from public.delivery_status_log where source='配車' and to_status='配車済'`)).rows[0].n;
ok('★記録口を通さず system で遷移ログ直書き（1件・actor=system）', logn === 1 && (await db.query(`select actor from public.delivery_status_log limit 1`)).rows[0].actor === 'system');
const rprev = (await db.query(`select public.demo_renumber_preview($1::date) r`, [D])).rows[0].r;
ok('demo_renumber_preview（plan1・deliveries未反映）', rprev.plan_rows === 1 &&
  (await db.query(`select delivery_order from public.deliveries where tracking_number='T1'`)).rows[0].delivery_order === null);
const num = (await db.query(`select public.demo_renumber($1::date) r`, [D])).rows[0].r;
ok('demo_renumber 実行→採番1', num.numbered === 1);
const sum = (await db.query(`select public.demo_summary($1::date) r`, [D])).rows[0].r;
ok('demo_summary（配車済/採番）', sum.dispatched === 1 && sum.numbered === 1 && sum.total === 1);
const ord = (await db.query(`select * from public.demo_delivery_order($1::date, null, 60)`, [D])).rows;
ok('demo_delivery_order 行取得（zone_no=32）', ord.length === 1 && ord[0].zone_no === 32);
const drv = (await db.query(`select * from public.demo_drivers($1::date)`, [D])).rows;
ok('demo_drivers（ITD001）', drv.length === 1 && drv[0].driver_id === 'ITD001');
const rst = (await db.query(`select public.demo_reset($1::date) r`, [D])).rows[0].r;
ok('demo_reset→未配車に戻る', rst.unassigned === 1);
ok('リセット後 status=未配車・order/driver=null', (await db.query(`select status,driver_id,delivery_order from public.deliveries where tracking_number='T1'`)).rows[0].status === '未配車');

// grant 確認
const g = (await db.query(`select count(*)::int n from information_schema.role_routine_grants where grantee='anon' and routine_name like 'demo\\_%'`)).rows[0].n;
ok('anon に demo_* の実行権限が付与', g >= 6);

console.log(`\npipeline_demo: ${pass} passed, ${fail} failed`);
await db.close();
if (fail > 0) process.exit(1);
