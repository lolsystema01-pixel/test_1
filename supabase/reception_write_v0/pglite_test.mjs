// pglite E2E: number_bands + reception_requests + register_reception + get_reception_public
//   受付登録(N-4)のDB化 第1タスク。帯判定・照合あり/なし・二重受付・冪等・上書き履歴・D章バリデーション・anon実行可。
// 実行: node supabase/reception_write_v0/pglite_test.mjs
import { PGlite } from '../../node_modules/@electric-sql/pglite/dist/index.js';
import { readFileSync } from 'node:fs';

// 希望日はJSTの実時刻窓（昨日〜+90日）で検証されるため、固定日付はテストが暦で腐る。
// 実行日からの相対日付で組む（2026-07-23の9件落ちで実証済みの教訓）。
const jstDate = (plusDays) => new Date(Date.now() + 9 * 3600 * 1000 + plusDays * 86400000).toISOString().slice(0, 10);
const D1 = jstDate(1), D2 = jstDate(2), D3 = jstDate(3), D5 = jstDate(5), D6 = jstDate(6), D8 = jstDate(8), D10 = jstDate(10), D15 = jstDate(15);

const db = new PGlite();
let pass = 0, fail = 0;
const ok = (n, c) => (c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.error(`  ✗ ${n}`)));
async function throws(n, fn) {
  try { await fn(); fail++; console.error(`  ✗ ${n}（例外が出なかった）`); }
  catch { pass++; console.log(`  ✓ ${n}`); }
}

const HQ  = '00000000-0000-0000-0000-0000000000a1'; // hq
const A01 = '00000000-0000-0000-0000-0000000000a2'; // area A01
const DRV = '00000000-0000-0000-0000-0000000000a3'; // driver DRV001 (A01)
// Task 2（RLS検証）で追加した4ロール分のユーザー（伊丹デモ側 + 荷主2社）
const DEPOT_ITM = '00000000-0000-0000-0000-0000000000a4'; // depot D_ITM
const AREA_IT   = '00000000-0000-0000-0000-0000000000a5'; // area IT01
const DRV_IT    = '00000000-0000-0000-0000-0000000000a6'; // driver ITD001 (IT01)
const SHIP1     = '00000000-0000-0000-0000-0000000000a7'; // shipper SHIP01
const SHIP2     = '00000000-0000-0000-0000-0000000000a8'; // shipper SHIP02

// 呼び出しユーザーとして実行（auth.uid() は request.jwt.claims->>'sub'）。呼び出し内で結果を確定させ、最後にrollback。
async function asUser(uid, fn) {
  await db.exec('begin');
  await db.exec(`set local request.jwt.claims = '${JSON.stringify({ role: 'authenticated', sub: uid })}'`);
  await db.exec('set local role authenticated');
  try { return await fn(); }
  finally { await db.exec('rollback'); await db.exec('reset role'); }
}
// anonとして実行（sub無し＝auth.uid() は NULL）。
async function asAnon(fn) {
  await db.exec('begin');
  await db.exec(`set local request.jwt.claims = '${JSON.stringify({ role: 'anon' })}'`);
  await db.exec('set local role anon');
  try { return await fn(); }
  finally { await db.exec('rollback'); await db.exec('reset role'); }
}

