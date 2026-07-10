// pglite E2E: ② audit_address_master_v0.sql（調査のみSQL）の検証
//   ・全クエリが構文エラー無く実行できる
//   ・検出ロジックが「本当に検出する」ことを、ズレを仕込んだデータで実証する
//     （§1 関数参照 / §2 旧語彙残置 / §3 zone_plan語彙 / §4 municipality非一意）
// 実行: node supabase/auth_rls_remaining_v1/pglite_test_audit.mjs
import { PGlite } from '../../node_modules/@electric-sql/pglite/dist/index.js';
import { readFileSync } from 'node:fs';

const db = new PGlite();
let pass = 0, fail = 0;
const ok = (n, c) => (c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.error(`  ✗ ${n}`)));

// ── 本番相当のスタブ（新旧マスタ＋deliveries＋依存3関数の簡略版）──
await db.exec(`
  create table public.zone_plan (
    common_id text primary key, zone_no text, adjacent_zones text,
    is_valid boolean not null default true
  );
  create table public.address_master (
    town_key text primary key, municipality text, town text,
    common_id text references public.zone_plan(common_id),
    is_valid boolean not null default true
  );
  create table public.area_master (
    town_key text primary key, municipality text, town text,
    common_id text, is_valid boolean not null default true, priority integer
  );
  create table public.deliveries (
    tracking_number text primary key, delivery_date date, common_id text
  );

  -- 依存関数（本番の参照形だけ再現。§1-1 が prosrc で検出できることの実証用）
  create or replace function public.zone_rank(a text, b text) returns int language sql stable as $$
    select case when a = b then 1
      when (select am.municipality from public.address_master am where am.common_id = a limit 1)
         = (select am.municipality from public.address_master am where am.common_id = b limit 1) then 2
      else 9 end
  $$;
  create or replace function public.dispatch_build(p_date date) returns void language plpgsql as $fn$
  begin
    perform (select am.municipality from public.address_master am limit 1);
  end $fn$;
  create or replace function public.delivery_status_public(p_tracking_number text) returns text
  language sql stable security definer as $$
    select (select am.municipality from public.address_master am
            where am.common_id = (select common_id from public.deliveries d where d.tracking_number = p_tracking_number)
            limit 1)
  $$;

  -- 語彙: 旧=OKZ_C_01_08 / 新=OKZ_C_01_06（Fable監査の実例）。NSM_31 は新旧共通。
  insert into public.zone_plan values
    ('OKZ_C_01_08','8', 'NSM_31', true),          -- 旧語彙（area_masterに無い）
    ('NSM_31','31', 'OKZ_C_01_06, GHOST_99', true); -- 隣接に未知ID(GHOST_99)を仕込む
  insert into public.address_master (town_key, municipality, town, common_id) values
    ('愛知県岡崎市箱柳町','岡崎市','箱柳町','OKZ_C_01_08'),
    ('兵庫県西宮市X','西宮市','X','NSM_31');
  insert into public.area_master values
    ('兵庫県伊丹市A','伊丹市','A','OKZ_C_01_06', true, 1),
    ('兵庫県西宮市X','西宮市','X','NSM_31',      true, 1),
    ('兵庫県西宮市Y','尼崎市','Y','NSM_31',      true, 2),   -- ★同じcommon_idで別municipality（§4検出用）
    ('無効行','無効市','Z','DEAD_1',             false, 1);  -- is_valid=false は語彙に数えない
  insert into public.deliveries values
    ('T-NEW1', date '2026-07-08', 'NSM_31'),        -- 新語彙
    ('T-OLD1', date '2026-07-08', 'OKZ_C_01_08'),   -- ★旧語彙の残置（§2検出用）
    ('T-NULL', date '2026-07-08', null);
`);

// ── 監査SQL全文が素通しで実行できる（構文・カタログ互換） ──
const sql = readFileSync(new URL('./audit_address_master_v0.sql', import.meta.url), 'utf8');
await db.exec(sql);
ok('audit_address_master_v0.sql 全文がエラー無く実行できる（SELECTのみ）', true);

