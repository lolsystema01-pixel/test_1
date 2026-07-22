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
  // 画面側の検証（^https://drive.google.com/…）と同条件を保存口にも持たせる＝RPC直叩きでも素通りしない
  ok('D. Drive 以外のURLは拒否（RPC直叩きでも画面と同じ判定が効く）',
     (await save('C01', 'https://example.com/folders/y', 'Brother TD-2350')) !== null);
  ok('D. URLらしくない文字列も拒否', (await save('C01', 'あとで入れる', 'Brother TD-2350')) !== null);
  // MED-1: 終端を固定していないと通る攻撃ベクトル（レビュー指摘・pgliteで実測した現物）
  ok('D. 改行注入（後ろに別URL）を拒否（$ではなく\\Zで終端固定）',
     (await save('C01', 'https://drive.google.com/\nhttps://evil.com/exfil', 'Brother TD-2350')) !== null);
  ok('D. HTMLタグ等の後続ゴミを拒否（改行が無くても通さない）',
     (await save('C01', 'https://drive.google.com/</a><script>alert(1)</script>', 'Brother TD-2350')) !== null);
  ok('D. 過大長（500文字超）を拒否',
     (await save('C01', 'https://drive.google.com/' + 'x'.repeat(600), 'Brother TD-2350')) !== null);
  ok('D. drive.google.com@evil.com は拒否（既に拒否されている設計の回帰）',
     (await save('C01', 'https://drive.google.com@evil.com/', 'Brother TD-2350')) !== null);
  ok('D. drive.google.com.evil.com は拒否（サブドメイン偽装）',
     (await save('C01', 'https://drive.google.com.evil.com/', 'Brother TD-2350')) !== null);
  // ここまで全て拒否されている＝1件も書き込まれていないことを先に確認する
  ok('D. 拒否された C01 は「未完」のまま',
     (await one(db, `select gdrive_folder_url from public.offices where office_code='C01'`)).gdrive_folder_url === null);
  ok('D. /u/0/ 付きの実URLは通る（アカウント番号付きでも Drive なら可）',
     (await save('C01', 'https://drive.google.com/drive/u/0/folders/abc', 'Brother TD-2350')) === null);
  // C01 は直前のテストで一度保存されている＝area では2回目になるため hq で上書きして確認
  await as('hq', null);
  ok('D. 正しい入力は通り、前後の空白は除去される',
     (await save('C01', '  https://drive.google.com/drive/folders/CHITA  ', '汎用サーマル')) === null
     && (await one(db, `select gdrive_folder_url from public.offices where office_code='C01'`))
          .gdrive_folder_url === 'https://drive.google.com/drive/folders/CHITA');
}

// ---- D-2. 空文字を DB に作れないこと（CHECK 制約）----
//   空文字を許すと「ゲートは完了とみなすのに area は直せない」宙づり状態になるため、
//   不正な状態を表現できなくする。postgres 直UPDATE でも作れないことを確認する。
console.log('D-2. 空文字の封じ込め（CHECK）');
{
  const chk = await one(db, `select count(*)::int as n from pg_constraint
                             where conname = 'offices_gdrive_folder_url_chk'`);
  ok('D-2. CHECK 制約 offices_gdrive_folder_url_chk がある', chk.n === 1);

  let e1 = null;
  try { await db.exec(`update public.offices set gdrive_folder_url = '' where office_code='A01'`); }
  catch (e) { e1 = e.message; }
  ok('D-2. postgres 直UPDATE でも空文字にできない', e1 !== null);

  let e2 = null;
  try { await db.exec(`update public.offices set gdrive_folder_url = '   ' where office_code='A01'`); }
  catch (e) { e2 = e.message; }
  ok('D-2. 空白のみもできない（btrim 判定）', e2 !== null);

  // MED-1: CHECK は「空文字」だけでなく Drive URL 形式・改行・過大長も弾く（直UPDATEでも）
  const rejectDirect = async (val) => {
    try { await db.query(`update public.offices set gdrive_folder_url = $1 where office_code='A01'`, [val]); return false; }
    catch { return true; }
  };
  ok('D-2. 直UPDATE: Drive以外のURLを CHECK が拒否', await rejectDirect('https://example.com/x'));
  ok('D-2. 直UPDATE: 改行注入を CHECK が拒否', await rejectDirect('https://drive.google.com/x\nhttps://evil.com'));
  ok('D-2. 直UPDATE: 500文字超を CHECK が拒否', await rejectDirect('https://drive.google.com/' + 'x'.repeat(600)));
  ok('D-2. 直UPDATE: 正常な Drive URL は通る', !(await rejectDirect('https://drive.google.com/drive/folders/ok')));

  ok('D-2. NULL には戻せる（未完に戻す運用は可能）',
     await db.exec(`update public.offices set gdrive_folder_url = null where office_code='A01'`)
       .then(() => true).catch(() => false));
}

