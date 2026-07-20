// pglite E2E: drop_address_master_v0.sql（⑤ drop ＋ 案a 旧zone_plan行の掃除）
//   固定の前提「SQLは人手でコピペ実行。渡す前に pglite で E2E 検証する」に基づく事前検証。
//
//   検証:
//     A. ★時限爆弾の実証と回避: ④未適用（関数が address_master を参照）のまま流すと
//        §0 ガードが中断する。ガードが無ければ drop は【エラー無しで成功】してしまうことも実証。
//     B. ③未完了（旧語彙の荷物あり）でも中断する
//     C. 正常系: drop 成功・policy 自動削除・旧zone_plan行の掃除（案a）
//     D. ★drop 後も 3関数が動く（＝時限爆弾が無かったことの実証）
//     E. 非破壊: 新語彙 zone_plan 行・deliveries・zoneplan_staging は残る
//     F. 掃除で参照先を失う荷物が出ない（§0(4) ガード）
//     G. 冪等: 再実行してもエラーなく件数が変わらない
// 実行: node supabase/vocab_fix_v0/pglite_test_drop.mjs
import { PGlite } from '../../node_modules/@electric-sql/pglite/dist/index.js';
import { readFileSync } from 'node:fs';

const DROP = readFileSync(new URL('./drop_address_master_v0.sql', import.meta.url), 'utf8');
const MIGRATE = readFileSync(new URL('./migrate_functions_to_area_master_v0.sql', import.meta.url), 'utf8');
const DISPATCH_SQL = readFileSync(new URL('../dispatch_v0/dispatch_v0.sql', import.meta.url), 'utf8');
const RPC_SQL = readFileSync(new URL('../ai_status_reply_v0/delivery_status_rpc_v0.sql', import.meta.url), 'utf8');

const origZoneRank = (DISPATCH_SQL.match(/create or replace function public\.zone_rank[\s\S]*?\r?\n\$\$;/) || [])[0];
const origStatus = (RPC_SQL.match(/create or replace function public\.delivery_status_public[\s\S]*?\r?\n\$\$;/) || [])[0];

let pass = 0, fail = 0;
const ok = (n, c) => (c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.error(`  ✗ ${n}`)));
const one = async (db, q) => (await db.query(q)).rows[0];

const SCHEMA = `
  create role anon; create role authenticated;
  create table public.zone_plan (
    common_id text primary key, zone_no text, adjacent_zones text,
    depot_code text, version integer not null default 1,
    is_valid boolean not null default true, split_threshold integer not null default 170
  );
  create table public.address_master (
    town_key text primary key, municipality text, town text,
    common_id text references public.zone_plan(common_id)   -- ★ create_schema_v0.sql:68 と同じFK
  );
  create table public.area_master (
    town_key text primary key, prefecture text, municipality text, town text, chome text,
    zone_no integer, common_id text, area text, depot text, source_town_key text,
    postal_code text, is_valid boolean not null default true, priority integer
  );
  create table public.deliveries (
    tracking_number text primary key, delivery_date date, common_id text,
    office_code text, status text, time_window text, delivery_order integer
  );
  create table public.zoneplan_staging (common_id text, zone_from text, split_threshold text);
  create table public.master_staging (town_key text, municipality text, common_id text);
  alter table public.address_master enable row level security;
  create policy address_master_hq on public.address_master for select to authenticated using (true);
`;

// 旧語彙3件（うち OKZ_W_13_18 は新語彙にも居る＝overlap=1 の再現）＋新語彙2件
const SEED = `
  insert into public.zone_plan (common_id, zone_no, adjacent_zones, depot_code) values
    ('OKZ_C_01_08','1','TYT_C_25_36,OKZ_S_14_24','D01'),   -- 旧語彙（掃除対象）
    ('TYT_C_25_36','2','OKZ_C_01_08','D01'),               -- 旧語彙（掃除対象）
    ('OKZ_W_13_18','3','OKZ_C_01_08','D01');               -- 新旧共通（②で残した＝掃除されない）
  insert into public.zone_plan (common_id, zone_no, adjacent_zones, depot_code) values
    ('ABK_C_29_32','29', null, '千葉県2'),                 -- ②で入れた新語彙
    ('AGE_C_01_05','1',  null, '埼玉県7'),
    -- 混在ケース: 新語彙(AGE)と旧語彙(TYT)が混ざった隣接 → §3-2 は AGE だけ残すはず
    ('MIX_C_01_02','1',  'AGE_C_01_05,TYT_C_25_36', '千葉県2');
  insert into public.address_master (town_key, municipality, common_id) values
    ('愛知県|岡崎市|箱柳町','岡崎市','OKZ_C_01_08'),
    ('愛知県|豊田市|西町','豊田市','TYT_C_25_36');
  insert into public.area_master (town_key, municipality, common_id, zone_no, depot, priority, is_valid) values
    ('千葉県|我孫子市|A','我孫子市','ABK_C_29_32', 29, '千葉県2', 1, true),
    ('埼玉県|上尾市|B','上尾市','AGE_C_01_05', 1, '埼玉県7', 1, true),
    ('愛知県|岡崎市|C','我孫子市','OKZ_W_13_18', 13, '愛知県1', 1, true),  -- 同一市ペア用（我孫子市）
    ('千葉県|柏市|D','柏市','MIX_C_01_02', 1, '千葉県2', 1, true);         -- §3-2 の混在ケース用
  insert into public.deliveries (tracking_number, delivery_date, common_id, office_code, status, time_window, delivery_order) values
    ('R-1','2026-07-25','ABK_C_29_32','A01','配車済','午前中', 12),
    ('R-2','2026-07-25','AGE_C_01_05','A01','配車済', null, 3);
`;

