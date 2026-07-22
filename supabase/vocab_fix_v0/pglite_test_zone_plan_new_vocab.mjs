// pglite E2E: zone_plan_new_vocab_v0.sql（② zone_plan に新語彙を追加）
//   固定の前提「SQLは人手でコピペ実行。渡す前に pglite で E2E 検証する」に基づく事前検証。
//
//   検証:
//     A. 合格条件（指示書②）: deliveries.common_id（非NULL）が全て zone_plan に存在する
//     B. 決定化: 1 common_id = 1行・zone_no は min（範囲の先頭＝From）
//     C. 非破壊: 旧語彙行が一切変わらない（adjacent_zones が NULL で潰れない）
//     D. 冪等: 再実行しても件数も内容も変わらない
//     E. 安全ガード: depot が非一意になったら raise exception で止まる
//     F. 除外: is_valid=false / common_id is null は登録しない
// 実行: node supabase/vocab_fix_v0/pglite_test_zone_plan_new_vocab.mjs
import { PGlite } from '../../node_modules/@electric-sql/pglite/dist/index.js';
import { readFileSync } from 'node:fs';

const SQL = readFileSync(new URL('./zone_plan_new_vocab_v0.sql', import.meta.url), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c) => (c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.error(`  ✗ ${n}`)));

const db = new PGlite();

// ---- スキーマ（本基盤と同じ型・列名） --------------------------------
//   zone_plan: dbschema_v0 の3列 + master_zoneplan_v0(depot_code/version/is_valid)
//              + dispatch_v0(split_threshold not null default 170)
await db.exec(`
  create table public.zone_plan (
    common_id       text primary key,
    zone_no         text,
    adjacent_zones  text,
    depot_code      text,
    version         integer not null default 1,
    is_valid        boolean not null default true,
    split_threshold integer not null default 170
  );
  create table public.area_master (
    town_key text primary key, prefecture text, municipality text, town text, chome text,
    zone_no integer, common_id text, area text, depot text, source_town_key text,
    postal_code text, is_valid boolean not null default true, priority integer
  );
  create table public.deliveries (
    tracking_number text primary key, delivery_date date, common_id text
  );
`);

// ---- 旧 zone_plan（愛知ダミー・隣接は旧語彙）------------------------
//   うち OKZ_W_13_18 は新語彙にも存在する（＝実測 overlap=1 の再現）
await db.exec(`
  insert into public.zone_plan (common_id, zone_no, adjacent_zones, depot_code) values
    ('OKZ_C_01_08','1','TYT_C_25_36,OKZ_S_14_24','D01'),
    ('TYT_C_25_36','2','OKZ_C_01_08','D01'),
    ('OKZ_W_13_18','3','OKZ_C_01_08','D01');
`);

// ---- area_master（新語彙）-------------------------------------------
//   ・ABK_C_29_32 … 範囲エンコード（zone 29〜32・depot一定）→ min=29 が入るはず
//   ・KGW_01_02   … 単一ゾーン（B群の命名）→ min=2
//   ・KY3_KIT_136_145 … 範囲だがデータは 137〜139（先頭欠け）→ min=137
//   ・OKZ_W_13_18 … 旧 zone_plan にも居る（重複＝上書きされないこと）
//   ・NG_INVALID  … is_valid=false → 登録されない
//   ・common_id null … 登録されない
await db.exec(`
  insert into public.area_master (town_key, common_id, zone_no, depot, is_valid) values
    ('t01','ABK_C_29_32', 29, '千葉県2', true),
    ('t02','ABK_C_29_32', 30, '千葉県2', true),
    ('t03','ABK_C_29_32', 32, '千葉県2', true),
    ('t04','KGW_01_02',    2, '香川県',  true),
    ('t05','KY3_KIT_136_145', 139, '京都府3', true),
    ('t06','KY3_KIT_136_145', 137, '京都府3', true),
    ('t07','OKZ_W_13_18',  13, '愛知県1', true),
    ('t08','NG_INVALID',   99, '無効県',  false),
    ('t09', null,          50, 'ぬる県',  true);
`);

// ---- deliveries: 旧語彙2行（旧 zone_plan で解決）＋ 新語彙2行 --------
await db.exec(`
  insert into public.deliveries (tracking_number, delivery_date, common_id) values
    ('DSP-1','2026-06-17','OKZ_C_01_08'),
    ('DSP-2','2026-06-17','TYT_C_25_36'),
    ('R-1','2026-07-04','ABK_C_29_32'),
    ('R-2','2026-07-10','KY3_KIT_136_145'),
    ('R-3','2026-07-10', null);
`);

const before = await db.query(`select common_id, zone_no, adjacent_zones, depot_code
                               from public.zone_plan order by common_id`);