// --- Supabase互換の最小スタブ（前提: auth.uid()・profiles 5ロール・offices・deliveries+5ロールselect＝rls_v0簡略再現）---
await db.exec(`
  create schema if not exists auth;
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub','')::uuid
  $$;
  create role authenticated;
  create role anon;
  grant usage on schema auth, public to authenticated, anon;
  grant execute on function auth.uid() to authenticated, anon;

  create table public.profiles (
    user_id uuid primary key, role text, depot_code text, office_code text, driver_id text, shipper_id text
  );
  create table public.offices (office_code text primary key, depot_code text);

  create or replace function public.my_role()   returns text language sql stable security definer set search_path=public as $$ select role        from public.profiles where user_id=auth.uid() $$;
  create or replace function public.my_office() returns text language sql stable security definer set search_path=public as $$ select office_code from public.profiles where user_id=auth.uid() $$;
  create or replace function public.my_depot()  returns text language sql stable security definer set search_path=public as $$ select depot_code  from public.profiles where user_id=auth.uid() $$;
  create or replace function public.my_driver() returns text language sql stable security definer set search_path=public as $$ select driver_id   from public.profiles where user_id=auth.uid() $$;
  create or replace function public.my_shipper() returns text language sql stable security definer set search_path=public as $$ select shipper_id from public.profiles where user_id=auth.uid() $$;
  create or replace function public.my_depot_offices() returns setof text language sql stable security definer set search_path=public as $$ select office_code from public.offices where depot_code=public.my_depot() $$;

  create table public.deliveries (
    tracking_number text primary key,
    office_code text, driver_id text, shipper_id text,
    status text not null default '未配車'
  );
  alter table public.deliveries enable row level security;
  grant select on public.deliveries to authenticated;
  create policy d_hq     on public.deliveries for select to authenticated using ( public.my_role()='hq' );
  create policy d_depot  on public.deliveries for select to authenticated using ( public.my_role()='depot'  and office_code in (select public.my_depot_offices()) );
  create policy d_area   on public.deliveries for select to authenticated using ( public.my_role()='area'   and office_code = public.my_office() );
  create policy d_driver on public.deliveries for select to authenticated using ( public.my_role()='driver' and driver_id  = public.my_driver() );
  create policy d_shipper on public.deliveries for select to authenticated using ( public.my_role()='shipper' and shipper_id = public.my_shipper() );

  insert into public.profiles (user_id, role, office_code, driver_id, shipper_id) values
    ('${HQ}','hq',null,null,null),
    ('${A01}','area','A01',null,null),
    ('${DRV}','driver',null,'DRV001',null);

  -- Task 2（RLS検証）: 不足ロールのプロフィール（depot/area IT01/driver ITD001/shipper×2）と営業所階層
  insert into public.offices (office_code, depot_code) values ('A01','D01'),('IT01','D_ITM');
  insert into public.profiles (user_id, role, depot_code, office_code, driver_id, shipper_id) values
    ('${DEPOT_ITM}','depot','D_ITM',null,null,null),
    ('${AREA_IT}','area',null,'IT01',null,null),
    ('${DRV_IT}','driver',null,null,'ITD001',null),
    ('${SHIP1}','shipper',null,null,null,'SHIP01'),
    ('${SHIP2}','shipper',null,null,null,'SHIP02');

  -- 出荷SQLが照合する実在荷物（demo9000帯・照合あり）
  insert into public.deliveries (tracking_number, office_code, status) values
    ('900000000001','A01','不在');
`);

// ── 出荷SQLをそのまま適用 ──
let applied = false;
try {
  await db.exec(readFileSync(new URL('./reception_write_v0.sql', import.meta.url), 'utf8'));
  applied = true;
} catch (e) {
  console.error('reception_write_v0.sql の適用に失敗:', e.message);
}
ok('reception_write_v0.sql が適用できる', applied);

const reg = (args) => db.query(
  `select public.register_reception($1,$2,$3,$4,$5,$6,$7,$8,$9) r`,
  args.length === 9 ? args : [...args, null] // 第9引数 p_memo（省略時null＝既存テスト非破壊）
).then((res) => res.rows[0].r);
const countActive = async (tn) => Number(
  (await db.query(`select count(*)::int n from public.reception_requests where tracking_number=$1 and status='受付済'`, [tn])).rows[0].n
);
const countAll = async (tn) => Number(
  (await db.query(`select count(*)::int n from public.reception_requests where tracking_number=$1`, [tn])).rows[0].n
);

console.log('\n[2) 帯判定（最長prefix優先。register_receptionと同一ロジックを直接照会・副作用なし）]');
{
  const matchBand = async (tn) => {
    const rows = (await db.query(
      `select band_key, verify_on_reception from public.number_bands
       where enabled and $1 like prefix || '%'
         and (digits is null or substring($1 from char_length(prefix)+1) ~ ('^[0-9]{'||digits||'}$'))
       order by char_length(prefix) desc limit 1`, [tn]
    )).rows;
    return rows[0] ?? null;
  };
  const cases = [
    ['900000000001', 'demo9000', true],
    ['REQ-00099', 'req', true],
    ['DSP-OKZ_C_01_08-0001', 'dsp', true],
    ['KAZ26181000520', 'kaz', false],
    ['A12345', 'a', false],
    ['4001234567', 'four', false],
  ];
  for (const [tn, band, verify] of cases) {
    const m = await matchBand(tn);
    ok(`${tn} → band=${band}/verify=${verify}`, m?.band_key === band && m?.verify_on_reception === verify);
  }
  const none = await matchBand('ZZZ999');
  ok("ZZZ999 → どの帯にも不一致", none === null);
}

console.log('\n[3) 照合あり帯・deliveries不在 → not_found（行は増えない）]');
{
  const r = await reg(['900000009999', '再配達', D1, '午前', null, 'web', null, false]);
  ok("900000009999(demo9000だがdeliveries不在) → result=not_found", r.result === 'not_found');
  ok('not_foundで行は増えない（0行）', (await countAll('900000009999')) === 0);
}