const fresh = async () => {
  const d = new PGlite();
  await d.exec(SCHEMA); await d.exec(SEED);
  await d.exec(origZoneRank); await d.exec(origStatus);
  await d.exec(`revoke execute on function public.delivery_status_public(text) from public;
                grant execute on function public.delivery_status_public(text) to anon, authenticated;`);
  return d;
};

// ---- A. 時限爆弾の実証 ---------------------------------------------------
console.log('A. ★時限爆弾: ④未適用のまま drop すると何が起きるか');
{
  const db = await fresh();
  // (1) ガードが無い場合＝素の drop は「エラー無しで成功」してしまう
  await db.exec(`drop table public.address_master;`);
  ok('A. 素の drop table は参照関数があっても【エラー無しで成功】する（pg_depend では検知不能）',
     (await one(db, `select to_regclass('public.address_master') is null as gone`)).gone === true);
  // そして次に関数を呼んだ瞬間に落ちる＝時限爆弾
  let boom = null;
  try { await db.query(`select public.delivery_status_public('R-1')`); } catch (e) { boom = e.message; }
  ok('A. その後 delivery_status_public を呼ぶと落ちる（＝時限爆弾が実在する）',
     boom !== null && /address_master/.test(boom));
  await db.close();
}
{
  const db = await fresh();
  let raised = null;
  try { await db.exec(DROP); } catch (e) { raised = e.message; }
  ok('A. ★本ファイルの §0 ガードは④未適用を検知して中断する', raised !== null);
  ok('A. エラーが時限爆弾と④/seq 3 を指示している',
     raised !== null && /時限爆弾/.test(raised) && /seq 3/.test(raised));
  ok('A. 中断時 address_master は残っている（ガードは drop より前）',
     (await one(db, `select to_regclass('public.address_master') is not null as alive`)).alive === true);
  await db.close();
}

// ---- B. ③未完了ガード ----------------------------------------------------
console.log('B. ③未完了（旧語彙の荷物あり）でも中断する');
{
  const db = await fresh();
  await db.exec(MIGRATE);   // ④は適用済みにする
  await db.exec(`insert into public.deliveries (tracking_number, delivery_date, common_id, office_code, status)
                 values ('OLD-1','2026-06-17','C0001','A01','配車済');`);
  let raised = null;
  try { await db.exec(DROP); } catch (e) { raised = e.message; }
  ok('B. 旧語彙の荷物が残っていると中断', raised !== null && /旧語彙/.test(raised));
  ok('B. 中断時 address_master は残っている',
     (await one(db, `select to_regclass('public.address_master') is not null as alive`)).alive === true);
  await db.close();
}

// ---- C〜G. 正常系 --------------------------------------------------------
console.log('C/D/E/F. 正常系（④適用済み → ⑤実行）');
const db = await fresh();
await db.exec(MIGRATE);
const zpBefore = await db.query(`select common_id from public.zone_plan order by common_id`);
ok('前提: zone_plan 6行（旧3＋新3）', zpBefore.rows.length === 6);

await db.exec(DROP);

{
  ok('C. address_master が drop された',
     (await one(db, `select to_regclass('public.address_master') is null as gone`)).gone === true);
  ok('C. policy がテーブルと共に自動削除された',
     (await one(db, `select count(*)::int as n from pg_policies
                     where schemaname='public' and tablename='address_master'`)).n === 0);
  ok('C. master_staging も drop された（§4・参照関数なし）',
     (await one(db, `select to_regclass('public.master_staging') is null as gone`)).gone === true);
}

