// pglite E2E: ① Storage の営業所別prefix制限（3バケット・hq/depot/area/driver）
//   storage スキーマ（objects / foldername）を本番同等にスタブし、出荷SQLをそのまま適用して
//   「自営業所は可・範囲外は0件/拒否」を実証する。
// 実行: node supabase/auth_rls_remaining_v1/pglite_test_storage.mjs
import { PGlite } from '../../node_modules/@electric-sql/pglite/dist/index.js';
import { readFileSync } from 'node:fs';

const db = new PGlite();
let pass = 0, fail = 0;
const ok = (n, c) => (c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.error(`  ✗ ${n}`)));

const U = {
  hq:     '00000000-0000-0000-0000-0000000000h1'.replace(/h/g, 'a'),
  areaIT: '00000000-0000-0000-0000-0000000000i1'.replace(/i/g, 'b'),
  areaA1: '00000000-0000-0000-0000-0000000000c1',
  depot:  '00000000-0000-0000-0000-0000000000d1',
  driver: '00000000-0000-0000-0000-0000000000e1'
};

// 呼び出しユーザーとして実行（auth.uid() は request.jwt.claims->>'sub'）
async function asUser(uid, fn) {
  await db.exec('begin');
  await db.exec(`set local request.jwt.claims = '${JSON.stringify({ role: 'authenticated', sub: uid })}'`);
  await db.exec('set local role authenticated');
  try { return await fn(); } finally { await db.exec('rollback'); await db.exec('reset role'); }
}
const countVisible = async (bucket) =>
  Number((await db.query(`select count(*)::int c from storage.objects where bucket_id=$1`, [bucket])).rows[0].c);

// ── 本番同等の前提（auth / profiles / offices / my_* / storage）──
await db.exec(`
  create role authenticated;
  create schema auth;
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub','')::uuid
  $$;

  create table public.offices (office_code text primary key, depot_code text);
  create table public.profiles (user_id uuid primary key, role text, office_code text, depot_code text);
  insert into public.offices values ('IT01','D_ITM'), ('A01','D01'), ('C01','D01');
  insert into public.profiles values
    ('${U.hq}','hq',null,null),
    ('${U.areaIT}','area','IT01',null),
    ('${U.areaA1}','area','A01',null),
    ('${U.depot}','depot',null,'D01'),      -- 配下= A01, C01（IT01は配下外）
    ('${U.driver}','driver',null,null);

  create or replace function public.my_role() returns text language sql stable security definer set search_path=public as $$
    select role from public.profiles where user_id = auth.uid() $$;
  create or replace function public.my_office() returns text language sql stable security definer set search_path=public as $$
    select office_code from public.profiles where user_id = auth.uid() $$;
  create or replace function public.my_depot() returns text language sql stable security definer set search_path=public as $$
    select depot_code from public.profiles where user_id = auth.uid() $$;
  create or replace function public.my_depot_offices() returns setof text language sql stable security definer set search_path=public as $$
    select office_code from public.offices where depot_code = public.my_depot() $$;

  -- storage スキーマのスタブ（foldername は Supabase と同じ意味：パスのフォルダ部分）
  create schema storage;
  create table storage.objects (id bigint generated always as identity primary key, bucket_id text, name text);
  create or replace function storage.foldername(name text) returns text[] language sql immutable as $$
    select (string_to_array(name, '/'))[1 : array_length(string_to_array(name, '/'), 1) - 1]
  $$;
  alter table storage.objects enable row level security;
  grant usage on schema storage, public to authenticated;
  grant select, insert, update on storage.objects to authenticated;
`);
ok("storage.foldername('IT01/2026-07-08/all.pdf')[1] = 'IT01'",
  (await db.query(`select (storage.foldername('IT01/2026-07-08/all.pdf'))[1] f`)).rows[0].f === 'IT01');

// ── 出荷SQLをそのまま適用（ヘルパ＋9ポリシー）──
const sql = readFileSync(new URL('./storage_rls_all_buckets_v0.sql', import.meta.url), 'utf8')
  .split('-- §5.')[0]; // §5以降は pg_policies/buckets の確認クエリ（Supabase専用）
