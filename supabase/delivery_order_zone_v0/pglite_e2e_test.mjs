// pglite E2E: エリアマスタ取込 → 共通ID付与(zone_no保存) → 配達順(zone_no順)。
// 実行: node supabase/delivery_order_zone_v0/pglite_e2e_test.mjs
import { PGlite } from '../../node_modules/@electric-sql/pglite/dist/index.js';
import { readFileSync } from 'node:fs';

const db = new PGlite();
let pass = 0, fail = 0;
const ok = (n, c) => (c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.error(`  ✗ ${n}`)));
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const DATE = '2026-06-17';

// --- Supabase互換の最小スタブ（RLSはsuperuserで非強制。関数定義のためだけに用意）---
await db.exec(`
  create schema if not exists auth;
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(nullif(current_setting('request.jwt.claims', true),'')::jsonb->>'sub','')::uuid $$;
  create role authenticated;
  create or replace function public.my_role() returns text language sql stable as $$ select 'hq'::text $$;

  -- 荷物（zone_no は付与SQLが後で追加）
  create table public.deliveries (
    tracking_number text primary key,
    address text, common_id text, office_code text, driver_id text,
    delivery_date date, time_window text, status text not null default '未配車',
    basket_code text, delivery_order integer
  );
  -- 営業所（採番が参照する列つき）
  create table public.offices (
    office_code text primary key,
    basket_order text default 'ドライバー順',
    basket_cart_limit int default 50,
    basket_code_format text default 'アルファベット',
    basket_code_prefix text,
    basket_code_digits int
  );
  insert into public.offices(office_code) values ('A01');

  -- 採番§0の前提（helper＋作業表）
  create or replace function public.time_window_rank(tw text) returns integer language sql immutable as $$
    select case when tw is null or btrim(tw)='' then 9999
      when tw ~ '^\\s*\\d{1,2}:' then (substring(tw from '^\\s*(\\d{1,2}):'))::int*100
      when tw like '%午前%' then 800 when tw like '%午後%' then 1300 when tw like '%夜間%' then 1800 else 9999 end $$;
  create or replace function public.to_basket_alpha(n integer) returns text language plpgsql immutable as $$
    declare s text:=''; x integer:=n; begin if x is null or x<1 then return null; end if;
    while x>0 loop x:=x-1; s:=chr(65+(x%26))||s; x:=x/26; end loop; return s; end $$;
  create or replace function public.basket_symbol(n integer, fmt text, prefix text, digits integer) returns text language sql immutable as $$
    select case when fmt='数字' then coalesce(prefix,'')||case when coalesce(digits,0)>0 then lpad(n::text,digits,'0') else n::text end
      else coalesce(prefix,'')||public.to_basket_alpha(n) end $$;
  create table public.renumber_plan (
    run_date date not null, tracking_number text not null, office_code text, driver_id text,
    driver_kind text, common_id text, delivery_order integer, basket_index integer, office_seq integer, basket_code text,
    primary key (run_date, tracking_number)
  );
`);

// normalize_v0（normalize_addr・unregistered_addresses・postal_master）
await db.exec(read('../address_match_v0/normalize_v0.sql'));

// --- モジュールA：エリアマスタ取込 ---
await db.exec(read('../area_master_v0/area_master_schema_v0.sql'));
// ★箱柳町（その他）＝括弧付き town で「（…）除去して前方一致」を検証。depot/area/src_town_key も保持。
await db.query(`insert into public.area_master_staging(prefecture,municipality,town,chome,zone_no,common_id,is_valid,priority,postal_code,depot,area,src_town_key) values
  ('愛知県','岡崎市','箱柳町（その他）','', '1.0','OKZ_C_01_06','有効','3','444-0000','愛知県1','U-OKZ-01','愛知県|岡崎市|箱柳町（その他）'),
  ('愛知県','岡崎市','箱柳町（その他）','', '9',  'WRONG_ID',   '有効','7','','愛知県1','U-OKZ-01',''),
  ('愛知県','岡崎市','高隆寺町','','2', 'OKZ_C_01_06','有効','7','','愛知県1','U-OKZ-01',''),
  ('愛知県','岡崎市','小美町','', '3',  'OKZ_C_01_06','有効','7','','愛知県1','U-OKZ-01',''),
  ('愛知県','豊田市','西町','',   '1',  'TYT_C_25_36','有効','7','','愛知県1','U-TYT-01',''),
  ('愛知県','岡崎市','無効町','', '5',  'OKZ_C_01_06','無効','7','','愛知県1','U-OKZ-01',''),
  ('愛知県','岡崎市','欠番町','', 'x',  'OKZ_C_01_06','有効','7','','愛知県1','U-OKZ-01','')`);
await db.exec(read('../area_master_v0/area_master_load_v0.sql'));

