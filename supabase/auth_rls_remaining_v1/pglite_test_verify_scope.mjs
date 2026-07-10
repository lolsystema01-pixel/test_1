// pglite E2E: ③ verify_rls_scope_v0.sql の判定ロジック（§1 area 相当）
//   1. なりすましあり → 全行 judge=OK（範囲内>0 と 範囲外=0 が対で成立）
//   2. なりすまし無し（部分実行の再現）→ 先頭行 NG で「効いていない」と分かる
//   3. safe_count が GRANT無し(-1) / テーブル無し(-2) を捕捉し、クエリ全体を落とさない
//      （実機で area_master_staging が permission denied で落ちた事象の回帰テスト）
// 実行: node supabase/auth_rls_remaining_v1/pglite_test_verify_scope.mjs
import { PGlite } from '../../node_modules/@electric-sql/pglite/dist/index.js';

const db = new PGlite();
let pass = 0, fail = 0;
const ok = (n, c) => (c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.error(`  ✗ ${n}`)));

const AREA_IT = '00000000-0000-0000-0000-0000000000b1';

await db.exec(`
  create role authenticated;
  create schema auth;
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub','')::uuid $$;

  create table public.offices    (office_code text primary key, depot_code text);
  create table public.profiles   (user_id uuid primary key, role text, office_code text, depot_code text);
  create table public.deliveries (tracking_number text primary key, office_code text, driver_id text);
  create table public.drivers    (driver_id text primary key, office_code text);
  -- hq限定: RLSでhqのみ許可（GRANTはある）
  create table public.area_master (town_key text primary key);
  -- hq限定: GRANT自体が無い（実機の area_master_staging と同じ状況）
  create table public.area_master_staging (a text);

  insert into public.offices  values ('IT01','D_ITM'),('A01','D01');
  insert into public.profiles values ('${AREA_IT}','area','IT01',null);
  insert into public.deliveries values ('T-IT-1','IT01','ITD001'),('T-IT-2','IT01','ITD001'),('T-A01-1','A01','DRV001');
  insert into public.drivers    values ('ITD001','IT01'),('DRV001','A01');
  insert into public.area_master values ('兵庫県伊丹市A');
  insert into public.area_master_staging values ('x');

  create or replace function public.my_role() returns text language sql stable security definer set search_path=public as $$
    select role from public.profiles where user_id = auth.uid() $$;
  create or replace function public.my_office() returns text language sql stable security definer set search_path=public as $$
    select office_code from public.profiles where user_id = auth.uid() $$;

  alter table public.deliveries  enable row level security;
  alter table public.drivers     enable row level security;
  alter table public.offices     enable row level security;
  alter table public.profiles    enable row level security;
  alter table public.area_master enable row level security;
  alter table public.area_master_staging enable row level security;

  grant usage on schema auth, public to authenticated;
  grant execute on function auth.uid() to authenticated;
  grant select on public.deliveries, public.drivers, public.offices, public.profiles, public.area_master to authenticated;
  -- ★ area_master_staging には grant しない（実機と同じ）

  create policy d_area on public.deliveries for select to authenticated
    using ( public.my_role()='area' and office_code = public.my_office() );
  create policy dr_area on public.drivers for select to authenticated
    using ( public.my_role()='area' and office_code = public.my_office() );
  create policy o_area on public.offices for select to authenticated
    using ( public.my_role()='area' and office_code = public.my_office() );
  create policy p_self on public.profiles for select to authenticated
    using ( user_id = auth.uid() );
  create policy am_hq on public.area_master for select to authenticated
    using ( public.my_role()='hq' );
`);

const SAFE_COUNT = `
  create function pg_temp.safe_count(q text) returns bigint language plpgsql as $fn$
  declare n bigint;
  begin
    execute 'select count(*) from (' || q || ') _x' into n; return n;
  exception when insufficient_privilege then return -1; when undefined_table then return -2;
  end $fn$;`;

