// pglite E2E: ③ verify_rls_scope_v0.sql の §1(area) ブロックが
//   ・なりすましが効いた状態 → 全行 judge=OK
//   ・なりすましを外した状態（部分実行の再現）→ 先頭行が NG になり「効いていない」と分かる
// ことを実証する。判定ロジックそのものの回帰テスト。
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

  insert into public.offices  values ('IT01','D_ITM'),('A01','D01');
  insert into public.profiles values ('${AREA_IT}','area','IT01',null);
  insert into public.deliveries values ('T-IT-1','IT01','ITD001'),('T-IT-2','IT01','ITD001'),('T-A01-1','A01','DRV001');
  insert into public.drivers    values ('ITD001','IT01'),('DRV001','A01');

  create or replace function public.my_role() returns text language sql stable security definer set search_path=public as $$
    select role from public.profiles where user_id = auth.uid() $$;
  create or replace function public.my_office() returns text language sql stable security definer set search_path=public as $$
    select office_code from public.profiles where user_id = auth.uid() $$;

  alter table public.deliveries enable row level security;
  alter table public.drivers    enable row level security;
  alter table public.offices    enable row level security;
  alter table public.profiles   enable row level security;
  grant select on public.deliveries, public.drivers, public.offices, public.profiles to authenticated;

  create policy d_area on public.deliveries for select to authenticated
    using ( public.my_role()='area' and office_code = public.my_office() );
  create policy dr_area on public.drivers for select to authenticated
    using ( public.my_role()='area' and office_code = public.my_office() );
  create policy o_area on public.offices for select to authenticated
    using ( public.my_role()='area' and office_code = public.my_office() );
  create policy p_self on public.profiles for select to authenticated
    using ( user_id = auth.uid() );

  -- 本番Supabaseでは付与済み（authenticated が auth.uid() を呼べる）
  grant usage on schema auth, public to authenticated;
  grant execute on function auth.uid() to authenticated;
`);

// verify_rls_scope_v0.sql §1 と同型の判定クエリ（対象テーブルは本テストのスタブ分だけ）
const PROOF = `
select seq, check_name, cnt, expect,
       case when (expect='=0' and cnt=0) or (expect='>0' and cnt>0) then 'OK' else 'NG' end as judge,
       detail
from (values
  (0,'なりすまし確認（role=area）',
     (case when public.my_role()='area' and public.my_office() is not null then 1 else 0 end)::bigint,'>0',
     coalesce(public.my_role(),'(null)')||' / '||coalesce(public.my_office(),'(null)')),
  (1,'deliveries 範囲内',(select count(*) from public.deliveries where office_code = public.my_office()),'>0',null),
  (2,'deliveries 範囲外',(select count(*) from public.deliveries where office_code is distinct from public.my_office()),'=0',null),
  (3,'drivers 範囲内',   (select count(*) from public.drivers    where office_code = public.my_office()),'>0',null),
  (4,'drivers 範囲外',   (select count(*) from public.drivers    where office_code is distinct from public.my_office()),'=0',null),
  (6,'offices 範囲外',   (select count(*) from public.offices    where office_code is distinct from public.my_office()),'=0',null),
  (10,'profiles 自分',   (select count(*) from public.profiles where user_id = auth.uid()),'>0',null),
  (11,'profiles 他人',   (select count(*) from public.profiles where user_id <> auth.uid()),'=0',null)
) as t(seq,check_name,cnt,expect,detail)
order by seq`;

// ── ケースA: なりすましあり（begin〜set local〜rollback を丸ごと）＝全行OK ──
{
  await db.exec('begin');
  await db.exec(`set local request.jwt.claims = '${JSON.stringify({ role: 'authenticated', sub: AREA_IT })}'`);
  await db.exec('set local role authenticated');
  const rows = (await db.query(PROOF)).rows;
  await db.exec('rollback'); await db.exec('reset role');

  const head = rows.find(r => r.seq === 0);
  ok(`なりすまし確認行が OK（detail=${head.detail}）`, head.judge === 'OK' && head.detail === 'area / IT01');
  ok('全行 judge=OK（範囲内>0 と 範囲外=0 が対で成立）', rows.every(r => r.judge === 'OK'));
  ok('deliveries 範囲外=0（RLSで他営業所が見えない）', Number(rows.find(r => r.seq === 2).cnt) === 0);
  ok('deliveries 範囲内=2（自営業所は見える＝塞ぎすぎていない）', Number(rows.find(r => r.seq === 1).cnt) === 2);
  ok('profiles 他人=0', Number(rows.find(r => r.seq === 11).cnt) === 0);
}

// ── ケースB: なりすましなし（部分実行の再現＝postgresのまま）＝先頭行がNGで気づける ──
{
  const rows = (await db.query(PROOF)).rows;
  const head = rows.find(r => r.seq === 0);
  ok(`なりすまし無しだと先頭行が NG（detail=${head.detail}）`, head.judge === 'NG' && head.detail === '(null) / (null)');
  ok('なりすまし無しだと 範囲外>0 になり誤りが見える（今回の事象を再現）',
    Number(rows.find(r => r.seq === 2).cnt) > 0 && rows.find(r => r.seq === 2).judge === 'NG');
  ok('なりすまし無しだと 範囲内=0 になる（my_office()がNULLのため）',
    Number(rows.find(r => r.seq === 1).cnt) === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