console.log('\n[4) 照合あり帯・deliveries実在 → created（receipt_noはR-始まり・verified=true）]');
let receiptV1;
{
  const r = await reg(['900000000001', '再配達', D1, '午前', null, 'web', null, false]);
  ok('900000000001 → result=created', r.result === 'created');
  ok("receipt_no が 'R-' で始まる", typeof r.receipt_no === 'string' && r.receipt_no.startsWith('R-'));
  ok('verified=true', r.verified === true);
  ok('band_key=demo9000', r.band_key === 'demo9000');
  receiptV1 = r.receipt_no;
}

console.log('\n[5) 二重受付：同番号・overwrite=false → duplicate（existing_receipt_no=初回の値・行は増えない）]');
{
  const r = await reg(['900000000001', '再配達', D2, '午前', null, 'web', null, false]);
  ok('result=duplicate', r.result === 'duplicate');
  ok('existing_receipt_no=初回の受付番号', r.existing_receipt_no === receiptV1);
  ok('duplicateで行は増えない（activeは1行のまま）', (await countActive('900000000001')) === 1);
}

console.log('\n[6) 冪等：同一内容・overwrite=true → unchanged（行は増えない）]');
{
  const r = await reg(['900000000001', '再配達', D1, '午前', null, 'web', null, true]);
  ok('result=unchanged', r.result === 'unchanged');
  ok('unchangedで行は増えない（totalは1行のまま）', (await countAll('900000000001')) === 1);
  ok('receipt_noは維持される（初回のまま）', r.receipt_no === receiptV1);
}

console.log('\n[7) 上書き：内容を変えてoverwrite=true → overwritten（旧行=取消・新行=受付済・計2行）]');
let receiptV2;
{
  const r = await reg(['900000000001', '時間変更', D3, '18-20', null, 'web', null, true]);
  ok('result=overwritten', r.result === 'overwritten');
  ok('existing_receipt_no=旧受付番号', r.existing_receipt_no === receiptV1);
  ok("新receipt_noは旧と異なる（'R-'始まり）", r.receipt_no !== receiptV1 && r.receipt_no.startsWith('R-'));
  receiptV2 = r.receipt_no;
  const rows = (await db.query(`select receipt_no, status from public.reception_requests where tracking_number='900000000001' order by created_at`)).rows;
  ok('計2行（旧+新）', rows.length === 2);
  ok('旧行 status=取消', rows.find((x) => x.receipt_no === receiptV1)?.status === '取消');
  ok('新行 status=受付済', rows.find((x) => x.receipt_no === receiptV2)?.status === '受付済');
}

console.log('\n[8) 照合なし帯：KAZ帯 → created・verified=false（deliveries不在でも登録できる）]');
{
  const r = await reg(['KAZ26181000520', '再配達', D5, '午前', null, 'web', null, false]);
  ok('KAZ26181000520 → result=created', r.result === 'created');
  ok('verified=false（照合なし帯）', r.verified === false);
  ok('band_key=kaz', r.band_key === 'kaz');
}

console.log('\n[9) 形式不一致：ZZZ999 → format_error]');
{
  const r = await reg(['ZZZ999', '置き配', null, null, '玄関前', 'web', null, false]);
  ok('ZZZ999 → result=format_error', r.result === 'format_error');
  ok('format_errorはband_key=null', r.band_key === null);
}

console.log('\n[10) 種別バリデーション（D章相当）：再配達でdesired_date未指定 → 例外]');
await throws('再配達なのにdesired_date=null → 例外', () =>
  reg(['900000000001', '再配達', null, '午前', null, 'web', null, true])
);
await throws('置き配なのにdrop_place=null → 例外', () =>
  reg(['KAZ99999999999', '置き配', null, null, null, 'web', null, false])
);
await throws('不正な受付種別 → 例外', () =>
  reg(['KAZ99999999999', '不明種別', null, null, null, 'web', null, false])
);

console.log('\n[11) anonからregister_reception実行可（grant確認）・get_reception_publicは非PIIサマリを返す]');
await asAnon(async () => {
  const r = await reg(['4009999999', '置き配', null, null, '宅配ボックス', 'web', null, false]);
  ok('anonでもregister_receptionを実行できる（grant済み）', r.result === 'created' && r.band_key === 'four');
  // reception_requestsへのSELECTはanonに与えていない仕様のため、確認は role をリセットして行う（同一トランザクション内・rollback前）。
  await db.exec('reset role');
  const row = (await db.query(`select created_by from public.reception_requests where tracking_number='4009999999'`)).rows[0];
  ok('anon実行時 created_by は NULL（auth.uid()なし）', row.created_by === null);
});
await asAnon(async () => {
  const pub = (await db.query(`select public.get_reception_public($1) p`, ['900000000001'])).rows[0].p;
  ok('get_reception_publicがanonから呼べ、活性受付の非PIIサマリを返す', pub !== null && pub.receipt_no === receiptV2);
  ok('type/desired_date/time_slot/statusが上書き後の値と一致', pub.type === '時間変更' && pub.time_slot === '18-20' && pub.status === '受付済');
  ok('caller_phone・created_byはキーに含まれない（非PII源流強制）', !('caller_phone' in pub) && !('created_by' in pub));
});
{
  const none = (await db.query(`select public.get_reception_public($1) p`, ['NOTREGISTERED'])).rows[0].p;
  ok('未登録の問合番号はNULL', none === null);
}