{
  // 案a: 旧3行のうち OKZ_W_13_18 は新語彙にも居るので残り、OKZ_C_01_08 / TYT_C_25_36 が消える
  const rows = (await db.query(`select common_id from public.zone_plan order by common_id`)).rows
                 .map(r => r.common_id);
  ok('C.【案a】旧語彙行だけが掃除された（新語彙4件が残る）',
     JSON.stringify(rows) === JSON.stringify(
       ['ABK_C_29_32', 'AGE_C_01_05', 'MIX_C_01_02', 'OKZ_W_13_18']));

  // §3-2: 宙ぶらりんの隣接定義の掃除
  const adj = Object.fromEntries((await db.query(
    `select common_id, adjacent_zones from public.zone_plan`)).rows.map(r => [r.common_id, r.adjacent_zones]));
  ok('C.【§3-2】新旧共通行(OKZ_W_13_18)の旧語彙隣接が外れて NULL になった',
     adj['OKZ_W_13_18'] === null);
  ok('C.【§3-2】混在ケースは解決できるIDだけ残る（AGE_C_01_05 のみ・TYT は外れる）',
     adj['MIX_C_01_02'] === 'AGE_C_01_05');
  ok('C.【§3-2】元から NULL の新語彙行は不変', adj['ABK_C_29_32'] === null);
  const seq7 = (await one(db, `select count(*)::int as n from public.zone_plan zp
                               where not exists (select 1 from public.area_master am
                                                  where am.common_id = zp.common_id and am.is_valid)`)).n;
  ok('C.【案a】ゲート seq 7 相当が 0 になる', seq7 === 0);
  const seq8 = (await one(db, `select count(distinct trim(adj))::int as n
                               from public.zone_plan zp,
                                    unnest(string_to_array(coalesce(zp.adjacent_zones,''), ',')) as adj
                               where trim(adj) <> ''
                                 and not exists (select 1 from public.area_master am
                                                  where am.common_id = trim(adj) and am.is_valid)`)).n;
  ok('C.【案a】ゲート seq 8 相当も 0 になる（旧行の隣接定義ごと消えるため）', seq8 === 0);
}

{
  // ★D. drop 後も3関数が動く＝時限爆弾が無かったことの実証
  const m = (await one(db, `select public.delivery_status_public('R-1')->>'municipality' as m`)).m;
  ok('D. ★drop 後も delivery_status_public が動く（市名が返る）', m === '我孫子市');
  const r = (await one(db, `select public.zone_rank('ABK_C_29_32','OKZ_W_13_18') as r`)).r;
  ok('D. ★drop 後も zone_rank が動く（同一市＝我孫子市 → 2）', r === 2);
  const r99 = (await one(db, `select public.zone_rank('ABK_C_29_32','AGE_C_01_05') as r`)).r;
  ok('D. zone_rank の 99 判定も従来どおり', r99 === 99);
}

{
  ok('E. 新語彙の zone_plan 行が残っている（新語彙=3件と一致）',
     (await one(db, `select count(*)::int as n from public.zone_plan`)).n
     === (await one(db, `select count(distinct common_id)::int as n from public.area_master
                         where is_valid and common_id is not null`)).n);
  ok('E. deliveries は無変更（2件）',
     (await one(db, `select count(*)::int as n from public.deliveries`)).n === 2);
  ok('E. zoneplan_staging は残っている（dispatch_v0 が参照するため消してはいけない）',
     (await one(db, `select to_regclass('public.zoneplan_staging') is not null as alive`)).alive === true);
  ok('F. 掃除で参照先を失った荷物が無い',
     (await one(db, `select count(*)::int as n from public.deliveries d
                     where d.common_id is not null
                       and not exists (select 1 from public.zone_plan zp
                                        where zp.common_id = d.common_id)`)).n === 0);
}

// ---- G. 冪等 -------------------------------------------------------------
console.log('G. 冪等（再実行）');
{
  const s1 = await db.query(`select * from public.zone_plan order by common_id`);
  let err = null;
  try { await db.exec(DROP); } catch (e) { err = e.message; }
  ok('G. 再実行してもエラーが出ない', err === null);
  const s2 = await db.query(`select * from public.zone_plan order by common_id`);
  ok('G. 再実行しても zone_plan が変わらない', JSON.stringify(s1.rows) === JSON.stringify(s2.rows));
}
await db.close();

// ---- §0(4) ガード: 掃除対象を参照する荷物が居る場合 ----------------------
console.log('H. §0(4) ガード（掃除対象の旧行を参照する荷物が居ると中断）');
{
  const g = await fresh();
  await g.exec(MIGRATE);
  // area_master に無い common_id を持つ荷物 → §0(3) で先に捕まる想定だが、
  // §0(3) と §0(4) は同じ行を別角度で見るため、どちらかで必ず止まることを確認する
  await g.exec(`insert into public.deliveries (tracking_number, delivery_date, common_id, office_code, status)
                values ('X-1','2026-07-25','OKZ_C_01_08','A01','配車済');`);
  let raised = null;
  try { await g.exec(DROP); } catch (e) { raised = e.message; }
  ok('H. 旧 zone_plan 行を参照する荷物が居ると中断する', raised !== null);
  ok('H. 中断時に zone_plan は掃除されていない',
     (await one(g, `select count(*)::int as n from public.zone_plan`)).n === 6);
  await g.close();
}

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
