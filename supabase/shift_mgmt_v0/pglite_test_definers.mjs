// pglite E2E: shift_mgmt v0.7 — 3書き込み口の認可・期間/二重・状態遷移・headcount・範囲外0件
//   固定の前提「SQLは人手でコピペ実行。渡す前に pglite で E2E 検証する」に基づく事前検証。
// 実行: node supabase/shift_mgmt_v0/pglite_test_definers.mjs
import { PGlite } from '../../node_modules/@electric-sql/pglite/dist/index.js';
import { readFileSync } from 'node:fs';

const EXT      = readFileSync(new URL('./work_schedules_ext_v0.sql', import.meta.url), 'utf8');
const DEFINERS = readFileSync(new URL('./shift_write_definers_v0.sql', import.meta.url), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c) => (c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.error(`  ✗ ${n}`)));
const one = async (db, q, p=[]) => (await db.query(q, p)).rows[0];

const db = new PGlite();
await db.exec(`create role authenticated;`);
await db.exec(`
  create table public.offices (office_code text primary key, request_period_days integer);
  create table public.drivers (driver_id text primary key, office_code text references public.offices(office_code));
  create table public.work_schedules (
    id bigint generated always as identity primary key,
    driver_id text not null references public.drivers(driver_id),
    work_date date not null, work_type text,
    application_status text not null default '申請中'
      check (application_status in ('申請中','承認','却下'))
  );
  create table public._who (role text, office text, driver text);
  insert into public._who values (null,null,null);
  create function public.my_role() returns text language sql stable as $$ select role from public._who limit 1 $$;
  create function public.my_office() returns text language sql stable as $$ select office from public._who limit 1 $$;
  create function public.my_driver() returns text language sql stable as $$ select driver from public._who limit 1 $$;
  create function public.my_office_drivers() returns setof text language sql stable as $$
    select driver_id from public.drivers where office_code = public.my_office() $$;

  insert into public.offices values ('A01',30),('C01',30);
  insert into public.drivers values ('DRV001','A01'),('DRV002','A01'),('DRV003','C01');
`);
await db.exec(EXT);
await db.exec(DEFINERS);
const as = (role, office, driver) =>
  db.query(`update public._who set role=$1, office=$2, driver=$3`, [role, office, driver]);
const call = async (fn, args) => {
  try { const r = (await db.query(`select public.${fn} as j`, [])).rows; return { ok:true }; }
  catch (e) { return { ok:false, msg:e.message }; }
};
const rpc = async (sql, params=[]) => {
  try { return { ok:true, row:(await db.query(sql, params)).rows[0] }; }
  catch (e) { return { ok:false, msg:e.message }; }
};

// ---- ④ write policy 無し ----
console.log('④ 書込は3関数のみ・write policy 無し');
{
  const r = await one(db, `select
    (select count(*)::int from pg_policies where schemaname='public' and tablename='work_schedules'
       and cmd in ('INSERT','UPDATE','DELETE','ALL')) as pol,
    (select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and p.proname in ('apply_shift','approve_reject_shift','office_direct_shift')
       and p.prosecdef) as fns`);
  ok('work_schedules に write policy 0本 / DEFINER書込関数 3本', r.pol === 0 && r.fns === 3);
}