console.log('\n[12) unchanged判定はchannel/caller_phoneを含めない（受付内容3項目のみ）]');
{
  // 既存の活性受付: 900000000001 時間変更 D3 18-20 channel=web caller_phone=null
  // 同じ内容だがchannelのみ異なる → unchanged・channelは元のまま・行数増えず
  const rBefore = await reg(['900000000001', '時間変更', D3, '18-20', null, 'web', null, true]);
  const rowBefore = (await db.query(`select channel, caller_phone from public.reception_requests where receipt_no=$1`, [rBefore.receipt_no])).rows[0];
  const r = await reg(['900000000001', '時間変更', D3, '18-20', null, 'phone', '09012345678', true]);
  ok('同一内容でchannel/caller_phoneのみ異なる → result=unchanged', r.result === 'unchanged');
  ok('unchangedで行は増えない（totalは2行のまま）', (await countAll('900000000001')) === 2);
  const rowAfter = (await db.query(`select channel, caller_phone from public.reception_requests where receipt_no=$1`, [r.receipt_no])).rows[0];
  ok('保存済みのchannelは変わらない（元の値のまま）', rowAfter.channel === rowBefore.channel);
  ok('保存済みのcaller_phoneも変わらない（元の値のまま）', rowAfter.caller_phone === rowBefore.caller_phone);
}

console.log('\n[13) DB層の不変条件：同一問合番号の活性受付は2行作れない]');
{
  // 新しい番号で1行作る
  const r1 = await reg(['KAZ87654321098', '再配達', D5, '午前', null, 'web', null, false]);
  ok('KAZ87654321098を新規登録 → created', r1.result === 'created');
  ok('活性受付は1行', (await countActive('KAZ87654321098')) === 1);

  // postgres権限で素のINSERTを試みる → unique violationで失敗すること
  let uniqueViolation = false;
  try {
    await db.exec(`
      insert into public.reception_requests
        (receipt_no, tracking_number, band_key, verified, reception_type, desired_date, time_slot, drop_place, channel, status)
      values
        ('R-999999-9999', 'KAZ87654321098', 'kaz', false, '再配達', '${D6}', '午前', null, 'web', '受付済')
    `);
  } catch (e) {
    if (e.message.includes('unique') || e.message.includes('duplicate')) {
      uniqueViolation = true;
    }
  }
  ok('素のINSERTで同一番号の活性受付2本目を挿入 → unique violationで失敗', uniqueViolation);
}

// =============================================================
// Task 2: RLS検証（5ロール・範囲外0件）— ブリーフ観点12〜17
//   select policy = 「hq or deliveriesに同じtracking_numberが見える」＝deliveries RLS継承。
//   「範囲外0件」は必ず「範囲内>0」と対でassertする（全部塞がっている場合と区別するため）。
// =============================================================

console.log('\n[14) RLSデータ準備: IT01の荷物（driver=ITD001/shipper=SHIP01）＋照合済み受付・KAZ未照合受付]');
let rlsReady = false;
{
  // IT01の荷物（req帯・照合あり）。既存データはA01側（900000000001）とhqのみ可視の未照合KAZ群。
  await db.exec(`
    insert into public.deliveries (tracking_number, office_code, driver_id, shipper_id, status) values
      ('REQ-IT0001','IT01','ITD001','SHIP01','配送中');
  `);
  const rIt  = await reg(['REQ-IT0001', '再配達', D8, '午前', null, 'web', null, false]);
  const rKaz = await reg(['KAZ11122233344', '置き配', null, null, '玄関前', 'web', null, false]);
  ok('IT01荷物の照合済み受付を登録（created・verified=true）', rIt.result === 'created' && rIt.verified === true);
  ok('KAZ帯の未照合受付を登録（created・verified=false・deliveriesに親なし）', rKaz.result === 'created' && rKaz.verified === false);
  rlsReady = rIt.result === 'created' && rKaz.result === 'created';
}

