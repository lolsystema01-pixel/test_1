// pglite E2E: purge_old_vocab_deliveries_v0.sql（③ 旧語彙 deliveries の削除）
//   固定の前提「SQLは人手でコピペ実行。渡す前に pglite で E2E 検証する」に基づく事前検証。
//
//   検証:
//     A. 前提の実証: 指示書どおり delivery_index を消さずに deliveries を消すと FK違反で落ちる
//        （＝「delivery_index は on delete cascade で自動削除」という指示書の記述が誤りであることの証明）
//     B. 合格条件: old_vocab_only = 0 / deliveries_unresolved = 0
//     C. 非破壊: 実データ（07-04/07-10）を巻き込まない
//     D. 孤児なし: delivery_index / delivery_status_log に孤児が残らない
//     E. cascade: unregistered_addresses は自動削除される
//     F. 冪等: 再実行しても件数が変わらない
//     G. 安全ガード: 指定日の外に旧語彙が居たら raise exception で止まる
// 実行: node supabase/vocab_fix_v0/pglite_test_purge.mjs
import { PGlite } from '../../node_modules/@electric-sql/pglite/dist/index.js';
import { readFileSync } from 'node:fs';

const SQL = readFileSync(new URL('./purge_old_vocab_deliveries_v0.sql', import.meta.url), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c) => (c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.error(`  ✗ ${n}`)));
const one = async (db, q) => (await db.query(q)).rows[0];

// 本基盤と同じ FK 定義（cascade の有無が肝）
const SCHEMA = `
  create table public.area_master (
    town_key text primary key, common_id text, zone_no integer, depot text,
    is_valid boolean not null default true
  );
  create table public.zone_plan (common_id text primary key, zone_no text);
  create table public.deliveries (
    tracking_number text primary key, delivery_date date, common_id text
  );
  create table public.delivery_index (
    tracking_number text primary key
      references public.deliveries(tracking_number),          -- ★cascade 無し（dbschema_v0:102 と同じ）
    driver_id text, delivery_order integer, basket_code text, common_id text
  );
  create table public.delivery_status_log (
    id bigint generated always as identity primary key,
    tracking_number text not null references public.deliveries(tracking_number),  -- cascade 無し
    to_status text not null
  );
  create table public.unregistered_addresses (
    tracking_number text primary key
      references public.deliveries(tracking_number) on delete cascade,            -- cascade あり
    address text
  );
`;

const SEED = `
  insert into public.area_master (town_key, common_id, zone_no, depot, is_valid) values
    ('t1','ABK_C_29_32', 29, '千葉県2', true);
  insert into public.zone_plan (common_id, zone_no) values
    ('OKZ_C_01_08','1'),      -- 旧 zone_plan（②で残した旧語彙行）
    ('ABK_C_29_32','29');     -- ②で入った新語彙
  insert into public.deliveries (tracking_number, delivery_date, common_id) values
    -- 旧DSPダミー 06-17（旧語彙・zone_plan には居る）＝800行側
    ('DSP-1','2026-06-17','OKZ_C_01_08'),
    ('DSP-2','2026-06-17','OKZ_C_01_08'),
    -- 旧DSPダミー 06-16（C0001 孤児・どこにも居ない）＝4行側
    ('DLV-A1','2026-06-16','C0001'),
    ('DLV-B2','2026-06-16','C0002'),
    -- 実データ（新語彙・残るべき）
    ('R-1','2026-07-04','ABK_C_29_32'),
    ('R-2','2026-07-10','ABK_C_29_32'),
    ('R-3','2026-07-10', null);
  insert into public.delivery_index (tracking_number, driver_id) values
    ('DSP-1','DRV001'), ('DSP-2','DRV001'), ('R-1','DRV002');   -- 実機800件に相当
  insert into public.delivery_status_log (tracking_number, to_status) values
    ('DSP-1','配車済'), ('DLV-A1','配車済'), ('R-1','配車済');
  insert into public.unregistered_addresses (tracking_number, address) values
    ('DSP-2','愛知県岡崎市どこか'), ('R-2','千葉県我孫子市どこか');
`;

const fresh = async () => { const d = new PGlite(); await d.exec(SCHEMA); await d.exec(SEED); return d; };

