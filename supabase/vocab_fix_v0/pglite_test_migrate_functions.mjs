// pglite E2E: migrate_functions_to_area_master_v0.sql（④ 3関数の書換）
//   固定の前提「SQLは人手でコピペ実行。渡す前に pglite で E2E 検証する」に基づく事前検証。
//
//   検証:
//     A. 転記の正確性（最重要）: リポジトリ原本（dispatch_v0.sql / delivery_status_rpc_v0.sql）から
//        抽出した prosrc に「想定した置換」だけを適用した文字列と、移行後の prosrc が
//        文字単位（空白正規化）で一致する。＝1行でも書き落とし・言い換えがあれば落ちる。
//     B. 劣化の再現と解消: 旧実装では新語彙の市名が引けない（municipality NULL・同一市判定99）
//        ことを先に実証し、④適用後に解消することを確認。
//     C. zone_rank: 1（同一）/ 2（同一市・新語彙で復活）/ 3（隣接・従来どおり）/ 99（対象外）
//     D. 決定化: priority asc nulls last → town_key。is_valid=false は無視。
//     E. dispatch_build E2E: 実行して dispatch_zones.municipality が全行非NULL（指示書④の合格条件）
//     F. delivery_status_public: 市名が返る・PIIキーが増えていない・
//        属性（definer/stable/search_path）維持・anon 実行可
//     G. 監査: prosrc の旧マスタ参照が 3 → 0 になる
//     H. §0 ガード: 旧語彙の荷物が残っていると中断し、関数は書き換えられない
//     I. 冪等: 再実行しても prosrc が変わらない
// 実行: node supabase/vocab_fix_v0/pglite_test_migrate_functions.mjs
import { PGlite } from '../../node_modules/@electric-sql/pglite/dist/index.js';
import { readFileSync } from 'node:fs';

const MIGRATE = readFileSync(new URL('./migrate_functions_to_area_master_v0.sql', import.meta.url), 'utf8');
const DISPATCH_SQL = readFileSync(new URL('../dispatch_v0/dispatch_v0.sql', import.meta.url), 'utf8');
const RPC_SQL = readFileSync(new URL('../ai_status_reply_v0/delivery_status_rpc_v0.sql', import.meta.url), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c) => (c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.error(`  ✗ ${n}`)));
const norm = (s) => s.replace(/\s+/g, ' ').trim();

// ---- 原本から3関数の定義を抽出（＝リポジトリのファイルが正） ----------
const origZoneRank = (DISPATCH_SQL.match(/create or replace function public\.zone_rank[\s\S]*?\r?\n\$\$;/) || [])[0];
const origDispatchBuild = (DISPATCH_SQL.match(/create or replace function public\.dispatch_build[\s\S]*?\r?\nend;\r?\n\$\$;/) || [])[0];
const origStatus = (RPC_SQL.match(/create or replace function public\.delivery_status_public[\s\S]*?\r?\n\$\$;/) || [])[0];
ok('原本抽出: 3関数とも取得できた', !!(origZoneRank && origDispatchBuild && origStatus));

// 想定する置換（これ以外の差分があれば A で落ちる）
const REPL = [
  ['from public.address_master am where am.common_id = a limit 1',
   'from public.area_master am where am.common_id = a and am.is_valid order by am.priority asc nulls last, am.town_key limit 1'],
  ['from public.address_master am where am.common_id = b limit 1',
   'from public.area_master am where am.common_id = b and am.is_valid order by am.priority asc nulls last, am.town_key limit 1'],
  ['from public.address_master am where am.common_id = dv.common_id limit 1',
   'from public.area_master am where am.common_id = dv.common_id and am.is_valid order by am.priority asc nulls last, am.town_key limit 1'],
  ['from public.address_master am where am.common_id = d.common_id limit 1',
   'from public.area_master am where am.common_id = d.common_id and am.is_valid order by am.priority asc nulls last, am.town_key limit 1'],
];
const applyRepl = (s) => REPL.reduce((acc, [o, n]) => acc.split(o).join(n), norm(s));

