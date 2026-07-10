// pglite E2E: office_home_summary ビュー（受信/配車済/仮配車/最終配車実行/再予測合図/状態行）
// 実行: node supabase/office_home_v0/pglite_test.mjs
import { PGlite } from '../../node_modules/@electric-sql/pglite/dist/index.js';
import { readFileSync } from 'node:fs';

const db = new PGlite();
let pass = 0, fail = 0;
const ok = (n, c) => (c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.error(`  ✗ ${n}`)));
const D = '2026-09-01';

// 前提テーブル（本番スキーマの必要最小。imported_at はビューSQLの alter で追加させる）
await db.exec(`
  create role authenticated;
  create role anon;
  create table public.offices (office_code text primary key, office_name text);
  create table public.deliveries (
    tracking_number text primary key,
    delivery_date   date,
    address         text,
    common_id       text,
    depot_code      text,
    office_code     text,
    driver_id       text,
    delivery_order  integer,
    basket_code     text,
    status          text not null default '未配車',
    time_window     text,
    shipper_id      text,
    import_batch_id text
  );
  create table public.delivery_status_log (
    id bigint generated always as identity primary key,
    tracking_number text not null,
    from_status text, to_status text not null,
    changed_at timestamptz not null default now(),
    changed_by uuid, actor text not null default 'system', source text, note text
  );
  insert into public.offices values ('IT01','伊丹営業所'),('A01','愛知県1営業所');
`);

// 出荷するビューSQLをそのまま流す（alter imported_at ＋ view ＋ realtime DOブロック）
const sql = readFileSync(new URL('./office_home_summary_v0.sql', import.meta.url), 'utf8');
await db.exec(sql);
ok('office_home_summary_v0.sql が適用できる（alter＋view）', true);

// ── 規約: security_invoker=on（RLS継承）が付いていること ──
{
  const r = (await db.query(
    `select coalesce(array_to_string(reloptions, ','), '') as opts from pg_class where relname='office_home_summary'`
  )).rows[0];
  ok(`security_invoker が有効（reloptions=${r.opts}）`, /security_invoker=(on|true)/.test(r.opts));
}

// ── 規約: ビューの列名がフロント型 OfficeHomeCard と一致すること ──
{
  const NEED = ['office_code','delivery_date','received','real_drivers','real_items','virt_drivers','virt_items',
                'dispatched_items','sorted_items','last_dispatch_at','last_import_at','need_repredict','state_line','state_color'];
  const cols = (await db.query(
    `select column_name from information_schema.columns where table_schema='public' and table_name='office_home_summary'`
  )).rows.map((r) => r.column_name);
  const missing = NEED.filter((c) => !cols.includes(c));
  ok(`ビュー列名がフロント型と一致（欠落: ${missing.join(',') || 'なし'}）`, missing.length === 0);
}

const card = async () => (await db.query(
  `select * from public.office_home_summary where office_code='IT01' and delivery_date=$1`, [D]
)).rows[0];

// ── 状態1: 受信のみ（未配車）→『予測配車を実行してください』 ──
await db.query(
  `insert into public.deliveries (tracking_number, delivery_date, office_code, status, imported_at)
   select 'OH-'||lpad(g::text,3,'0'), $1, 'IT01', '未配車', now() - interval '3 hours'
   from generate_series(1,10) g`, [D]);
let c = await card();
ok('受信=10', Number(c.received) === 10);
ok('配車0（実0・仮0）', Number(c.dispatched_items) === 0);
ok("状態行=予測配車を実行してください", c.state_line === '予測配車を実行してください');
ok('色=青', c.state_color === '青');

// ── 状態2: 配車（実2名6件・仮1名2件・未配車2件）→『仕分けを進めてください』 ──
await db.exec(`
  update public.deliveries set driver_id='OHD1', status='配車済' where tracking_number in ('OH-001','OH-002','OH-003');
  update public.deliveries set driver_id='OHD2', status='配車済' where tracking_number in ('OH-004','OH-005','OH-006');
  update public.deliveries set driver_id='仮OH1', status='配車済' where tracking_number in ('OH-007','OH-008');
  insert into public.delivery_status_log (tracking_number, from_status, to_status, changed_at, actor, source)
  select tracking_number, '未配車', '配車済', now() - interval '1 hour', 'system', '配車'
  from public.deliveries where tracking_number like 'OH-%' and driver_id is not null;
`);
c = await card();
ok('配車済 実 2人/6件', Number(c.real_drivers) === 2 && Number(c.real_items) === 6);
ok('仮配車 1人/2件', Number(c.virt_drivers) === 1 && Number(c.virt_items) === 2);
ok('最終配車実行が入る', c.last_dispatch_at != null);
ok('再予測合図=false（最新受信 < 最終配車実行）', c.need_repredict === false);
ok('状態行=仕分けを進めてください', c.state_line === '仕分けを進めてください');

// ── 状態3: 新規受信（配車の後）→ 再予測合図＋『再予測してください』 ──
await db.query(
  `insert into public.deliveries (tracking_number, delivery_date, office_code, status, imported_at)
   select 'OH-'||lpad(g::text,3,'0'), $1, 'IT01', '未配車', now()
   from generate_series(11,13) g`, [D]);
c = await card();
ok('受信=13', Number(c.received) === 13);
ok('再予測合図=true（最新受信 > 最終配車実行）', c.need_repredict === true);
ok('状態行=再予測してください', c.state_line === '再予測してください');

// ── 状態4: 新規受信を消し全配車済を仕分済 →『仕分け完了・出力可能』(緑) ──
await db.exec(`
  delete from public.deliveries where tracking_number in ('OH-011','OH-012','OH-013');
  update public.deliveries set status='仕分済' where tracking_number like 'OH-%' and driver_id is not null;
`);
c = await card();
ok('仕分済=配車済総数（全件仕分済）', Number(c.sorted_items) === Number(c.dispatched_items) && Number(c.sorted_items) === 8);
ok('再予測合図=false', c.need_repredict === false);
ok('状態行=仕分け完了・出力可能', c.state_line === '仕分け完了・出力可能');
ok('色=緑', c.state_color === '緑');

// ── ステータス実値は '配車済'/'仕分済'（'配車済み' ではない） ──
{
  const rows = (await db.query(`select distinct status from public.deliveries where tracking_number like 'OH-%'`)).rows.map((r) => r.status);
  ok(`status 実値は '配車済'/'仕分済' 系（実値: ${rows.join(',')}）`, rows.includes('仕分済') && !rows.includes('配車済み'));
  const view = (await db.query(
    `select pg_get_viewdef('public.office_home_summary'::regclass, true) as def`
  )).rows[0].def;
  ok("ビュー定義が '配車済み'(誤字) を参照していない", !view.includes('配車済み'));
  ok("ビュー定義が '仕分済' を参照している", view.includes('仕分済'));
}

// ── 別営業所(A01)は集計に混ざらない（office分離） ──
await db.query(
  `insert into public.deliveries (tracking_number, delivery_date, office_code, status, imported_at)
   values ('OH-A01', $1, 'A01', '未配車', now())`, [D]);
c = await card();
ok('IT01の受信は10のまま（A01は混ざらない）', Number(c.received) === 10);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