console.log('\n[A エリアマスタ取込]');
const amRows = (await db.query(`select count(*)::int n from public.area_master`)).rows[0].n;
ok('有効・共通ID有りのみ取込（5件：無効町除外）', amRows === 5);
const hako = (await db.query(`select town, common_id, zone_no, postal_code, depot, area, source_town_key from public.area_master where town like '箱柳町%'`)).rows[0];
ok('★優先度小(3)が勝ち：箱柳町（その他）→OKZ_C_01_06', hako.common_id === 'OKZ_C_01_06');
ok("zone_no '1.0'→1（整数化）", hako.zone_no === 1);
ok("郵便番号は数字のみ保持（444-0000→4440000）", hako.postal_code === '4440000');
ok('拠点(depot)・エリア(area)・元TownKey を保持', hako.depot === '愛知県1' && hako.area === 'U-OKZ-01' && hako.source_town_key === '愛知県|岡崎市|箱柳町（その他）');
const zmiss = (await db.query(`select count(*)::int n from public.area_master where zone_no is null`)).rows[0].n;
ok('zone_no非数値は NULL（欠番町=1件）', zmiss === 1);
const cols = (await db.query(`select column_name from information_schema.columns where table_schema='public' and table_name='area_master'`)).rows.map(r=>r.column_name);
ok('廃止列なし（親バッグ/バッグ番号/ユニット番号 が無い）', !cols.some(c=>/bag|unit|バッグ|ユニット/i.test(c)));

// --- モジュールB：共通ID付与（zone_no保存・保留）---
await db.query(`insert into public.deliveries(tracking_number,address,office_code,status,delivery_date) values
  ('D1','愛知県岡崎市箱柳町12-3','A01','未配車','${DATE}'),
  ('D2','愛知県岡崎市高隆寺町5','A01','未配車','${DATE}'),
  ('D3','愛知県岡崎市小美町7','A01','未配車','${DATE}'),
  ('D4','愛知県豊田市西町9','A01','未配車','${DATE}'),
  ('D5','愛知県知多市未登録町1','A01','未配車','${DATE}')`);
await db.exec(read('../common_id_assign_v0/common_id_assign_v0.sql'));

console.log('\n[B 共通ID付与＋zone_no保存]');
const d = Object.fromEntries((await db.query(`select tracking_number,common_id,zone_no,status from public.deliveries order by tracking_number`)).rows.map(r=>[r.tracking_number,r]));
ok('★D1「箱柳町12-3」→ 箱柳町（その他）に（括弧除去で）前方一致→OKZ_C_01_06/zone1', d.D1.common_id==='OKZ_C_01_06' && d.D1.zone_no===1);
ok('D2 高隆寺町→OKZ_C_01_06 / zone2', d.D2.common_id==='OKZ_C_01_06' && d.D2.zone_no===2);
ok('D3 小美町→OKZ_C_01_06 / zone3', d.D3.common_id==='OKZ_C_01_06' && d.D3.zone_no===3);
ok('D4 西町→TYT_C_25_36 / zone1', d.D4.common_id==='TYT_C_25_36' && d.D4.zone_no===1);
ok('★D5 未登録→保留（common_id/zone_no 無し）', d.D5.common_id===null && d.D5.zone_no===null && d.D5.status==='保留');
const unitAbsent = (await db.query(`select not exists(select 1 from information_schema.columns where table_schema='public' and table_name='deliveries' and column_name='unit_no') b`)).rows[0].b;
ok('unit_no 列を作らない（ユニット廃止）', unitAbsent === true);
const held = (await db.query(`select count(*)::int n from public.unregistered_addresses`)).rows[0].n;
ok('未突合を未登録住所に記録（D5=1件）', held === 1);

// --- モジュールC：配達順（zone_no順）---
await db.query(`update public.deliveries set status='配車済', driver_id='DRV1' where tracking_number in ('D1','D2','D3','D4')`);
await db.exec(read('./delivery_order_zone_sort_v0.sql'));
await db.query(`select public.renumber_build($1::date)`, [DATE]);

console.log('\n[C 配達順＝zone_no順]');
const plan = Object.fromEntries((await db.query(`select tracking_number,delivery_order from public.renumber_plan where run_date=$1`,[DATE]).then(r=>r)).rows.map(r=>[r.tracking_number,r.delivery_order]));
ok('D1(z1)=配達順1', plan.D1===1);
ok('D2(z2)=配達順2', plan.D2===2);
ok('D3(z3)=配達順3', plan.D3===3);
ok('D4(別common_id)=配達順4', plan.D4===4);
// 住所順なら 小美(D3)が先頭になるはず → zone_noが優先されている証拠
ok('★zone_noが住所より優先（住所順ならD3が先頭だが D3=3）', plan.D3===3 && plan.D1===1);

// 冪等
await db.query(`select public.renumber_build($1::date)`, [DATE]);
const cnt = (await db.query(`select count(*)::int n from public.renumber_plan where run_date=$1`,[DATE])).rows[0].n;
ok('冪等：再実行でplan件数安定(4)', cnt === 4);

console.log(`\ndelivery_order_zone E2E: ${pass} passed, ${fail} failed`);
await db.close();
if (fail > 0) process.exit(1);