// ---- スキーマ（3関数が参照する表を本基盤と同じ列で最小構成） ----------
const SCHEMA = `
  create role anon; create role authenticated;
  create table public.address_master (
    town_key text primary key, municipality text, town text, common_id text
  );
  create table public.area_master (
    town_key text primary key, prefecture text, municipality text, town text, chome text,
    zone_no integer, common_id text, area text, depot text, source_town_key text,
    postal_code text, is_valid boolean not null default true, priority integer
  );
  create index idx_area_master_common on public.area_master (common_id);
  create table public.zone_plan (
    common_id text primary key, zone_no text, adjacent_zones text,
    depot_code text, split_threshold integer not null default 170
  );
  create table public.deliveries (
    tracking_number text primary key, delivery_date date, common_id text,
    office_code text, status text, time_window text, delivery_order integer
  );
  create table public.drivers (
    driver_id text primary key, office_code text, skill_per_hour integer
  );
  create table public.work_schedules (
    id bigint generated always as identity primary key,
    driver_id text, work_date date, work_type text, application_status text
  );
  create table public.shift_hours (work_type text primary key, hours numeric);
  create table public.dispatch_drivers (
    run_date date, office_code text, driver_id text, driver_kind text,
    skill integer, hours numeric, cap integer, assigned_qty integer
  );
  create table public.dispatch_zones (
    run_date date, office_code text, common_id text, municipality text,
    qty integer, threshold integer, split_count integer
  );
  create table public.dispatch_assignments (
    run_date date, tracking_number text, office_code text, common_id text,
    driver_id text, driver_kind text, assign_rank integer
  );
`;

// area_master: 実測で確認した3パターン（同一市・複数自治体・nulls last）＋無効行デコイ
const SEED = `
  insert into public.area_master (town_key, municipality, common_id, zone_no, priority, is_valid) values
    ('愛知県|岡崎市|箱柳町',        '岡崎市',       'OKZ_C_01_06', 1,  7,    true),
    ('愛知県|岡崎市|小美町',        '岡崎市',       'OKZ_E_05_12', 5,  3,    true),
    ('愛知県|豊田市|西町',          '豊田市',       'TYT_C_25_36', 25, 1,    true),
    ('群馬県|安中市|中宿',          '安中市',       'GM2_07_07',   7,  1,    true),
    ('群馬県|藤岡市|中大塚',        '藤岡市',       'GM2_07_07',   7,  2,    true),
    ('群馬県|偽市|無効町',          '無効市',       'GM2_07_07',   7,  0,    false),
    ('兵庫県|加古川市|別府町',      '加古川市',     'HY4_12',      12, null, true),
    ('兵庫県|加古郡播磨町|本荘',    '加古郡播磨町', 'HY4_12',      12, 5,    true);
  insert into public.zone_plan (common_id, zone_no, adjacent_zones) values
    ('OKZ_C_01_06', '1', 'GM2_07_07'),
    ('OKZ_E_05_12', '5', null),
    ('TYT_C_25_36', '25', null),
    ('GM2_07_07',   '7', null),
    ('HY4_12',      '12', null);
  insert into public.shift_hours (work_type, hours) values ('日勤', 8);
  insert into public.drivers (driver_id, office_code, skill_per_hour) values ('DRV001', 'A01', 10);
  insert into public.work_schedules (driver_id, work_date, work_type, application_status)
    values ('DRV001', '2026-07-20', '日勤', '承認');
  insert into public.deliveries (tracking_number, delivery_date, common_id, office_code, status, time_window, delivery_order) values
    ('T-01','2026-07-20','OKZ_C_01_06','A01','未配車', null, null),
    ('T-02','2026-07-20','OKZ_C_01_06','A01','未配車', null, null),
    ('T-03','2026-07-20','OKZ_C_01_06','A01','未配車', null, null),
    ('T-04','2026-07-20','OKZ_C_01_06','A01','未配車', null, null),
    ('T-05','2026-07-20','OKZ_C_01_06','A01','未配車', null, null),
    ('T-06','2026-07-20','GM2_07_07','A01','未配車', null, null),
    ('T-07','2026-07-20','GM2_07_07','A01','未配車', null, null),
    ('T-08','2026-07-20','GM2_07_07','A01','未配車', null, null),
    ('T-09','2026-07-20','TYT_C_25_36','B01','未配車', null, null),
    ('T-10','2026-07-20','TYT_C_25_36','B01','未配車', null, null),
    ('R-1','2026-07-25','GM2_07_07','A01','配車済','午前中', 12),
    ('R-2','2026-07-25','HY4_12','A01','配車済', null, 3),
    ('R-3','2026-07-25','KY3_NAK_186_195','A01','配車済', null, 5);
  insert into public.area_master (town_key, municipality, common_id, zone_no, priority, is_valid) values
    ('京都府|京都市上京区|石橋町', '京都市上京区', 'KY3_NAK_186_195', 186, null, true),
    ('京都府|京都市中京区|石橋町', '京都市中京区', 'KY3_NAK_186_195', 186, null, true);
`;