console.log('\n[15) RLS 5ロール可視範囲（観点12〜15）: 各ロールで it=REQ-IT0001 / kaz=未照合 / a01=900000000001 の件数]');
if (rlsReady) {
  // 各ユーザーになりすまして3つの問合番号の受付件数を数える（a01は取消+受付済の履歴2行が母数）
  const scopeCounts = (uid) => asUser(uid, async () => {
    const q = async (tn) => Number(
      (await db.query(`select count(*)::int n from public.reception_requests where tracking_number=$1`, [tn])).rows[0].n
    );
    return { it: await q('REQ-IT0001'), kaz: await q('KAZ11122233344'), a01: await q('900000000001') };
  });

  // 観点12) hq: 照合済み＋未照合の計2件が見える
  const hq = await scopeCounts(HQ);
  ok('hq: 照合済み受付(REQ-IT0001)=1件', hq.it === 1);
  ok('hq: 未照合受付(KAZ)=1件（照合済み＋未照合の計2件が見える）', hq.kaz === 1 && hq.it + hq.kaz === 2);

  // 観点13) area/IT01: 自営業所の荷物の受付のみ。未照合はhq以外0件
  const itArea = await scopeCounts(AREA_IT);
  ok('area/IT01: 自営業所の荷物の受付=1件（範囲内>0）', itArea.it === 1);
  ok('area/IT01: KAZ未照合=0件（deliveriesに親なし＝hqのみ可視）', itArea.kaz === 0);
  ok('area/IT01: 他営業所(A01)の受付=0件（範囲外0件）', itArea.a01 === 0);

  // 観点14) area/A01: IT01・KAZは0件。対の範囲内>0は自営業所の900000000001
  const a01Area = await scopeCounts(A01);
  ok('area/A01: 自営業所(900000000001)の受付>0（範囲内>0の対）', a01Area.a01 > 0);
  ok('area/A01: IT01の受付=0件・KAZ未照合=0件（範囲外0件）', a01Area.it === 0 && a01Area.kaz === 0);

  // 観点15) driver: 自担当荷物の受付のみ（担当外0件）
  const drvIt = await scopeCounts(DRV_IT);
  ok('driver/ITD001: 自担当荷物の受付=1件（範囲内>0）', drvIt.it === 1);
  ok('driver/ITD001: 担当外(900000000001はdriver無し)=0件・KAZ未照合=0件', drvIt.a01 === 0 && drvIt.kaz === 0);
  const drvA01 = await scopeCounts(DRV);
  ok('driver/DRV001: 担当外(IT01)の受付=0件・KAZ未照合=0件（範囲外0件）', drvA01.it === 0 && drvA01.kaz === 0);

  // 観点15) shipper: 自荷主のみ（他荷主0件）
  const ship1 = await scopeCounts(SHIP1);
  ok('shipper/SHIP01: 自荷主の荷物の受付=1件（範囲内>0）', ship1.it === 1);
  ok('shipper/SHIP01: 荷主外(900000000001はshipper無し)=0件・KAZ未照合=0件', ship1.a01 === 0 && ship1.kaz === 0);
  const ship2 = await scopeCounts(SHIP2);
  ok('shipper/SHIP02: 他荷主(SHIP01)の受付=0件・KAZ未照合=0件（範囲外0件）', ship2.it === 0 && ship2.kaz === 0);

  // 5ロール目) depot/D_ITM: 配下営業所(IT01)のみ
  const depot = await scopeCounts(DEPOT_ITM);
  ok('depot/D_ITM: 配下営業所(IT01)の受付=1件（範囲内>0）', depot.it === 1);
  ok('depot/D_ITM: 配下外(A01)=0件・KAZ未照合=0件（範囲外0件）', depot.a01 === 0 && depot.kaz === 0);
} else {
  ok('RLSデータ準備に失敗したため5ロール検証を実行できない', false);
}

console.log('\n[16) RLS anon（観点16）: reception_requestsへのselect grantが無い]');
{
  // pg_catalogでgrantの有無を確認（authenticatedにはある＝対の確認）
  const g = (await db.query(`
    select has_table_privilege('anon','public.reception_requests','select') as anon_sel,
           has_table_privilege('authenticated','public.reception_requests','select') as auth_sel
  `)).rows[0];
  ok('anonにselect grantが無い（pg_catalog: has_table_privilege=false）', g.anon_sel === false);
  ok('authenticatedにはselect grantがある（対の確認）', g.auth_sel === true);

  // 実行時にも permission denied で弾かれる（safe_count的に捕捉して-1扱い）
  const n = await asAnon(async () => {
    try {
      return Number((await db.query(`select count(*)::int n from public.reception_requests`)).rows[0].n);
    } catch (e) {
      return /permission denied|insufficient_privilege/i.test(e.message) ? -1 : -999;
    }
  });
  ok('anonの直接selectはpermission denied（safe_count=-1扱い）', n === -1);
}

