// pglite: recheck_vocab_gates_v0.sql（語彙ゲート再実行・1画面版）の検証
//   目的: 渡す前の検証（固定の前提「SQLは人手でコピペ実行。渡す前に検証する」）。
//   検証内容:
//     A. 現状シナリオ（②③未着手・①適用済）で各ゲートが期待どおり判定されるか
//     B. データを直すと judge が ✗ → ✅ に反転するか（判定が固定値でないことの証明）
//     C. U+FFFD を仕込むと ①-d の回帰確認が ✗ に落ちるか（検知が生きていることの証明）
//     D. 読むだけ（DDL/DML を含まない）
// 実行: node supabase/area_master_mojibake_fix_v0/pglite_test_recheck.mjs
import { PGlite } from '../../node_modules/@electric-sql/pglite/dist/index.js';
import { readFileSync } from 'node:fs';

const SQL = readFileSync(new URL('./recheck_vocab_gates_v0.sql', import.meta.url), 'utf8');
const FFFD = String.fromCharCode(65533);

let pass = 0, fail = 0;
const ok = (n, c) => (c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.error(`  ✗ ${n}`)));
const row = (rs, seq) => rs.rows.find(r => Number(r.seq) === seq);

const db = new PGlite();

// ---- スキーマ（本基盤と同じ列構成・最小） -----------------------------
await db.exec(`
  create table public.address_master (
    town_key text primary key, municipality text, town text, common_id text, prefecture text
  );
  create table public.zone_plan (
    common_id text primary key, zone_no text, adjacent_zones text
  );
  create table public.area_master_staging (
    prefecture text, municipality text, town text, chome text, zone_no text,
    common_id text, is_valid text, priority text, area text, depot text,
    src_town_key text, postal_code text
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

// ---- address_master を参照する3関数（prosrc に address_master を含むこと） ----
await db.exec(`
  create function public.zone_rank(a text, b text) returns int language sql as $$
    select case when (select am.municipality from public.address_master am where am.common_id = a limit 1)
                   = (select am.municipality from public.address_master am where am.common_id = b limit 1)
                then 1 else 3 end
  $$;
  create function public.dispatch_build(p_date date) returns int language sql as $$
    select count(*)::int from public.deliveries d
    left join public.address_master am on am.common_id = d.common_id
    where d.delivery_date = p_date
  $$;
  create function public.delivery_status_public(p_tracking_number text) returns text
    language sql security definer as $$
    select (select am.municipality from public.address_master am where am.common_id = d.common_id limit 1)
    from public.deliveries d where d.tracking_number = p_tracking_number
  $$;
`);

// ---- シナリオA: ①適用済（U+FFFD 0件）・②③未着手 ---------------------
// area_master = 新語彙。うち3件は「本物の複数自治体」（①では消えない＝④で order by 必須）
await db.exec(`
  insert into public.area_master (town_key, prefecture, municipality, town, common_id, is_valid, priority) values
    ('群馬県|安中市|中宿','群馬県','安中市','中宿','GM2_07_07', true, 1),
    ('群馬県|藤岡市|中大塚','群馬県','藤岡市','中大塚','GM2_07_07', true, 2),
    ('兵庫県|加古川市|別府町','兵庫県','加古川市','別府町','HY4_12', true, 1),
    ('兵庫県|加古郡播磨町|本荘','兵庫県','加古郡播磨町','本荘','HY4_12', true, 2),
    ('京都府|京都市上京区|石橋町','京都府','京都市上京区','石橋町','KY3_NAK_186_195', true, 1),
    ('京都府|京都市中京区|石橋町','京都府','京都市中京区','石橋町','KY3_NAK_186_195', true, 2),
    ('愛知県|岡崎市|箱柳町','愛知県','岡崎市','箱柳町','OKZ_C_01_06', true, 1),
    ('愛知県|岡崎市|無効町','愛知県','岡崎市','無効町','OKZ_X_99_99', false, 1);
  insert into public.address_master (town_key, municipality, town, common_id) values
    ('愛知県|岡崎市|箱柳町','岡崎市','箱柳町','OKZ_C_01_08'),
    ('愛知県|豊田市|西町','豊田市','西町','TYT_C_25_36');
  -- zone_plan は丸ごと旧語彙（adjacent も旧語彙）
  insert into public.zone_plan (common_id, zone_no, adjacent_zones) values
    ('OKZ_C_01_08','1','TYT_C_25_36,OKZ_S_14_24'),
    ('TYT_C_25_36','2','OKZ_C_01_08');
  -- deliveries: 旧語彙4行（DSPダミー日付）＋ 新語彙2行（実データ日付）
  insert into public.deliveries (tracking_number, delivery_date, common_id) values
    ('DSP-1','2026-06-17','OKZ_C_01_08'),
    ('DSP-2','2026-06-17','OKZ_C_01_08'),
    ('DSP-3','2026-06-17','TYT_C_25_36'),
    ('DSP-4','2026-06-16','OKZ_C_01_08'),
    ('R-1','2026-07-04','OKZ_C_01_06'),
    ('R-2','2026-07-10','GM2_07_07');
`);

console.log('A. 現状シナリオ（①適用済・②③未着手）');
let rs = await db.query(SQL);
ok('13行返る', rs.rows.length === 13);
ok('①-d area_master U+FFFD=0 → ✅維持', row(rs,1).actual === '0' && row(rs,1).judge.startsWith('✅'));
ok('①-d staging U+FFFD=0 → ✅維持', row(rs,2).actual === '0' && row(rs,2).judge.startsWith('✅'));
ok('§1-1 参照関数=3 → ⏸（④の書換対象）', row(rs,3).actual === '3' && row(rs,3).judge.startsWith('⏸'));
ok('§1-1 detail に3関数名とDEFINER表示',
   /zone_rank/.test(row(rs,3).detail) && /dispatch_build/.test(row(rs,3).detail)
   && /delivery_status_public\(DEFINER\)/.test(row(rs,3).detail));
ok('§1-2 ビュー参照=0 → ✅', row(rs,4).actual === '0' && row(rs,4).judge.startsWith('✅'));
ok('§1-3 FK=0 → ✅', row(rs,5).actual === '0' && row(rs,5).judge.startsWith('✅'));
ok('§2 deliveries 旧語彙=4 → ✗不合格', row(rs,6).actual === '4' && row(rs,6).judge.startsWith('✗'));
ok('§2 detail に日付別内訳', /2026-06-16=1行/.test(row(rs,6).detail) && /2026-06-17=3行/.test(row(rs,6).detail));
ok('§3-1 zone_plan 未対応=2/2行中 → ✗', row(rs,7).actual === '2 / 2行中' && row(rs,7).judge.startsWith('✗'));
ok('§3-2 未知の隣接ID=3 → ✗', row(rs,8).actual === '3' && row(rs,8).judge.startsWith('✗'));
ok('§4-1 非一意=3（本物のみ）→ ⚠ order by必須',
   row(rs,9).actual === '3' && row(rs,9).judge.startsWith('⚠'));
ok('§4-1 detail に3件の共通IDと自治体名',
   /GM2_07_07（安中市・藤岡市）/.test(row(rs,9).detail) && /HY4_12/.test(row(rs,9).detail)
   && /KY3_NAK_186_195/.test(row(rs,9).detail));
ok('§4-1 は is_valid=false を除外している（OKZ_X_99_99 が出ない）', !/OKZ_X_99_99/.test(row(rs,9).detail));
ok('②前提a depot 非一意=0 → ✅（ばらつくのは zone_no だけ）',
   row(rs,10).actual === '0' && row(rs,10).judge.startsWith('✅'));
ok('§5: ⑤未実施なら「有り」→ ℹ️ address_master が残っていると表示',
   /有り/.test(row(rs,13).actual) && /⑤未実施/.test(row(rs,13).judge));

// ②前提ゲート a/b/c の実証: 実データと同じ「範囲エンコード」を仕込む
//   ABK_C_29_32 = zone 29〜32・depot は一定（= 本番で観測された形）
{
  await db.exec(`
    insert into public.area_master (town_key, prefecture, municipality, town, common_id, zone_no, depot, is_valid, priority) values
      ('千葉県|我孫子市|A','千葉県','我孫子市','A','ABK_C_29_32', 29, '千葉県2', true, 1),
      ('千葉県|我孫子市|B','千葉県','我孫子市','B','ABK_C_29_32', 30, '千葉県2', true, 2),
      ('千葉県|我孫子市|C','千葉県','我孫子市','C','ABK_C_29_32', 31, '千葉県2', true, 3),
      ('千葉県|我孫子市|D','千葉県','我孫子市','D','ABK_C_29_32', 32, '千葉県2', true, 4);`);
  const r2 = await db.query(SQL);
  ok('②前提a: depot が一定なら依然 ✅（範囲エンコードを depot 問題と誤検出しない）',
     row(r2,10).actual === '0' && row(r2,10).judge.startsWith('✅'));
  ok('②前提b: zone_no 非一意を1件検出（想定内表示）',
     row(r2,11).actual.startsWith('1 / ') && row(r2,11).judge.startsWith('ℹ️'));
  ok('②前提c: 名前の _29_32 と min/max(29,32) が一致 → ✅ min採用の根拠',
     row(r2,12).actual === '1 / 1一致' && /min採用の根拠が取れた/.test(row(r2,12).judge));

  // c が「効く」ことの実証: 名前とズレた範囲を混ぜると ⚠ に落ちる
  await db.exec(`insert into public.area_master
    (town_key, prefecture, municipality, town, common_id, zone_no, depot, is_valid, priority)
    values ('千葉県|我孫子市|E','千葉県','我孫子市','E','ABK_C_29_32', 5, '千葉県2', true, 5);`);
  const r3 = await db.query(SQL);
  ok('②前提c: min(5) が名前の From(29) とズレると ⚠ を検知',
     /From 不一致が 1件/.test(row(r3,12).judge));

  // a が「効く」ことの実証: depot をばらつかせると ✗ に落ちる
  await db.exec(`update public.area_master set depot = '千葉県9' where town_key = '千葉県|我孫子市|E';`);
  const r4 = await db.query(SQL);
  ok('②前提a: depot をばらつかせると ✗ を検知',
     row(r4,10).actual === '1' && row(r4,10).judge.startsWith('✗')
     && /ABK_C_29_32/.test(row(r4,10).detail));

  await db.exec(`delete from public.area_master where town_key like '千葉県|我孫子市|%';`);
}

// ---- シナリオB: ②③を解消 → judge が反転するか ----------------------
console.log('B. ②③解消後（judge が ✗→✅ に反転するか＝判定が固定値でない証明）');
await db.exec(`
  delete from public.deliveries where tracking_number like 'DSP-%';   -- ③解消
  delete from public.zone_plan;                                        -- ②解消（新語彙で入れ直す想定）
  insert into public.zone_plan (common_id, zone_no, adjacent_zones) values
    ('OKZ_C_01_06','1','GM2_07_07'),
    ('GM2_07_07','2','OKZ_C_01_06');
`);
rs = await db.query(SQL);
ok('§2 → ✅合格に反転', row(rs,6).actual === '0' && row(rs,6).judge.startsWith('✅'));
ok('§3-1 → ✅合格に反転', row(rs,7).actual === '0 / 2行中' && row(rs,7).judge.startsWith('✅'));
ok('§3-2 → ✅合格に反転', row(rs,8).actual === '0' && row(rs,8).judge.startsWith('✅'));
ok('§1-1 は依然 ⏸（④未実施＝関数は残る）', row(rs,3).actual === '3' && row(rs,3).judge.startsWith('⏸'));

// ---- シナリオC: ④実施（関数から address_master を除去）→ ⑤drop可 ----
console.log('C. ④実施後（3関数を area_master 参照へ書換）→ §1-1 が ✅ に');
await db.exec(`
  create or replace function public.zone_rank(a text, b text) returns int language sql as $$
    select case when (select am.municipality from public.area_master am
                       where am.common_id = a and am.is_valid
                       order by am.priority asc nulls last, am.town_key limit 1)
                   = (select am.municipality from public.area_master am
                       where am.common_id = b and am.is_valid
                       order by am.priority asc nulls last, am.town_key limit 1)
                then 1 else 3 end
  $$;
  create or replace function public.dispatch_build(p_date date) returns int language sql as $$
    select count(*)::int from public.deliveries d
    left join public.area_master am on am.common_id = d.common_id and am.is_valid
    where d.delivery_date = p_date
  $$;
  create or replace function public.delivery_status_public(p_tracking_number text) returns text
    language sql security definer as $$
    select (select am.municipality from public.area_master am
             where am.common_id = d.common_id and am.is_valid
             order by am.priority asc nulls last, am.town_key limit 1)
    from public.deliveries d where d.tracking_number = p_tracking_number
  $$;
`);
rs = await db.query(SQL);
ok('§1-1 参照関数=0 → ✅ ⑤drop可', row(rs,3).actual === '0' && /⑤drop可/.test(row(rs,3).judge));

// ---- シナリオD: U+FFFD を仕込む → ①-d の回帰確認が落ちるか ----------
console.log('D. U+FFFD 混入 → ①-d の回帰確認が ✗ に落ちるか（検知が生きている証明）');
await db.query(`insert into public.area_master (town_key, municipality, common_id, is_valid)
                values ($1, $2, 'ZZZ_1', true)`, [`壊れ${FFFD}町`, `壊${FFFD}市`]);
await db.query(`insert into public.area_master_staging (municipality, src_town_key)
                values ($1, $2)`, [`壊${FFFD}市`, 'x']);
rs = await db.query(SQL);
ok('①-d area_master → ✗ 再発を検知', row(rs,1).actual === '1' && row(rs,1).judge.startsWith('✗'));
ok('①-d staging → ✗ 再発を検知', row(rs,2).actual === '1' && row(rs,2).judge.startsWith('✗'));

// ---- F. address_master を drop した後でも動くか（⑤完了後の環境） --------
//   ⚠ 素の 'public.address_master'::regclass や select ... from public.address_master は
//     テーブル不在だとキャスト/パースで落ちる。drop 前後どちらでも動くことを実証する。
console.log('F. ⑤完了後（address_master が drop 済み）でも動くか');
{
  await db.exec(`alter table public.address_master drop constraint if exists address_master_common_id_fkey;`);
  await db.exec(`drop table public.address_master;`);
  let err = null; let rs3 = null;
  try { rs3 = await db.query(SQL); } catch (e) { err = e.message; }
  ok('F. drop 済みでもエラーなく実行できる（regclass キャスト・直接参照を持たない）',
     err === null);
  if (rs3) {
    ok('F. 13行返る', rs3.rows.length === 13);
    ok('F. §1-3（FK）は 0 → ✅（to_regclass が NULL を返すため）',
       row(rs3,5).actual === '0' && row(rs3,5).judge.startsWith('✅'));
    ok('F. §5 が「(drop済み)」→ ✅ ⑤完了 と表示',
       /\(drop済み\)/.test(row(rs3,13).actual) && /⑤完了/.test(row(rs3,13).judge));
    ok('F. §1-1（prosrc 検索）は drop 後も機能する',
       row(rs3,3).actual === '0');
  }
}

// ---- E: 読むだけ保証 -------------------------------------------------
console.log('E. 読むだけ保証');
// コメント（--）と文字列リテラル（'...'）を除去してから判定する。
//   表示用の文言（例: '✅ 参照なし＝⑤drop可'）に含まれる語は SQL 文ではないため除外する。
//   ※ 元テスト（pglite_test_audit.mjs:142）は 'drop ' と末尾スペースで判定しており
//     "⑤drop可" は素通りしていた。ここでは語そのものを見るぶん厳しくしている。
const body = SQL
  .replace(/--[^\n]*/g, ' ')        // 行コメント
  .replace(/'(?:[^']|'')*'/g, "''") // 文字列リテラル
  .toLowerCase();
const banned = ['drop', 'delete', 'update', 'insert', 'alter', 'truncate', 'grant', 'revoke'];
const hit = banned.filter(k => new RegExp(`\\b${k}\\b`).test(body));
ok(`読むだけ保証: DDL/DML を含まない（検出: ${hit.join(',') || 'なし'}）`, hit.length === 0);
// create は CTE の 'create' 誤検出を避けるため語境界で個別に確認
ok('create 文を含まない', !/\bcreate\s+(table|function|view|index|policy|type|schema)\b/.test(body));
// 実際に読み取り専用トランザクションで通ることを実証（最も確実な証明）
await db.exec('begin; set transaction read only;');
let roOk = true;
try { await db.query(SQL); } catch (e) { roOk = false; console.error('   read only 実行で失敗:', e.message); }
await db.exec('rollback;');
ok('read only トランザクションで実行できる（＝書込みを一切しない実証）', roOk);

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
await db.close();
process.exit(fail ? 1 : 0);