// verify_rls_scope_v0.sql §1 と同型の判定クエリ
const PROOF = `
select seq, check_name,
       case cnt when -1 then 'GRANT無し(アクセス不可)' when -2 then 'テーブル無し' else cnt::text end as cnt_disp,
       cnt, expect,
       case when (expect='=0' and cnt <= 0) or (expect='>0' and cnt > 0) then 'OK' else 'NG' end as judge,
       detail
from (values
  (0,'なりすまし確認（role=area）',
     (case when public.my_role()='area' and public.my_office() is not null then 1 else 0 end)::bigint,'>0',
     coalesce(public.my_role(),'(null)')||' / '||coalesce(public.my_office(),'(null)')),
  (1,'deliveries 範囲内', pg_temp.safe_count($q$select 1 from public.deliveries where office_code = public.my_office()$q$),'>0',null),
  (2,'deliveries 範囲外', pg_temp.safe_count($q$select 1 from public.deliveries where office_code is distinct from public.my_office()$q$),'=0',null),
  (3,'drivers 範囲内',    pg_temp.safe_count($q$select 1 from public.drivers where office_code = public.my_office()$q$),'>0',null),
  (4,'drivers 範囲外',    pg_temp.safe_count($q$select 1 from public.drivers where office_code is distinct from public.my_office()$q$),'=0',null),
  (6,'offices 範囲外',    pg_temp.safe_count($q$select 1 from public.offices where office_code is distinct from public.my_office()$q$),'=0',null),
  (10,'profiles 自分',    pg_temp.safe_count($q$select 1 from public.profiles where user_id = auth.uid()$q$),'>0',null),
  (11,'profiles 他人',    pg_temp.safe_count($q$select 1 from public.profiles where user_id <> auth.uid()$q$),'=0',null),
  (20,'hq限定 area_master（RLSで0件）',         pg_temp.safe_count($q$select 1 from public.area_master$q$),'=0',null),
  (21,'hq限定 area_master_staging（GRANT無し）',pg_temp.safe_count($q$select 1 from public.area_master_staging$q$),'=0',null),
  (22,'存在しない表（将来のdrop後）',           pg_temp.safe_count($q$select 1 from public.address_master$q$),'=0',null)
) as t(seq,check_name,cnt,expect,detail)
order by seq`;

const runBlock = async (impersonate) => {
  await db.exec('begin');
  await db.exec(SAFE_COUNT);
  if (impersonate) {
    await db.exec(`set local request.jwt.claims = '${JSON.stringify({ role: 'authenticated', sub: AREA_IT })}'`);
    await db.exec('set local role authenticated');
  }
  const rows = (await db.query(PROOF)).rows;
  await db.exec('rollback'); await db.exec('reset role');
  return rows;
};

// ── ケースA: なりすましあり ──
{
  const rows = await runBlock(true);
  const g = (s) => rows.find(r => r.seq === s);
  ok(`なりすまし確認行が OK（detail=${g(0).detail}）`, g(0).judge === 'OK' && g(0).detail === 'area / IT01');
  ok('全行 judge=OK（範囲内>0 と 範囲外=0 が対で成立）', rows.every(r => r.judge === 'OK'));
  ok('deliveries 範囲内=2 / 範囲外=0', Number(g(1).cnt) === 2 && Number(g(2).cnt) === 0);
  ok('profiles 他人=0', Number(g(11).cnt) === 0);
  ok('hq限定 area_master は RLS で 0件（judge=OK）', Number(g(20).cnt) === 0 && g(20).judge === 'OK');
  ok(`GRANT無しの表はクエリを落とさず -1 で合格（${g(21).cnt_disp}）`, Number(g(21).cnt) === -1 && g(21).judge === 'OK');
  ok(`存在しない表は -2 で合格（${g(22).cnt_disp}）`, Number(g(22).cnt) === -2 && g(22).judge === 'OK');
}

// ── ケースB: なりすましなし（部分実行の再現） ──
{
  const rows = await runBlock(false);
  const g = (s) => rows.find(r => r.seq === s);
  ok(`なりすまし無しだと先頭行が NG（detail=${g(0).detail}）`, g(0).judge === 'NG' && g(0).detail === '(null) / (null)');
  ok('なりすまし無しだと 範囲外>0 で誤りが見える（今回の事象を再現）', Number(g(2).cnt) > 0 && g(2).judge === 'NG');
  ok('なりすまし無しだと 範囲内=0（my_office()がNULL）', Number(g(1).cnt) === 0);
  ok('なりすまし無し（postgres）では GRANT無しの表も読めてしまう＝バイパスの証拠', Number(g(21).cnt) > 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