console.log('\n[補足: write policyは置かない（規約どおり）＝観点17]');
{
  const n = (await db.query(
    `select count(*)::int n from pg_policies where schemaname='public' and tablename='reception_requests' and cmd <> 'SELECT'`
  )).rows[0].n;
  ok('reception_requests に SELECT以外のポリシーは0本', n === 0);
  const nb = (await db.query(
    `select count(*)::int n from pg_policies where schemaname='public' and tablename='number_bands' and cmd <> 'SELECT'`
  )).rows[0].n;
  ok('number_bands にも SELECT以外のポリシーは0本', nb === 0);
}

// =============================================================
// Task 3: seed_reception_write_v0.sql の構文保証（SQL Editor用ファイルをそのまま流して検証）
//   check_reception_write_v0.sql の①件数突合・③上書き履歴に相当する「期待件数になっているか」を
//   pgliteで検証する（seed全文がエラーなく流れること＝構文保証が主目的）。
//   ⑤なりすましRLS・⑥write policy・⑦anon実在番号は check_reception_write_v0.sql 側でカバー
//   （UUIDプレースホルダ '<...>' の実行時置換・anonの実grant確認はSupabase専用のためpglite対象外。
//    なお⑥「write policy 0本」の判定ロジック自体は上の[16]で既にpglite検証済み）。
// =============================================================

console.log('\n[17) seed_reception_write_v0.sql が構文エラーなく流れ、期待件数になる]');
{
  const applySeed = async () => {
    try {
      await db.exec(readFileSync(new URL('./seed_reception_write_v0.sql', import.meta.url), 'utf8'));
      return true;
    } catch (e) {
      console.error('seed_reception_write_v0.sql の適用に失敗:', e.message);
      return false;
    }
  };

  const seedApplied = await applySeed();
  ok('seed_reception_write_v0.sql が適用できる', seedApplied);

  if (seedApplied) {
    // ①-a: 検証deliveriesの帰属（900000099002がdriver=DRV001/shipper=SHIP02＝追加要件の対）
    const d1 = (await db.query(`select office_code, driver_id, shipper_id from public.deliveries where tracking_number='900000099001'`)).rows[0];
    ok('900000099001: office=A01/driver=DRV001/shipper=SHIP01', d1?.office_code === 'A01' && d1?.driver_id === 'DRV001' && d1?.shipper_id === 'SHIP01');
    const d2 = (await db.query(`select office_code, driver_id, shipper_id from public.deliveries where tracking_number='900000099002'`)).rows[0];
    ok('900000099002: office=A01/driver=DRV001/shipper=SHIP02（追加要件の対）', d2?.office_code === 'A01' && d2?.driver_id === 'DRV001' && d2?.shipper_id === 'SHIP02');
    const d3 = (await db.query(`select office_code from public.deliveries where tracking_number='900000099999'`)).rows[0];
    ok('900000099999: ⑦anon検証専用の実在deliveryも作られる（受付は未登録）', d3?.office_code === 'A01');

    // ①-b: 件数突合（tracking_number別）
    const rows1 = (await db.query(`select status, band_key, verified from public.reception_requests where tracking_number='900000099001'`)).rows;
    ok('900000099001: 計1行・受付済・verified=true・band=demo9000', rows1.length === 1 && rows1[0].status === '受付済' && rows1[0].verified === true && rows1[0].band_key === 'demo9000');

    const rows2 = (await db.query(`select status, reception_type from public.reception_requests where tracking_number='900000099002' order by created_at`)).rows;
    ok('900000099002: 計2行（上書き履歴）', rows2.length === 2);
    ok('900000099002: 旧行=取消(置き配)・新行=受付済(時間変更)',
      rows2[0]?.status === '取消' && rows2[0]?.reception_type === '置き配' &&
      rows2[1]?.status === '受付済' && rows2[1]?.reception_type === '時間変更');

    const rowsK = (await db.query(`select status, band_key, verified from public.reception_requests where tracking_number='KAZ900000099099'`)).rows;
    ok('KAZ900000099099: 計1行・受付済・verified=false・band=kaz', rowsK.length === 1 && rowsK[0].status === '受付済' && rowsK[0].verified === false && rowsK[0].band_key === 'kaz');

    // ①-c: 合計（3件のtracking_numberで計4行・アクティブ3行）
    const totalRows = Number((await db.query(
      `select count(*)::int n from public.reception_requests where tracking_number in ('900000099001','900000099002','KAZ900000099099')`
    )).rows[0].n);
    const activeRows = Number((await db.query(
      `select count(*)::int n from public.reception_requests where tracking_number in ('900000099001','900000099002','KAZ900000099099') and status='受付済'`
    )).rows[0].n);
    ok('合計4行・アクティブ3行', totalRows === 4 && activeRows === 3);

    // 冪等性: 同じseedをもう一度流してもエラーにならず、行数が増えない
    const seedAppliedAgain = await applySeed();
    ok('seed_reception_write_v0.sql は再実行してもエラーにならない（冪等）', seedAppliedAgain);
    const totalRowsAgain = Number((await db.query(
      `select count(*)::int n from public.reception_requests where tracking_number in ('900000099001','900000099002','KAZ900000099099')`
    )).rows[0].n);
    ok('再実行しても行数が増えない（冪等）', totalRowsAgain === 4);

    // --- 回帰テスト（レビュー指摘1）: delivery_index/delivery_status_log（cascade無しFK）に
    //     900000099001の子行があってもseed再実行がFK衝突しないこと（子→親の順で削除する冪等クリーンの実証）。
    //     実DBのスキーマ（dbschema_v0/status_log_v0）相当の最小スタブをここで作る（他の既存テストへの影響を避けるため
    //     この直前まではdelivery_index/delivery_status_logは作らない）。
    await db.exec(`
      create table public.delivery_status_log (
        id bigint generated always as identity primary key,
        tracking_number text not null references public.deliveries(tracking_number)
      );
      create table public.delivery_index (
        tracking_number text primary key references public.deliveries(tracking_number)
      );
      insert into public.delivery_status_log (tracking_number) values ('900000099001');
      insert into public.delivery_index (tracking_number) values ('900000099001');
    `);

    const seedAppliedWithChildren = await applySeed();
    ok('delivery_status_log/delivery_indexに900000099001の子行があってもseed再実行はエラーにならない（子→親の順で削除）', seedAppliedWithChildren);
    const totalRowsWithChildren = Number((await db.query(
      `select count(*)::int n from public.reception_requests where tracking_number in ('900000099001','900000099002','KAZ900000099099')`
    )).rows[0].n);
    ok('子テーブルに行があっても再実行後の件数は不変（クリーン順序の実証）', totalRowsWithChildren === 4);
  } else {
    ok('seed適用失敗のため以降の件数assertを実行できない', false);
  }
}