// ---- A. 指示書どおり（delivery_index を消さない）と落ちることの実証 ----
console.log('A. 指示書の記述（delivery_index は cascade で自動削除）が誤りであることの実証');
{
  const db = await fresh();
  let raised = null;
  try {
    // 指示書のとおり: delivery_status_log → deliveries のみ
    await db.exec(`
      delete from public.delivery_status_log l where exists (
        select 1 from public.deliveries d where d.tracking_number = l.tracking_number
          and d.delivery_date in (date '2026-06-16', date '2026-06-17'));
      delete from public.deliveries d
      where d.delivery_date in (date '2026-06-16', date '2026-06-17')
        and d.common_id is not null
        and not exists (select 1 from public.area_master am
                         where am.common_id = d.common_id and am.is_valid);
    `);
  } catch (e) { raised = e.message; }
  ok('A. delivery_index を消さずに deliveries を消すと FK違反で落ちる', raised !== null);
  ok('A. エラーが delivery_index の FK であることを示す',
     raised !== null && /delivery_index/.test(raised));
  await db.close();
}

// ---- B〜F. 本ファイルで実行 -------------------------------------------
console.log('B/C/D/E. 本ファイル（delivery_index を明示削除）で実行');
const db = await fresh();
await db.exec(SQL);

{
  const r = await one(db, `
    select
      (select count(*)::int from public.deliveries d
        where d.common_id is not null
          and not exists (select 1 from public.area_master am
                           where am.common_id = d.common_id and am.is_valid)) as old_vocab_only,
      (select count(*)::int from public.deliveries d
        where d.common_id is not null
          and not exists (select 1 from public.zone_plan zp
                           where zp.common_id = d.common_id))                 as unresolved,
      (select count(*)::int from public.deliveries
        where delivery_date in (date '2026-06-16', date '2026-06-17'))        as on_target,
      (select count(*)::int from public.deliveries
        where delivery_date not in (date '2026-06-16', date '2026-06-17'))    as kept,
      (select count(*)::int from public.delivery_index i
        where not exists (select 1 from public.deliveries d
                           where d.tracking_number = i.tracking_number))      as orphan_idx,
      (select count(*)::int from public.delivery_status_log l
        where not exists (select 1 from public.deliveries d
                           where d.tracking_number = l.tracking_number))      as orphan_log
  `);
  ok('B. 合格条件 old_vocab_only = 0', r.old_vocab_only === 0);
  ok('B. ②の合格条件 deliveries_unresolved = 0（C0001 孤児が消えたため）', r.unresolved === 0);
  ok('B. 対象日の行が全て消えた', r.on_target === 0);
  ok('C. 実データ3行（07-04/07-10）が残っている', r.kept === 3);
  ok('D. delivery_index に孤児が残らない', r.orphan_idx === 0);
  ok('D. delivery_status_log に孤児が残らない', r.orphan_log === 0);
}

{
  // C. 実データの子レコードが巻き込まれていない
  const r = await one(db, `
    select (select count(*)::int from public.delivery_index where tracking_number = 'R-1')      as idx_r1,
           (select count(*)::int from public.delivery_status_log where tracking_number = 'R-1') as log_r1,
           (select count(*)::int from public.unregistered_addresses where tracking_number='R-2') as unreg_r2`);
  ok('C. 実データの delivery_index / status_log / unregistered が残る',
     r.idx_r1 === 1 && r.log_r1 === 1 && r.unreg_r2 === 1);
}

{
  // E. cascade の実証
  const r = await one(db,
    `select count(*)::int as n from public.unregistered_addresses where tracking_number = 'DSP-2'`);
  ok('E. unregistered_addresses は on delete cascade で自動削除された', r.n === 0);
}

// ---- F. 冪等 ----------------------------------------------------------
console.log('F. 冪等（再実行）');
{
  const snap1 = await db.query(`select * from public.deliveries order by tracking_number`);
  await db.exec(SQL);
  const snap2 = await db.query(`select * from public.deliveries order by tracking_number`);
  ok('F. 再実行しても内容が一致（エラーも出ない）',
     JSON.stringify(snap1.rows) === JSON.stringify(snap2.rows));
}
await db.close();

// ---- G. 安全ガード ----------------------------------------------------
console.log('G. 安全ガード（指定日の外に旧語彙が居たら止まる）');
{
  const g = await fresh();
  await g.exec(`insert into public.deliveries (tracking_number, delivery_date, common_id)
                values ('OUT-1','2026-07-04','OLD_VOCAB_X');`);  // 指定日の外の旧語彙
  let raised = null;
  try { await g.exec(SQL); } catch (e) { raised = e.message; }
  ok('G. 指定日の外に旧語彙 → raise exception で中断', raised !== null);
  ok('G. エラーが件数と次の手を示す',
     raised !== null && /1 件/.test(raised) && /diagnose_unresolved_deliveries_v0/.test(raised));
  const r = await one(g, `select count(*)::int as n from public.deliveries
                          where delivery_date in (date '2026-06-16', date '2026-06-17')`);
  ok('G. 中断時に1行も消えていない（ガードは delete より前）', r.n === 4);
  await g.close();
}

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
