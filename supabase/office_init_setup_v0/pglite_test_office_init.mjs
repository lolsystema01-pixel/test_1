// pglite E2E: office_init_setup_v0.sql（初期設定 §12.14 の器＋保存口）
//   固定の前提「SQLは人手でコピペ実行。渡す前に pglite で E2E 検証する」に基づく事前検証。
//
//   検証:
//     A. 列追加（nullable・default なし・comment）
//     B. NULL=未完 の判定（初回ゲートの根拠）
//     C. 権限: hq=常時可 / area=自営業所かつ初回のみ可 / area=他営業所は不可 /
//              area=2回目（既に完了）は不可 / driver等=不可
//     D. 入力検証: URL必須（NULL・空文字を弾く）／機種はCHECK許容値のみ
//     E. 保存後は「完了」になり、初回ゲートが出なくなる
//     F. 冪等（再実行してもエラーなし・列は重複しない）
//     G. printer_model 以外の既存設定列を壊さない
// 実行: node supabase/office_init_setup_v0/pglite_test_office_init.mjs
import { PGlite } from '../../node_modules/@electric-sql/pglite/dist/index.js';
import { readFileSync } from 'node:fs';

const SQL = readFileSync(new URL('./office_init_setup_v0.sql', import.meta.url), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c) => (c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.error(`  ✗ ${n}`)));
const one = async (db, q, p = []) => (await db.query(q, p)).rows[0];

const db = new PGlite();
await db.exec(`create role authenticated;`);

// offices（admin_settings 適用後の想定）＋ my_role()/my_office() のスタブ
await db.exec(`
  create table public.offices (
    office_code text primary key, depot_code text, office_name text,
    dispatch_priority text not null default '処理能力優先',
    basket_order text not null default 'ドライバー順',
    basket_cart_limit integer, autosave_threshold integer not null default 50,
    request_period_days integer,
    auto_logout_enabled boolean, auto_logout_minutes integer, printer_model text
  );
  alter table public.offices add constraint offices_printer_model_chk
    check (printer_model is null or printer_model in ('Brother TD-2350', '汎用サーマル'));
  insert into public.offices (office_code, office_name, basket_cart_limit, printer_model) values
    ('IT01','伊丹営業所', 50, null),
    ('A01','愛知県1営業所', 10, 'Brother TD-2350'),
    ('C01','愛知県2営業所', 10, null);

  -- 呼び出し元ロール/営業所のスタブ（rls_v0 の my_role()/my_office() 相当）
  create table public._who (role text, office text);
  insert into public._who values (null, null);
  create function public.my_role()   returns text language sql stable as $$ select role   from public._who limit 1 $$;
  create function public.my_office() returns text language sql stable as $$ select office from public._who limit 1 $$;
`);
const as = async (role, office) =>
  db.query(`update public._who set role = $1, office = $2`, [role, office]);

await db.exec(SQL);

// ---- A. 列追加 ----
console.log('A. 列追加');
{
  const col = await one(db, `
    select data_type, is_nullable, column_default from information_schema.columns
    where table_schema='public' and table_name='offices' and column_name='gdrive_folder_url'`);
  ok('A. gdrive_folder_url が text・nullable・default なし',
     col && col.data_type === 'text' && col.is_nullable === 'YES' && col.column_default === null);
  const c = await one(db, `
    select col_description('public.offices'::regclass,
      (select ordinal_position from information_schema.columns
       where table_schema='public' and table_name='offices' and column_name='gdrive_folder_url')) as comment`);
  ok('A. comment に「NULL＝初期設定 未完」と専用フラグを作らない旨が記されている',
     c.comment && /NULL＝初期設定 未完/.test(c.comment) && /専用フラグ列は作らない/.test(c.comment));
}

// ---- B. NULL=未完 の判定 ----
console.log('B. 初回ゲートの判定');
{
  const r = await one(db, `
    select count(*) filter (where gdrive_folder_url is null)::int as 未完,
           count(*) filter (where gdrive_folder_url is not null)::int as 完了
    from public.offices`);
  ok('B. 初期状態は全営業所が「未完」（3件）', r.未完 === 3 && r.完了 === 0);
}