console.log('\n[18) number_bands の lookup_enabled 初期値を1クエリでassert（demo9000/req/dsp=true・kaz/a/four=false）]');
{
  const rows = (await db.query(`select band_key, lookup_enabled from public.number_bands order by band_key`)).rows;
  const expect = { a: false, demo9000: true, dsp: true, four: false, kaz: false, req: true };
  const actual = Object.fromEntries(rows.map((r) => [r.band_key, r.lookup_enabled]));
  ok(
    'number_bands lookup_enabled 初期値: demo9000/req/dsp=true・kaz/a/four=false',
    Object.keys(expect).length === Object.keys(actual).length
      && Object.entries(expect).every(([k, v]) => actual[k] === v)
  );
}

console.log('\n[19) 二重受付（seed済み番号）: 900000099001に同一内容でregister_reception(overwrite=false) → duplicate]');
{
  const r = await reg(['900000099001', '再配達', D10, '午前', null, 'web', null, false]);
  ok('900000099001（seed済み・同一内容）→ result=duplicate', r.result === 'duplicate');
}

console.log('\n[20) I2: 入力上限バリデーション（超過→format_error・境界値ちょうどはcreated＝off-by-oneでない確認）]');
{
  const longTn = 'KAZ' + '9'.repeat(40); // 43文字 > 32
  const r1 = await reg([longTn, '置き配', null, null, '玄関前', 'web', null, false]);
  ok('tracking_number 32文字超 → result=format_error', r1.result === 'format_error');

  const r2 = await reg(['KAZ10000000001', '置き配', null, null, 'x'.repeat(101), 'web', null, false]);
  ok('drop_place 101文字 → result=format_error', r2.result === 'format_error');

  const farDate = new Date(Date.now() + 200 * 86400000).toISOString().slice(0, 10);
  const r3 = await reg(['KAZ10000000002', '再配達', farDate, '午前', null, 'web', null, false]);
  ok('desired_date が現在+200日 → result=format_error', r3.result === 'format_error');

  const r4 = await reg(['KAZ10000000003', '置き配', null, null, 'x'.repeat(100), 'web', null, false]);
  ok('drop_place ちょうど100文字 → result=created（100文字は上限内。off-by-oneでないことの確認）', r4.result === 'created');
}