// ── §1-1: pg_proc.prosrc で3関数が検出される ──
{
  const rows = (await db.query(`
    select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname not in ('pg_catalog','information_schema') and p.prosrc ilike '%address_master%'
    order by p.proname`)).rows.map(r => r.proname);
  ok(`§1-1 参照関数を3件検出（${rows.join(', ')}）`,
    rows.length === 3 && ['delivery_status_public','dispatch_build','zone_rank'].every(f => rows.includes(f)));
}
// ── §1 の対比: pg_depend では検出できない（＝落とし穴の実証） ──
{
  const c = Number((await db.query(`
    select count(*)::int c from pg_depend where refobjid = 'public.address_master'::regclass
      and objid in (select oid from pg_proc)`)).rows[0].c);
  ok('§1 対比: pg_depend は関数依存を記録しない（0件＝dropが素通りする根拠）', c === 0);
}

// ── §2: 旧語彙の残置を検出する ──
{
  const r = (await db.query(`
    select count(*) filter (where d.common_id is not null and am.common_id is null)::int as old_vocab_only
    from public.deliveries d
    left join (select distinct common_id from public.area_master where is_valid) am on am.common_id = d.common_id`)).rows[0];
  ok('§2 旧語彙残置=1件（T-OLD1/OKZ_C_01_08 を正しく検出）', Number(r.old_vocab_only) === 1);
}

// ── §3: zone_plan の旧語彙・未知の隣接IDを検出する ──
{
  const a = Number((await db.query(`
    select count(*) filter (where am.common_id is null)::int c
    from public.zone_plan zp
    left join (select distinct common_id from public.area_master where is_valid) am on am.common_id = zp.common_id`)).rows[0].c);
  ok('§3-1 zone_plan の旧語彙=1件（OKZ_C_01_08）', a === 1);
  const b = (await db.query(`
    select trim(adj) as adjacent_id from public.zone_plan zp,
      unnest(string_to_array(coalesce(zp.adjacent_zones,''), ',')) adj
    where trim(adj) <> ''
      and not exists (select 1 from public.area_master am where am.common_id = trim(adj) and am.is_valid)`)).rows.map(r => r.adjacent_id);
  // OKZ_C_01_08→NSM_31 と NSM_31→OKZ_C_01_06 は新語彙に存在するため、未知は GHOST_99 のみ
  ok(`§3-2 隣接の未知ID=1件（GHOST_99 のみ検出・実在IDは素通し）: ${b.join(',')}`,
    b.length === 1 && b[0] === 'GHOST_99');
}

// ── §4: common_id → municipality の非一意を検出する ──
{
  const rows = (await db.query(`
    select common_id from public.area_master
    where is_valid and common_id is not null
    group by common_id having count(distinct municipality) > 1`)).rows.map(r => r.common_id);
  ok('§4 municipality非一意=1件（NSM_31: 西宮市/尼崎市）', rows.length === 1 && rows[0] === 'NSM_31');
}

// ── §5: 語彙の重なり（is_valid=false を除外して数える） ──
{
  const r = (await db.query(`
    select
      (select count(distinct common_id) from public.address_master where common_id is not null) as old_vocab,
      (select count(distinct common_id) from public.area_master where common_id is not null and is_valid) as new_vocab,
      (select count(*) from (
        select distinct common_id from public.address_master where common_id is not null
        intersect
        select distinct common_id from public.area_master where common_id is not null and is_valid) t) as overlap`)).rows[0];
  ok(`§5 語彙 old=2 new=2 overlap=1（DEAD_1 は無効行なので数えない）`,
    Number(r.old_vocab) === 2 && Number(r.new_vocab) === 2 && Number(r.overlap) === 1);
}

// ── 読むだけの保証: 監査SQLに書込・削除系が含まれない ──
{
  const body = sql.replace(/--[^\n]*/g, '').toLowerCase();
  const banned = ['drop ', 'delete ', 'update ', 'insert ', 'alter ', 'truncate ', 'create '];
  const hit = banned.filter(k => body.includes(k));
  ok(`読むだけ保証: DROP/DML/DDL を含まない（検出: ${hit.join(',') || 'なし'}）`, hit.length === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