// ---- ① apply_shift（driver本人・期間・二重・なりすまし） ----
console.log('① apply_shift');
{
  await as('driver', null, 'DRV001');
  let r = await rpc(`select public.apply_shift(current_date + 7, 'フル') as j`);
  ok('① driver本人が申請できる（申請中で登録）', r.ok && r.row.j.result === 'applied' && r.row.j.status === '申請中');

  r = await rpc(`select public.apply_shift(current_date + 7, 'フル') as j`);
  ok('① 同一 date/work_type の二重申請は already（増えない）', r.ok && r.row.j.result === 'already');

  r = await rpc(`select public.apply_shift(current_date + 60, 'フル') as j`);
  ok('① 期間外（30日超）は拒否', !r.ok && /申請可能期間外/.test(r.msg));

  r = await rpc(`select public.apply_shift(current_date - 1, 'フル') as j`);
  ok('① 過去日は拒否', !r.ok);

  // 希望エリア付き
  r = await rpc(`select public.apply_shift(current_date + 8, '6時間', array['OKZ_C_01_06','GM2_07_07']) as j`);
  ok('① 希望エリア(common_id[])付きで申請できる', r.ok && r.row.j.result === 'applied');
  ok('① preferred_areas が保存される',
     JSON.stringify((await one(db, `select preferred_areas from public.work_schedules where id=$1`, [r.row.j.id])).preferred_areas)
       === JSON.stringify(['OKZ_C_01_06','GM2_07_07']));

  // なりすまし防止: area/hq は driver でないので不可
  await as('area', 'A01', null);
  r = await rpc(`select public.apply_shift(current_date + 7, 'フル') as j`);
  ok('① area は apply_shift を使えない（driver本人のみ）', !r.ok && /本人のみ/.test(r.msg));
}

// ---- ② approve_reject_shift（area・配下のみ・遷移） ----
console.log('② approve_reject_shift');
{
  const applied = await one(db, `select id from public.work_schedules where driver_id='DRV001' and work_type='フル'`);
  await as('area', 'A01', null);
  let r = await rpc(`select public.approve_reject_shift($1,'承認') as j`, [applied.id]);
  ok('② area が配下(DRV001∈A01)の申請中を承認できる', r.ok && r.row.j.status === '承認');

  r = await rpc(`select public.approve_reject_shift($1,'承認') as j`, [applied.id]);
  ok('② 既に承認済みは再承認できない（申請中のみ）', !r.ok && /申請中の稼働予定のみ/.test(r.msg));

  r = await rpc(`select public.approve_reject_shift($1,'保留') as j`, [applied.id]);
  ok('② 承認/却下 以外の決定は拒否', !r.ok && /承認\/却下 のみ/.test(r.msg));

  // 他営業所の申請を C01 area が触れない（範囲外0件）
  await as('driver', null, 'DRV001'); await rpc(`select public.apply_shift(current_date + 9, '半日') as j`);
  const a01row = await one(db, `select id from public.work_schedules where driver_id='DRV001' and work_type='半日'`);
  await as('area', 'C01', null);   // C01 の area
  r = await rpc(`select public.approve_reject_shift($1,'承認') as j`, [a01row.id]);
  ok('② 他営業所(C01)の area は A01 配下の申請を承認できない（範囲外）', !r.ok && /配下ではありません/.test(r.msg));

  // driver は承認できない
  await as('driver', null, 'DRV001');
  r = await rpc(`select public.approve_reject_shift($1,'承認') as j`, [a01row.id]);
  ok('② driver は承認できない（areaのみ）', !r.ok && /営業所\(area\)のみ/.test(r.msg));
}

// ---- ③ office_direct_shift（area・配下のみ・承認で登録） ----
console.log('③ office_direct_shift');
{
  await as('area', 'A01', null);
  let r = await rpc(`select public.office_direct_shift('DRV002', current_date + 7, 'フル') as j`);
  ok('③ area が配下(DRV002∈A01)を承認状態で直接登録', r.ok && r.row.j.status === '承認');
  r = await rpc(`select public.office_direct_shift('DRV002', current_date + 7, 'フル') as j`);
  ok('③ 同一の二重登録は already', r.ok && r.row.j.result === 'already');
  // 配下外
  r = await rpc(`select public.office_direct_shift('DRV003', current_date + 7, 'フル') as j`);
  ok('③ 配下外(DRV003∈C01)は拒否（範囲外0件）', !r.ok && /配下ではありません/.test(r.msg));
}