await db.exec(sql);
ok('storage_rls_all_buckets_v0.sql が適用できる（ヘルパ＋9ポリシー）', true);

const BUCKETS = ['carry-sheets', 'dispatch-sheets', 'godoor-csv'];
for (const b of BUCKETS) {
  await db.query(`insert into storage.objects (bucket_id, name) values ($1,'IT01/2026-07-08/f'),($1,'A01/2026-07-08/f'),($1,'C01/2026-07-08/f')`, [b]);
}
ok('ポリシー数=9（3バケット × select/insert/update）',
  Number((await db.query(`select count(*)::int c from pg_policies where schemaname='storage' and tablename='objects'`)).rows[0].c) === 9);

// ── 読取スコープ：範囲外0件を実証 ──
for (const b of BUCKETS) {
  await asUser(U.areaIT, async () => {
    const rows = (await db.query(`select name from storage.objects where bucket_id=$1`, [b])).rows.map(r => r.name);
    ok(`[${b}] area/IT01 は自営業所のみ1件`, rows.length === 1 && rows[0].startsWith('IT01/'));
    ok(`[${b}] area/IT01 から他営業所(A01,C01)は0件`, !rows.some(n => n.startsWith('A01/') || n.startsWith('C01/')));
  });
  await asUser(U.hq,     async () => ok(`[${b}] hq は全office(3件)`, (await countVisible(b)) === 3));
  await asUser(U.depot,  async () => {
    const rows = (await db.query(`select name from storage.objects where bucket_id=$1`, [b])).rows.map(r => r.name);
    ok(`[${b}] depot(D01) は配下A01・C01のみ2件（IT01は見えない）`,
      rows.length === 2 && rows.every(n => n.startsWith('A01/') || n.startsWith('C01/')));
  });
  await asUser(U.driver, async () => ok(`[${b}] driver は0件（default-deny）`, (await countVisible(b)) === 0));
}

// ── 書込スコープ：自営業所は可・範囲外は拒否 ──
const tryInsert = async (uid, bucket, name) => asUser(uid, async () => {
  try { await db.query(`insert into storage.objects (bucket_id,name) values ($1,$2)`, [bucket, name]); return 'allowed'; }
  catch { return 'denied'; }
});
ok('area/IT01 は自営業所パスに書ける', (await tryInsert(U.areaIT, 'carry-sheets', 'IT01/2026-07-08/x.pdf')) === 'allowed');
ok('area/IT01 は他営業所パスに書けない（A01）', (await tryInsert(U.areaIT, 'carry-sheets', 'A01/2026-07-08/x.pdf')) === 'denied');
ok('driver はどこにも書けない', (await tryInsert(U.driver, 'godoor-csv', 'IT01/2026-07-08/x.csv')) === 'denied');
ok('ルート直下（office prefix 無し）は書けない', (await tryInsert(U.areaIT, 'carry-sheets', 'x.pdf')) === 'denied');
ok('depot は配下営業所パスに書ける（A01）', (await tryInsert(U.depot, 'dispatch-sheets', 'A01/2026-07-08/pre.pdf')) === 'allowed');
ok('depot は配下外パスに書けない（IT01）', (await tryInsert(U.depot, 'dispatch-sheets', 'IT01/2026-07-08/pre.pdf')) === 'denied');

// ── 上書き保存(upsert)＝UPDATE が自営業所で通り、範囲外は通らない ──
const tryUpdate = async (uid, bucket, name) => asUser(uid, async () => {
  const r = await db.query(`update storage.objects set name=name where bucket_id=$1 and name=$2`, [bucket, name]);
  return r.affectedRows ?? 0;
});
ok('area/IT01 は自営業所オブジェクトを更新できる（upsert上書き）', (await tryUpdate(U.areaIT, 'carry-sheets', 'IT01/2026-07-08/f')) === 1);
ok('area/IT01 は他営業所オブジェクトを更新できない', (await tryUpdate(U.areaIT, 'carry-sheets', 'A01/2026-07-08/f')) === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