// ---- 実行 -------------------------------------------------------------
console.log('A/B/C/F. 初回実行');
await db.exec(SQL);

const zp = async (id) => (await db.query(
  `select * from public.zone_plan where common_id = $1`, [id])).rows[0];

// A. 合格条件
{
  const r = (await db.query(`
    select count(*)::int as n from public.deliveries d
    where d.common_id is not null
      and not exists (select 1 from public.zone_plan zp where zp.common_id = d.common_id)`)).rows[0];
  ok('A. 合格条件: deliveries.common_id が全て zone_plan に存在（unresolved=0）', r.n === 0);
}

// B. 決定化（min＝範囲の先頭）
{
  const a = await zp('ABK_C_29_32');
  ok('B. 範囲エンコード ABK_C_29_32 → zone_no=29（min＝From）', a && a.zone_no === '29');
  ok('B. depot → depot_code に入る', a && a.depot_code === '千葉県2');
  ok('B. adjacent_zones は NULL（親指示書C.）', a && a.adjacent_zones === null);
  ok('B. split_threshold は既定 170', a && a.split_threshold === 170);
  ok('B. version=1 / is_valid=true', a && a.version === 1 && a.is_valid === true);

  const k = await zp('KGW_01_02');
  ok('B. 単一ゾーン KGW_01_02 → zone_no=2', k && k.zone_no === '2');

  const y = await zp('KY3_KIT_136_145');
  ok('B. 先頭欠け KY3_KIT_136_145 → zone_no=137（実在する最小・名前の136ではない）',
     y && y.zone_no === '137');

  const dup = (await db.query(
    `select count(*)::int as n from (
       select common_id from public.zone_plan group by common_id having count(*) > 1) t`)).rows[0];
  ok('B. 1 common_id = 1行（重複なし）', dup.n === 0);
}

// C. 非破壊（旧行が変わらない）
{
  const o = await zp('OKZ_W_13_18');
  ok('C. 新旧に共通する OKZ_W_13_18 の adjacent_zones が NULL で潰れていない',
     o && o.adjacent_zones === 'OKZ_C_01_08');
  ok('C. 同 zone_no も旧値のまま（3 / 新語彙の13で上書きされない）', o && o.zone_no === '3');

  const after = await db.query(`select common_id, zone_no, adjacent_zones, depot_code
                                from public.zone_plan
                                where common_id in ('OKZ_C_01_08','TYT_C_25_36','OKZ_W_13_18')
                                order by common_id`);
  ok('C. 旧語彙3行が一切変わらない（追加のみ）',
     JSON.stringify(after.rows) === JSON.stringify(before.rows));
}

// F. 除外
{
  ok('F. is_valid=false は登録されない', (await zp('NG_INVALID')) === undefined);
  const nullRow = (await db.query(
    `select count(*)::int as n from public.zone_plan where common_id is null`)).rows[0];
  ok('F. common_id is null は登録されない', nullRow.n === 0);
}

// 件数
{
  const c = (await db.query(`select count(*)::int as n from public.zone_plan`)).rows[0];
  // 旧3 + 新(ABK, KGW, KY3, OKZ_W) 4 − 重複1(OKZ_W) = 6
  ok('件数: 旧3 + 新4 − 重複1 = 6', c.n === 6);
}

// ---- D. 冪等 ---------------------------------------------------------
console.log('D. 冪等（再実行）');
{
  const snap1 = await db.query(`select * from public.zone_plan order by common_id`);
  await db.exec(SQL);
  const snap2 = await db.query(`select * from public.zone_plan order by common_id`);
  ok('D. 再実行しても内容が完全に一致（エラーも出ない）',
     JSON.stringify(snap1.rows) === JSON.stringify(snap2.rows));
}

// ---- E. 安全ガード ---------------------------------------------------
console.log('E. 安全ガード（depot が非一意になったら止まる）');
{
  await db.exec(`insert into public.area_master (town_key, common_id, zone_no, depot, is_valid)
                 values ('t99','ABK_C_29_32', 31, '千葉県9', true);`);  // depot をばらつかせる
  let raised = null;
  try { await db.exec(SQL); } catch (e) { raised = e.message; }
  ok('E. depot 非一意で raise exception により中断する', raised !== null);
  ok('E. エラーメッセージが原因と次の手を示している',
     raised !== null && /畳めていません/.test(raised) && /seq 10/.test(raised));

  // ガードが insert より前に効く＝壊れたデータが入らないこと
  const bad = (await db.query(
    `select count(*)::int as n from public.zone_plan where depot_code = '千葉県9'`)).rows[0];
  ok('E. 中断時に不正な行が入っていない（ガードは insert より前）', bad.n === 0);

  await db.exec(`delete from public.area_master where town_key = 't99';`);
}

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
await db.close();
process.exit(fail ? 1 : 0);