const db = new PGlite();
await db.exec(SCHEMA);
await db.exec(SEED);
await db.exec(origZoneRank);
await db.exec(origDispatchBuild);
await db.exec(origStatus);
await db.exec(`revoke execute on function public.delivery_status_public(text) from public;
               grant execute on function public.delivery_status_public(text) to anon, authenticated;`);

const prosrc = async (name) =>
  (await db.query(`select prosrc from pg_proc where proname = $1`, [name])).rows[0].prosrc;
const audit = async () =>
  (await db.query(`select count(*)::int as n from pg_proc pr
                   join pg_namespace ns on ns.oid = pr.pronamespace
                   where ns.nspname not in ('pg_catalog','information_schema')
                     and pr.prosrc ilike '%address_master%'`)).rows[0].n;

// ---- B. 旧実装の劣化を先に実証 ----------------------------------------
console.log('B. 旧実装の劣化の再現（address_master には新語彙が無い）');
ok('B. 監査: 旧マスタ参照 = 3関数（移行前）', (await audit()) === 3);
{
  const r = (await db.query(`select (public.delivery_status_public('R-1')->>'municipality') as m`)).rows[0];
  ok('B. 旧実装: 新語彙の市名が引けない（municipality NULL＝静かな劣化）', r.m === null);
  const z = (await db.query(`select public.zone_rank('OKZ_C_01_06','OKZ_E_05_12') as r`)).rows[0];
  ok('B. 旧実装: 同一市（岡崎市同士）でも 99（同一市判定不成立）', z.r === 99);
}

const before = {
  zone_rank: await prosrc('zone_rank'),
  dispatch_build: await prosrc('dispatch_build'),
  delivery_status_public: await prosrc('delivery_status_public'),
};

// ---- ④ 適用 -----------------------------------------------------------
console.log('A. 移行の適用と転記の正確性（原本＋想定置換 == 移行後・文字単位）');
await db.exec(MIGRATE);

for (const fn of ['zone_rank', 'dispatch_build', 'delivery_status_public']) {
  const after = await prosrc(fn);
  ok(`A. ${fn}: 原本prosrc＋想定置換 == 移行後prosrc（転記に欠落・言い換えなし）`,
     applyRepl(before[fn]) === norm(after));
}
ok('G. 監査: 旧マスタ参照 = 0（recheck seq 3 が「✅ ⑤drop可」になる）', (await audit()) === 0);

// ---- C. zone_rank の4ランク --------------------------------------------
console.log('C. zone_rank: 1 / 2 / 3 / 99');
{
  const q = async (a, b) => (await db.query(`select public.zone_rank($1,$2) as r`, [a, b])).rows[0].r;
  ok('C. 同一ID → 1', (await q('OKZ_C_01_06', 'OKZ_C_01_06')) === 1);
  ok('C. 同一市の異なるID → 2（新語彙で同一市判定が復活）', (await q('OKZ_C_01_06', 'OKZ_E_05_12')) === 2);
  ok('C. 隣接（zone_plan.adjacent_zones・従来どおり）→ 3', (await q('OKZ_C_01_06', 'GM2_07_07')) === 3);
  ok('C. 無関係 → 99', (await q('OKZ_E_05_12', 'TYT_C_25_36')) === 99);
}

// ---- D. 決定化 ----------------------------------------------------------
console.log('D. 決定化（priority asc nulls last → town_key・is_valid除外）');
{
  const m = async (tn) =>
    (await db.query(`select (public.delivery_status_public($1)->>'municipality') as m`, [tn])).rows[0].m;
  ok('D. GM2_07_07 → 安中市（priority 1 が 2 に勝つ。priority 0 の無効行は無視）',
     (await m('R-1')) === '安中市');
  ok('D. HY4_12 → 加古郡播磨町（priority 5 が null に勝つ＝nulls last）',
     (await m('R-2')) === '加古郡播磨町');
  const expected = (await db.query(
    `select municipality from public.area_master
     where common_id = 'KY3_NAK_186_195' and is_valid
     order by priority asc nulls last, town_key limit 1`)).rows[0].municipality;
  ok(`D. KY3_NAK_186_195 → town_key タイブレークと関数出力が一致（${expected}）`,
     (await m('R-3')) === expected);
}