// ---- C. 権限 ----
console.log('C. 権限');
const save = async (office, url, model) => {
  try { await db.query(`select public.save_office_init_setup($1,$2,$3)`, [office, url, model]); return null; }
  catch (e) { return e.message; }
};
{
  await as('area', 'IT01');
  ok('C. area が他営業所を保存しようとすると拒否',
     (await save('A01', 'https://drive.google.com/drive/folders/x', 'Brother TD-2350')) !== null);
  ok('C. driver は拒否',
     (await as('driver', null), await save('IT01', 'https://drive.google.com/drive/folders/x', 'Brother TD-2350')) !== null);

  await as('area', 'IT01');
  ok('C. ★area が自営業所の初回設定を保存できる（ゲートを見る本人が保存できる）',
     (await save('IT01', 'https://drive.google.com/drive/folders/ITAMI', 'Brother TD-2350')) === null);

  const err2 = await save('IT01', 'https://drive.google.com/drive/folders/CHANGED', '汎用サーマル');
  ok('C. ★area の2回目（既に完了）は拒否＝恒久的な編集権は持たない', err2 !== null);
  ok('C. エラーが「管理者設定から hq が」と次の手順を示す', err2 !== null && /管理者設定/.test(err2));

  await as('hq', null);
  ok('C. hq は完了後でも変更できる（全営業所）',
     (await save('IT01', 'https://drive.google.com/drive/folders/BY_HQ', '汎用サーマル')) === null);
  ok('C. hq の変更が反映されている',
     (await one(db, `select gdrive_folder_url from public.offices where office_code='IT01'`))
       .gdrive_folder_url === 'https://drive.google.com/drive/folders/BY_HQ');
}

// ---- D. 入力検証 ----
console.log('D. 入力検証');
{
  await as('area', 'C01');
  ok('D. URL が NULL は拒否', (await save('C01', null, 'Brother TD-2350')) !== null);
  ok('D. URL が空文字は拒否（未完のまま残さない）', (await save('C01', '   ', 'Brother TD-2350')) !== null);
  ok('D. 機種が CHECK 許容外は拒否', (await save('C01', 'https://drive.google.com/drive/folders/y', 'Epson')) !== null);
  ok('D. 機種が NULL は拒否', (await save('C01', 'https://drive.google.com/drive/folders/y', null)) !== null);
  ok('D. 拒否された C01 は「未完」のまま',
     (await one(db, `select gdrive_folder_url from public.offices where office_code='C01'`)).gdrive_folder_url === null);
  ok('D. 正しい入力は通り、前後の空白は除去される',
     (await save('C01', '  https://drive.google.com/drive/folders/CHITA  ', '汎用サーマル')) === null
     && (await one(db, `select gdrive_folder_url from public.offices where office_code='C01'`))
          .gdrive_folder_url === 'https://drive.google.com/drive/folders/CHITA');
}

// ---- E. 保存後は完了＝ゲートが出ない ----
console.log('E. 保存後の状態');
{
  const r = await one(db, `
    select office_code, case when gdrive_folder_url is null then '未完' else '完了' end as st
    from public.offices where office_code='C01'`);
  ok('E. 保存した営業所は「完了」＝初回ゲートが出なくなる', r.st === '完了');
  const rest = await one(db, `
    select count(*)::int as n from public.offices where gdrive_folder_url is null`);
  ok('E. 未設定の A01 は「未完」のまま（他営業所に影響しない）', rest.n === 1);
}

// ---- F. 冪等 ----
console.log('F. 冪等');
{
  const before = await db.query(`select * from public.offices order by office_code`);
  let err = null;
  try { await db.exec(SQL); } catch (e) { err = e.message; }
  ok('F. 再実行してもエラーが出ない', err === null);
  const after = await db.query(`select * from public.offices order by office_code`);
  ok('F. 再実行でデータが変わらない', JSON.stringify(before.rows) === JSON.stringify(after.rows));
  ok('F. 列が重複していない',
     (await one(db, `select count(*)::int as n from information_schema.columns
                     where table_schema='public' and table_name='offices' and column_name='gdrive_folder_url'`)).n === 1);
}

// ---- G. 既存設定列を壊さない ----
console.log('G. 既存列への影響');
{
  const a = await one(db, `select basket_cart_limit, basket_order, printer_model from public.offices where office_code='A01'`);
  ok('G. 触っていない A01 の既存設定が不変（printer_model 含む）',
     a.basket_cart_limit === 10 && a.basket_order === 'ドライバー順' && a.printer_model === 'Brother TD-2350');
  ok('G. offices に write policy を作っていない',
     (await one(db, `select count(*)::int as n from pg_policies
                     where schemaname='public' and tablename='offices'
                       and cmd in ('INSERT','UPDATE','DELETE','ALL')`)).n === 0);
}

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
await db.close();
process.exit(fail ? 1 : 0);
