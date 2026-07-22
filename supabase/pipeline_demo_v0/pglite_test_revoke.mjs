// pglite: revoke_demo_anon_v0.sql（demo_* の全面停止）＋ demo_functions_v0.sql の grant 無効化 の検証
//   固定の前提「SQLは人手でコピペ実行。渡す前に検証する」に基づく事前検証。
//
//   検証:
//     A. revoke SQL: anon/authenticated に付与された8関数から実行権を剥奪し、両者とも0件になる。
//     B. §2 検証クエリ: demo_functions=8 / anon_can_exec=0 / authenticated_can_exec=0 を返す。
//     C. ソース無効化: demo_functions_v0.sql の grant ブロックが RETIRED（コメント）で、
//        「素の grep で active な grant … to anon が残っていない」。
//     D. 冪等: revoke を再実行してもエラーが出ない。
// 実行: node supabase/pipeline_demo_v0/pglite_test_revoke.mjs
import { PGlite } from '../../node_modules/@electric-sql/pglite/dist/index.js';
import { readFileSync } from 'node:fs';

const REVOKE = readFileSync(new URL('./revoke_demo_anon_v0.sql', import.meta.url), 'utf8');
const SOURCE = readFileSync(new URL('./demo_functions_v0.sql', import.meta.url), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c) => (c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.error(`  ✗ ${n}`)));
const one = async (db, q) => (await db.query(q)).rows[0];

const db = new PGlite();
await db.exec(`create role anon; create role authenticated;`);

// 本物と同じシグネチャの8関数を作る（本体は空・stubで十分＝権限のみ検証）。
const SIGS = [
  ['demo_dispatch_preview', '(p_date date)', '(date)'],
  ['demo_renumber_preview', '(p_date date)', '(date)'],
  ['demo_dispatch',         '(p_date date)', '(date)'],
  ['demo_renumber',         '(p_date date)', '(date)'],
  ['demo_reset',            '(p_date date)', '(date)'],
  ['demo_summary',          '(p_date date)', '(date)'],
  ['demo_delivery_order',   '(p_date date, p_driver text default null, p_limit int default 60)', '(date,text,int)'],
  ['demo_drivers',          '(p_date date)', '(date)'],
];
for (const [name, params] of SIGS) {
  await db.exec(`create function public.${name}${params} returns void
                 language sql security definer set search_path=public as $$ select $$;`);
}

// 脆弱な初期状態を再現: anon/authenticated に grant（demo_functions_v0.sql の元の挙動）
for (const [, , sig] of SIGS) {
  await db.exec(`revoke execute on function public.${SIGS.find(s=>s[2]===sig)[0]}${sig} from public;
                 grant execute on function public.${SIGS.find(s=>s[2]===sig)[0]}${sig} to anon, authenticated;`);
}

const counts = async () => await one(db, `
  select count(*)::int as demo_functions,
         count(*) filter (where has_function_privilege('anon', p.oid, 'execute'))::int          as anon_can_exec,
         count(*) filter (where has_function_privilege('authenticated', p.oid, 'execute'))::int as authenticated_can_exec
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname='public' and p.proname like 'demo\\_%'`);

// 事前確認: 脆弱状態（anon 実行可）を再現できている
{
  const c = await counts();
  ok('前提: 脆弱状態を再現（8関数・anon実行可8・authenticated実行可8）',
     c.demo_functions === 8 && c.anon_can_exec === 8 && c.authenticated_can_exec === 8);
}

// ---- A/B. revoke SQL を適用 ----
console.log('A/B. revoke_demo_anon_v0.sql の適用');
await db.exec(REVOKE);
{
  const c = await counts();
  ok('A. anon_can_exec = 0（全面剥奪された）', c.anon_can_exec === 0);
  ok('A. authenticated_can_exec = 0（全面剥奪された）', c.authenticated_can_exec === 0);
  ok('B. demo_functions = 8（関数自体は残る）', c.demo_functions === 8);
}

// ---- D. 冪等 ----
console.log('D. 冪等（revoke 再実行）');
{
  let err = null;
  try { await db.exec(REVOKE); } catch (e) { err = e.message; }
  ok('D. 再実行してもエラーが出ない', err === null);
  const c = await counts();
  ok('D. 再実行後も anon/authenticated = 0', c.anon_can_exec === 0 && c.authenticated_can_exec === 0);
}
await db.close();

// ---- C. ソースの grant 無効化を静的に確認 ----
console.log('C. demo_functions_v0.sql の grant 無効化（静的検査）');
{
  // コメント行(--)を除いた本文に、active な「grant execute ... to anon」が残っていないこと。
  const active = SOURCE.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
  ok('C. active な grant に anon が現れない',
     !/grant\s+execute[\s\S]*?\banon\b/i.test(active));
  ok('C. active な "to anon, authenticated" が残っていない',
     !/to\s+anon\s*,\s*authenticated/i.test(active));
  ok('C. RETIRED バナーが記されている', /RETIRED（2026-07-17・セキュリティ修正）/.test(SOURCE));
  // grant ブロック自体はコメントとして保存されている（参照用・復活防止の警告付き）
  ok('C. 旧 grant ブロックはコメントとして残っている（警告付き）',
     /--\s*execute format\('grant execute/.test(SOURCE));
}

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