// ---- E. dispatch_build E2E ----------------------------------------------
console.log('E. dispatch_build 実行（指示書④の合格条件）');
{
  await db.query(`select public.dispatch_build(date '2026-07-20')`);
  const z = (await db.query(`
    select count(*)::int as zones,
           count(*) filter (where municipality is null)::int as muni_null
    from public.dispatch_zones where run_date = date '2026-07-20'`)).rows[0];
  ok('E. dispatch_zones が作られる（3ゾーン: A01×2 + B01×1）', z.zones === 3);
  ok('E. ★合格条件: municipality が全行 NULL でない', z.muni_null === 0);
  const muni = (await db.query(`
    select common_id, municipality from public.dispatch_zones
    where run_date = date '2026-07-20' order by common_id`)).rows;
  ok('E. 市名が正しい（GM2=安中市 / OKZ=岡崎市 / TYT=豊田市）',
     JSON.stringify(muni.map(r => r.municipality)) === JSON.stringify(['安中市', '岡崎市', '豊田市']));
  const a = (await db.query(`
    select driver_id, count(*)::int as n, max(assign_rank)::int as maxrank
    from public.dispatch_assignments where run_date = date '2026-07-20'
    group by driver_id order by driver_id`)).rows;
  ok('E. DRV001 に 8件（主担当5＋隣接積み増し3・rank3）',
     a.some(r => r.driver_id === 'DRV001' && r.n === 8 && r.maxrank === 3));
  ok('E. ドライバー不在の B01 は仮ドライバーに 2件',
     a.some(r => r.driver_id === '仮1' && r.n === 2));
}

// ---- F. delivery_status_public の属性・PII ------------------------------
console.log('F. delivery_status_public: PII・属性・anon');
{
  const j = (await db.query(`select public.delivery_status_public('R-1') as j`)).rows[0].j;
  ok('F. 返却キーが6つのまま（PIIキーが増えていない）',
     JSON.stringify(Object.keys(j).sort()) === JSON.stringify(
       ['delivery_date', 'delivery_order', 'municipality', 'status', 'time_window', 'tracking_number']));
  ok('F. status/時間帯/配達順が従来どおり返る',
     j.status === '配車済' && j.time_window === '午前中' && j.delivery_order === 12);
  const attr = (await db.query(`
    select prosecdef, provolatile, coalesce(array_to_string(proconfig, ','), '') as config
    from pg_proc where proname = 'delivery_status_public'`)).rows[0];
  ok('F. SECURITY DEFINER / stable / search_path=public が維持',
     attr.prosecdef === true && attr.provolatile === 's' && /search_path=public/.test(attr.config));
  const priv = (await db.query(
    `select has_function_privilege('anon', 'public.delivery_status_public(text)', 'execute') as p`)).rows[0];
  ok('F. anon が実行できる', priv.p === true);
  const none = (await db.query(`select public.delivery_status_public('NOTEXIST') as j`)).rows[0];
  ok('F. 存在しない問合番号は NULL（従来どおり）', none.j === null);
}

// ---- I. 冪等 -------------------------------------------------------------
console.log('I. 冪等（再実行）');
{
  const s1 = await prosrc('dispatch_build');
  await db.exec(MIGRATE);
  ok('I. 再実行しても prosrc が変わらない（エラーも出ない）',
     s1 === (await prosrc('dispatch_build')));
}
await db.close();

// ---- H. §0 ガード ---------------------------------------------------------
console.log('H. §0 ガード（③未完了＝旧語彙が残っていると中断）');
{
  const g = new PGlite();
  await g.exec(SCHEMA);
  await g.exec(SEED);
  await g.exec(origZoneRank); await g.exec(origDispatchBuild); await g.exec(origStatus);
  await g.exec(`insert into public.deliveries (tracking_number, delivery_date, common_id, office_code, status)
                values ('OLD-1','2026-06-17','C0001','A01','配車済');`);
  let raised = null;
  try { await g.exec(MIGRATE); } catch (e) { raised = e.message; }
  ok('H. 旧語彙が残っていると raise exception で中断', raised !== null);
  ok('H. エラーが③と recheck seq 6 を指示している',
     raised !== null && /③/.test(raised) && /seq 6/.test(raised));
  const n = (await g.query(`select count(*)::int as n from pg_proc pr
                            join pg_namespace ns on ns.oid = pr.pronamespace
                            where ns.nspname not in ('pg_catalog','information_schema')
                              and pr.prosrc ilike '%address_master%'`)).rows[0].n;
  ok('H. 中断時は関数が書き換えられていない（ガードは replace より前）', n === 3);
  await g.close();
}

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
