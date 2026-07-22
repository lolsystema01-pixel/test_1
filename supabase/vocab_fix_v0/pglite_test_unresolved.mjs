// pglite: diagnose_unresolved_deliveries_v0.sql（②実行後の unresolved 4行の診断）の検証
//   固定の前提「SQLは人手でコピペ実行。渡す前に検証する」に基づく事前検証。
// 実行: node supabase/vocab_fix_v0/pglite_test_unresolved.mjs
import { PGlite } from '../../node_modules/@electric-sql/pglite/dist/index.js';
import { readFileSync } from 'node:fs';

const SQL = readFileSync(new URL('./diagnose_unresolved_deliveries_v0.sql', import.meta.url), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c) => (c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.error(`  ✗ ${n}`)));
const find = (rs, tn) => rs.rows.find(r => r.tracking_number === tn);

const db = new PGlite();

await db.exec(`
  create table public.zone_plan (
    common_id text primary key, zone_no text, adjacent_zones text, depot_code text
  );
  create table public.area_master (
    town_key text primary key, common_id text, zone_no integer, depot text,
    is_valid boolean not null default true
  );
  create table public.address_master (
    town_key text primary key, common_id text, municipality text
  );
  create table public.deliveries (
    tracking_number text primary key, delivery_date date, common_id text
  );
`);

await db.exec(`
  insert into public.zone_plan (common_id, zone_no) values
    ('OKZ_C_01_08','1'),          -- 旧語彙（zone_plan に残っている）
    ('ABK_C_29_32','29');         -- ②で入った新語彙
  insert into public.area_master (town_key, common_id, zone_no, depot, is_valid) values
    ('t1','ABK_C_29_32', 29, '千葉県2', true);
  insert into public.address_master (town_key, common_id, municipality) values
    ('a1','OKZ_C_01_08','岡崎市');
  insert into public.deliveries (tracking_number, delivery_date, common_id) values
    -- (1) 旧語彙だが zone_plan に居る → 診断対象に入らない（=800行側）
    ('OLD-1','2026-06-17','OKZ_C_01_08'),
    -- (2) どこにも居ない・日付は06-16 → ③で消える（=4行側の想定）
    ('GHOST-1','2026-06-16','C0001'),
    ('GHOST-2','2026-06-16','C0002'),
    -- (3) どこにも居ない・日付が対象外 → ③後も残る
    ('LIVE-1','2026-07-04','ZZZ_9'),
    -- (4) 新語彙で解決 → 診断対象に入らない
    ('NEW-1','2026-07-10','ABK_C_29_32'),
    -- (5) common_id null → 対象外
    ('NULL-1','2026-07-10', null);
`);

const rs = await db.query(SQL);
console.log(`診断対象 ${rs.rows.length}件`);

ok('解決できる行は診断対象に入らない（旧語彙でも zone_plan に居れば出ない）',
   find(rs, 'OLD-1') === undefined && find(rs, 'NEW-1') === undefined);
ok('common_id null は対象外', find(rs, 'NULL-1') === undefined);

{
  const g = find(rs, 'GHOST-1');
  ok('どこにも居ない・06-16 → ✅ ③で消えると判定',
     g && g.after_step3.startsWith('✅'));
  ok('in_zone_plan / in_area_master / in_address_master が全て false',
     g && g.in_zone_plan === false && g.in_area_master === false && g.in_address_master === false);
  ok('common_id の実値が出る（C0001 等の特定に使う）', g && g.common_id === 'C0001');
}

{
  const l = find(rs, 'LIVE-1');
  ok('日付が対象外 → ⚠ ③後も残ると判定（黙って✅にしない）',
     l && /③の対象外（日付/.test(l.after_step3));
}

// 読むだけ保証
{
  const body = SQL.replace(/--[^\n]*/g, ' ').replace(/'(?:[^']|'')*'/g, "''").toLowerCase();
  const banned = ['drop', 'delete', 'update', 'insert', 'alter', 'truncate', 'grant', 'revoke'];
  const hit = banned.filter(k => new RegExp(`\\b${k}\\b`).test(body));
  ok(`読むだけ保証: DDL/DML を含まない（検出: ${hit.join(',') || 'なし'}）`, hit.length === 0);
  await db.exec('begin; set transaction read only;');
  let roOk = true;
  try { await db.query(SQL); } catch (e) { roOk = false; console.error('   ', e.message); }
  await db.exec('rollback;');
  ok('read only トランザクションで実行できる', roOk);
}

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
await db.close();
process.exit(fail ? 1 : 0);