console.log('\n[21) C1修正: 採番のlpad切り詰め回避（seq 10000超えでもreceipt_noが衝突しない）]');
{
  // このassertはpublic.reception_receipt_seqを10000超えまで進める（順方向のみ・巻き戻さない）。
  // receipt_noは常にこのassert以前より大きい番号になるため、以前のtestで作った行と衝突しない。
  // 以降に採番へ依存するtestは無い（テストスイート末尾に配置＝順序安全）。
  await db.exec(`
    insert into public.deliveries (tracking_number, office_code, status) values
      ('900000010001', 'A01', '未配車'),
      ('900000010002', 'A01', '未配車');
  `);
  await db.exec(`select setval('public.reception_receipt_seq', 10000, false)`);

  const r1 = await reg(['900000010001', '再配達', D15, '午前', null, 'web', null, false]);
  const r2 = await reg(['900000010002', '再配達', D15, '午前', null, 'web', null, false]);

  ok('seq=10000到達後の1件目 → result=created', r1.result === 'created');
  ok('seq=10000到達後の2件目 → result=created', r2.result === 'created');
  ok('1件目のreceipt_noは...-10000（lpadで4桁に切り詰められていない）', /^R-\d{6}-10000$/.test(r1.receipt_no));
  ok('2件目のreceipt_noは...-10001（連番として区別できる）', /^R-\d{6}-10001$/.test(r2.receipt_no));
  ok('両者のreceipt_noは重複しない（distinct・PK違反にならない）', r1.receipt_no !== r2.receipt_no);
}

console.log('\n[22) M3: authenticated役でのreception_requestsへの直接INSERTは拒否される（write policy 0本＋INSERT GRANT無し）]');
await asUser(A01, async () => {
  let denied = false;
  try {
    await db.exec(`
      insert into public.reception_requests
        (receipt_no, tracking_number, band_key, verified, reception_type, desired_date, time_slot, drop_place, channel, status)
      values
        ('R-999999-9997', 'RLSDENYTEST0001', 'kaz', false, '再配達', '${D6}', '午前', null, 'web', '受付済')
    `);
  } catch (e) {
    denied = /permission denied|row-level security|insufficient_privilege/i.test(e.message);
  }
  ok('authenticated役の直接INSERTは拒否される（記録口関数経由のみ＝default-denyの直接証明）', denied);
});

console.log('\n[18) memo保存（v0.2・LOL指摘）：保存・上限・上書き履歴・非PII照会に出ない]');
{
  const r1 = await reg(['KAZMEMO0000001', '再配達', D5, '午前', null, 'web', null, false, '玄関前に置く場合はチャイム不要']);
  ok('memo付きで created', r1.result === 'created');
  const row1 = (await db.query(`select memo from public.reception_requests where receipt_no=$1`, [r1.receipt_no])).rows[0];
  ok('memoが行に保存される', row1.memo === '玄関前に置く場合はチャイム不要');

  const rLong = await reg(['KAZMEMO0000002', '再配達', D5, '午前', null, 'web', null, false, 'あ'.repeat(501)]);
  ok('memo 501文字 → format_error', rLong.result === 'format_error');
  const rMax = await reg(['KAZMEMO0000002', '再配達', D5, '午前', null, 'web', null, false, 'あ'.repeat(500)]);
  ok('memo 500文字ちょうど → created（境界OK）', rMax.result === 'created');

  const rSame = await reg(['KAZMEMO0000001', '再配達', D5, '午前', null, 'web', null, true, '玄関前に置く場合はチャイム不要']);
  ok('memo含め同一内容 overwrite=true → unchanged', rSame.result === 'unchanged');
  const rMemoChg = await reg(['KAZMEMO0000001', '再配達', D5, '午前', null, 'web', null, true, '置き場所変更：物置の中へ']);
  ok('memoだけ変更 overwrite=true → overwritten（履歴が残る）', rMemoChg.result === 'overwritten');
  const rows = (await db.query(`select status, memo from public.reception_requests where tracking_number=$1 order by created_at`, ['KAZMEMO0000001'])).rows;
  ok('旧行=取消・新行=受付済の2行', rows.length === 2 && rows[0].status === '取消' && rows[1].status === '受付済');
  ok('新行のmemoが更新後の値', rows[1].memo === '置き場所変更：物置の中へ');

  const pub = (await db.query(`select public.get_reception_public($1) p`, ['KAZMEMO0000001'])).rows[0].p;
  ok('★get_reception_public に memo キーが無い（自由記入=PII混入がありうるため源流で遮断）', pub !== null && !('memo' in pub));
}

console.log(`\nreception_write pglite: ${pass} passed, ${fail} failed`);
await db.close();
if (fail > 0) process.exit(1);
