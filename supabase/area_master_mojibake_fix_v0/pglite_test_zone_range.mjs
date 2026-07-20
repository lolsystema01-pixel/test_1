// pglite: diagnose_zone_range_v0.sql（②前提c の From 不一致13件の診断）の検証
//   目的: 渡す前の検証（固定の前提「SQLは人手でコピペ実行。渡す前に検証する」）。
//   検証: 3つの診断パターンを仕込み、それぞれ正しく分類されること／
//         一致している共通ID（＝1559件側）を誤って拾わないこと。
// 実行: node supabase/area_master_mojibake_fix_v0/pglite_test_zone_range.mjs
import { PGlite } from '../../node_modules/@electric-sql/pglite/dist/index.js';
import { readFileSync } from 'node:fs';

const SQL = readFileSync(new URL('./diagnose_zone_range_v0.sql', import.meta.url), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c) => (c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.error(`  ✗ ${n}`)));
const find = (rs, id) => rs.rows.find(r => r.common_id === id);

const db = new PGlite();

await db.exec(`
  create table public.area_master (
    town_key text primary key, prefecture text, municipality text, town text, chome text,
    zone_no integer, common_id text, area text, depot text, source_town_key text,
    postal_code text, is_valid boolean not null default true, priority integer
  );
`);

await db.exec(`
  insert into public.area_master (town_key, common_id, zone_no, depot, is_valid) values
  -- (1) 正常＝名前どおり（min_valid=29=name_from）→ 診断対象に入らないこと
    ('t01','ABK_C_29_32', 29, '千葉県2', true),
    ('t02','ABK_C_29_32', 30, '千葉県2', true),
    ('t03','ABK_C_29_32', 32, '千葉県2', true),

  -- (2) 仮説どおり＝先頭ゾーン(1)の町が無効なので min_valid=2 だが min_all=1=name_from
    ('t11','AGE_C_01_05', 1, '埼玉県7', false),
    ('t12','AGE_C_01_05', 2, '埼玉県7', true),
    ('t13','AGE_C_01_05', 5, '埼玉県7', true),

  -- (3) 名前の範囲 > 実データ＝無効を含めても先頭ゾーン(87)が存在しない
    ('t21','AIZ_C_87_90', 88, '福島県', true),
    ('t22','AIZ_C_87_90', 90, '福島県', true),

  -- (4) 想定外＝min_all(20) < name_from(24)
    ('t31','AIZ_C_24_26', 20, '徳島県', true),
    ('t32','AIZ_C_24_26', 26, '徳島県', true),

  -- (5) 無効行なしなのに min_valid がズレる（無効0件・先頭欠落なし判定の分岐）
    ('t41','XXX_C_10_12', 11, '大阪府1', true),
    ('t42','XXX_C_10_12', 12, '大阪府1', true);
`);

const rs = await db.query(SQL);
console.log(`診断対象 ${rs.rows.length}件`);

ok('(1) 名前どおりの共通IDは診断対象に入らない（1559件側を誤って拾わない）',
   find(rs, 'ABK_C_29_32') === undefined);

{
  const r = find(rs, 'AGE_C_01_05');
  ok('(2) 先頭ゾーンが無効 → ✅ 仮説どおりと分類',
     r && r.diagnosis.startsWith('✅') && /先頭ゾーンの町が無効/.test(r.diagnosis));
  ok('(2) min_valid=2 / min_all=1 / name_from=1 が出る',
     r && Number(r.min_valid) === 2 && Number(r.min_all) === 1 && Number(r.name_from) === 1);
  ok('(2) invalid_rows=1 が出る', r && Number(r.invalid_rows) === 1);
}

{
  const r = find(rs, 'AIZ_C_87_90');
  ok('(3) 無効を含めても先頭ゾーン欠落 → ⚠ 名前の範囲>実データ と分類',
     r && /名前の範囲 > 実データ/.test(r.diagnosis));
}

{
  const r = find(rs, 'AIZ_C_24_26');
  ok('(4) min_all < name_from → ⚠ 想定外 と分類',
     r && /想定外/.test(r.diagnosis));
}

{
  const r = find(rs, 'XXX_C_10_12');
  ok('(5) 無効行ゼロで先頭欠落 → ⚠ に分類（黙って✅にしない）',
     r && r.diagnosis.startsWith('⚠'));
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