// ---- D-3. TOCTOU: 「初回のみ」が書込みWHEREで保証されること（MED-2）----
//   read→write の間に別リクエストが確定するレースを、UPDATE の WHERE 条件で封じている。
//   pglite は単一接続で真の並行はできないため、「事前チェックを通過した後に v_current が
//   陳腐化した」状況を、A01 を直接 completed にしてから同一 area で保存させて再現する。
console.log('D-3. TOCTOU（初回のみの不変条件を書込みWHEREで保証）');
{
  await as('area', 'A01');
  // 事前チェックは v_current=null を見て通るが、実際の書込み前に別経路で completed になったと仮定
  await db.exec(`update public.offices set gdrive_folder_url = 'https://drive.google.com/drive/folders/RACE_WINNER'
                 where office_code='A01'`);
  const err = await save('A01', 'https://drive.google.com/drive/folders/RACE_LOSER', 'Brother TD-2350');
  ok('D-3. 既に完了済みの行への area 保存は WHERE 条件で0件→拒否される', err !== null);
  ok('D-3. 先発（RACE_WINNER）が後発に上書きされていない',
     (await one(db, `select gdrive_folder_url from public.offices where office_code='A01'`))
       .gdrive_folder_url === 'https://drive.google.com/drive/folders/RACE_WINNER');
  // hq は WHERE の (v_role='hq' OR …) 側で常に更新できる（完了後でも）
  await as('hq', null);
  ok('D-3. hq は完了後でも更新できる（WHERE の hq 分岐）',
     (await save('A01', 'https://drive.google.com/drive/folders/BY_HQ', '汎用サーマル')) === null);
  await db.exec(`update public.offices set gdrive_folder_url = null where office_code='A01'`);
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
  // ※ A01 は D-3（hqの完了後更新）で printer_model を変えたため、ここでは「モジュール適用が
  //   既存の設定機構を壊していないか」を構造で見る（列の存在・型不変・write policy 無し）。
  const cols = (await db.query(`
    select column_name from information_schema.columns
    where table_schema='public' and table_name='offices'
      and column_name in ('basket_cart_limit','basket_order','printer_model','auto_logout_enabled')`)).rows.map(r => r.column_name).sort();
  ok('G. 既存の設定列（basket_cart_limit/basket_order/printer_model/auto_logout_enabled）が残っている',
     JSON.stringify(cols) === JSON.stringify(['auto_logout_enabled','basket_cart_limit','basket_order','printer_model']));
  ok('G. 既存の printer_model CHECK 制約を壊していない',
     (await one(db, `select count(*)::int as n from pg_constraint where conname='offices_printer_model_chk'`)).n === 1);
  ok('G. offices に write policy を作っていない',
     (await one(db, `select count(*)::int as n from pg_policies
                     where schemaname='public' and tablename='offices'
                       and cmd in ('INSERT','UPDATE','DELETE','ALL')`)).n === 0);
}

// ---- H. set_office_gdrive_url（hq専用の再編集口・NULLクリア可）----
console.log('H. hq 再編集口 set_office_gdrive_url');
{
  const setUrl = async (office, url) => {
    try { await db.query(`select public.set_office_gdrive_url($1,$2)`, [office, url]); return null; }
    catch (e) { return e.message; }
  };
  // 前提: C01 を完了状態にしておく（hqで）
  await as('hq', null);
  await setUrl('C01', 'https://drive.google.com/drive/folders/BEFORE');
  ok('H. hq が既存URLを別URLに付け替えできる',
     (await setUrl('C01', 'https://drive.google.com/drive/folders/AFTER')) === null
     && (await one(db, `select gdrive_folder_url from public.offices where office_code='C01'`))
          .gdrive_folder_url === 'https://drive.google.com/drive/folders/AFTER');
  ok('H. hq は NULL で「未完に戻す」ことができる（save_office_init_setup にはできない操作）',
     (await setUrl('C01', null)) === null
     && (await one(db, `select gdrive_folder_url from public.offices where office_code='C01'`))
          .gdrive_folder_url === null);
  ok('H. 空文字も NULL に正規化される（未完）',
     (await setUrl('C01', '   ')) === null
     && (await one(db, `select gdrive_folder_url from public.offices where office_code='C01'`))
          .gdrive_folder_url === null);
  ok('H. 不正URL（Drive以外）は CHECK と同一条件で拒否', (await setUrl('C01', 'https://evil.com/x')) !== null);
  ok('H. 改行注入も拒否', (await setUrl('C01', 'https://drive.google.com/x\nhttps://evil.com')) !== null);
  ok('H. 存在しない営業所は P0002', (await setUrl('NOPE', 'https://drive.google.com/drive/folders/x')) !== null);
  // area は使えない
  await as('area', 'IT01');
  ok('H. area は set_office_gdrive_url を使えない（自営業所でも拒否）',
     (await setUrl('IT01', 'https://drive.google.com/drive/folders/x')) !== null);
  ok('H. driver も拒否',
     (await as('driver', null), await setUrl('IT01', 'https://drive.google.com/drive/folders/x')) !== null);
}

// ---- I. is_valid_gdrive_url ヘルパー（単一の正・CHECKと両RPCが共有）----
console.log('I. is_valid_gdrive_url（受理判定の単一の正）');
{
  const valid = async (u) => (await db.query(`select public.is_valid_gdrive_url($1) as v`, [u])).rows[0].v;
  ok('I. 正常URLは true', (await valid('https://drive.google.com/drive/folders/abc')) === true);
  ok('I. 前後空白ありは false（trim済みを要求）', (await valid(' https://drive.google.com/x ')) === false);
  ok('I. 改行入りは false', (await valid('https://drive.google.com/x\ny')) === false);
  ok('I. NULL は false', (await valid(null)) === false);
  ok('I. immutable として定義されている（CHECK から参照可能）',
     (await one(db, `select provolatile from pg_proc where proname='is_valid_gdrive_url'`)).provolatile === 'i');
}

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
await db.close();
process.exit(fail ? 1 : 0);