// ---- ⑤ headcount（承認済みを営業所×日付で人数）＝配車入力 ----
console.log('⑤ headcount');
{
  // A01 の current_date+7: DRV001(フル承認)＋DRV002(フル承認・直接) の2人が承認済み
  const hc = await one(db, `
    select count(distinct ws.driver_id)::int as headcount
    from public.work_schedules ws
    join public.drivers d on d.driver_id = ws.driver_id
    where d.office_code = 'A01' and ws.work_date = current_date + 7 and ws.application_status = '承認'`);
  ok('⑤ A01/当日+7 の承認済み人数=2（DRV001実+DRV002直接）', hc.headcount === 2);
}

// ---- ⑥ レビュー対応: 1日1稼働の一意制約（配車全停止バグ・TOCTOU） ----
console.log('⑥ 1日1稼働 UNIQUE（レビューMED/HIGH）');
{
  ok('⑥ UNIQUE(driver_id, work_date) が張られている',
     (await one(db, `select count(*)::int n from pg_constraint where conname='work_schedules_driver_date_uq'`)).n === 1);

  // 同一driver・同一日に別work_typeの2承認を作ろうとしても、UNIQUE で2件目が作れない
  await as('driver', null, 'DRV003');   // C01のドライバー（未使用日で）
  const r1 = await rpc(`select public.apply_shift(current_date + 20, 'フル') as j`);
  const r2 = await rpc(`select public.apply_shift(current_date + 20, '6時間') as j`);
  ok('⑥ 同一(driver,date)の2件目 apply は already（別work_typeでも二重申請扱い＝1日1稼働）',
     r1.ok && r1.row.j.result === 'applied' && r2.ok && r2.row.j.result === 'already');
  const cnt = (await one(db, `select count(*)::int n from public.work_schedules where driver_id='DRV003' and work_date=current_date+20`)).n;
  ok('⑥ 同一(driver,date)は1行のみ（配車全停止バグの根を断つ）', cnt === 1);

  // TOCTOU: 直接INSERTで2行作ろうとしても UNIQUE が弾く
  let toctou = null;
  try { await db.exec(`insert into public.work_schedules(driver_id,work_date,work_type,application_status)
                       values('DRV003',current_date+21,'フル','申請中'),('DRV003',current_date+21,'2時間','申請中')`); }
  catch (e) { toctou = e.code; }
  ok('⑥ 直接INSERTの同日2行も UNIQUE(23505) で拒否（check-then-insert の TOCTOU を塞ぐ）', toctou === '23505');
}

// ---- ⑦ 却下後の再申請（レビューLOW） ----
console.log('⑦ 却下後の再申請');
{
  await as('driver', null, 'DRV002');
  const a = await rpc(`select public.apply_shift(current_date + 22, 'フル') as j`);
  const id = a.row.j.id;
  await as('area', 'A01', null);
  await rpc(`select public.approve_reject_shift($1,'却下') as j`, [id]);
  await as('driver', null, 'DRV002');
  const re = await rpc(`select public.apply_shift(current_date + 22, '6時間') as j`);
  ok('⑦ 却下後は本人が再申請できる（result=reapplied・申請中に戻る）',
     re.ok && re.row.j.result === 'reapplied' && re.row.j.status === '申請中');
  ok('⑦ 再申請で work_type も更新される',
     (await one(db, `select work_type from public.work_schedules where id=$1`, [id])).work_type === '6時間');
}

// ---- ⑧ office_direct_shift(NULL) は 22023 で弾く（レビューNIT） ----
console.log('⑧ office_direct_shift(NULL driver)');
{
  await as('area', 'A01', null);
  const r = await rpc(`select public.office_direct_shift(null, current_date + 23, 'フル') as j`);
  ok('⑧ driver_id=NULL は認可ゲート直後に 22023（下流NOT NULL頼みにしない）',
     !r.ok && /driver_id.*必須|ドライバーID.*必須/.test(r.msg));
}

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
await db.close();
process.exit(fail ? 1 : 0);
