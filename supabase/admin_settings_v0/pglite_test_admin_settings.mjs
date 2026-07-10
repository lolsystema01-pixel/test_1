// pglite E2E: 管理者設定（offices 列追加・CHECK・新規既定50・update_office_settings の hq限定）
//   最重要: 「既存の basket_cart_limit を壊さない」「新規営業所だけ 50」「hq以外は編集不可」
// 実行: node supabase/admin_settings_v0/pglite_test_admin_settings.mjs
import { PGlite } from '../../node_modules/@electric-sql/pglite/dist/index.js';
import { readFileSync } from 'node:fs';

const db = new PGlite();
let pass = 0, fail = 0;
const ok = (n, c) => (c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.error(`  ✗ ${n}`)));

const HQ = '00000000-0000-0000-0000-0000000000a1';
const AREA = '00000000-0000-0000-0000-0000000000b1';

// 呼び出しユーザーとして実行（auth.uid() は request.jwt.claims->>'sub'）
async function asUser(uid, fn) {
  await db.exec('begin');
  await db.exec(`set local request.jwt.claims = '${JSON.stringify({ role: 'authenticated', sub: uid })}'`);
  await db.exec('set local role authenticated');
  try { return await fn(); } finally { await db.exec('rollback'); await db.exec('reset role'); }
}
const tryRpc = async (uid, args) => asUser(uid, async () => {
  try {
    await db.query(`select public.update_office_settings($1,$2,$3,$4,$5,$6)`, args);
    return { ok: true };
  } catch (e) { return { ok: false, msg: String(e.message || e) }; }
});

// ── 本番相当の前提（offices は実スキーマの該当列。既存値は現状のまま）──
await db.exec(`
  create role authenticated;
  create schema auth;
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub','')::uuid $$;

  create table public.offices (
    office_code        text primary key,
    depot_code         text,
    office_name        text not null,
    dispatch_priority  text not null default '処理能力優先',
    basket_order       text not null default 'ドライバー順',
    basket_cart_limit  integer,
    autosave_threshold integer not null default 50,
    request_period_days integer
  );
  create table public.profiles (user_id uuid primary key, role text, office_code text);
  insert into public.profiles values ('${HQ}','hq',null), ('${AREA}','area','IT01');

  -- 現行の実データ（既存値が壊れないことの検証に使う）
  insert into public.offices (office_code, office_name, basket_cart_limit) values
    ('IT01','伊丹営業所', 50),
    ('A01','愛知県1営業所', 10),
    ('C01','愛知県2営業所', 10);

  create or replace function public.my_role() returns text language sql stable security definer set search_path=public as $$
    select role from public.profiles where user_id = auth.uid() $$;

  grant usage on schema auth, public to authenticated;
  grant execute on function auth.uid() to authenticated;
  grant select on public.offices to authenticated;
`);

// ── 出荷SQLをそのまま適用（§5の確認クエリ含む）──
const sql = readFileSync(new URL('./office_settings_admin_v0.sql', import.meta.url), 'utf8');
await db.exec(sql);
ok('office_settings_admin_v0.sql が適用できる', true);

// ── 既存値が壊れていない（最重要）──
{
  const rows = (await db.query(`select office_code, basket_cart_limit from public.offices order by office_code`)).rows;
  const m = Object.fromEntries(rows.map(r => [r.office_code, r.basket_cart_limit]));
  ok(`既存の basket_cart_limit を保持（IT01=${m.IT01} A01=${m.A01} C01=${m.C01}）`,
    m.IT01 === 50 && m.A01 === 10 && m.C01 === 10);
}
// ── 新設3列は NULL（未設定）──
{
  const r = (await db.query(`select count(*)::int c from public.offices
    where auto_logout_enabled is null and auto_logout_minutes is null and printer_model is null`)).rows[0];
  ok('新設3列は全営業所で NULL（未設定）', r.c === 3);
}
// ── 新規営業所だけ既定50（DEFAULT は今後の INSERT にのみ効く）──
{
  await db.exec(`insert into public.offices (office_code, office_name) values ('NEW1','新規営業所')`);
  const r = (await db.query(`select basket_cart_limit from public.offices where office_code='NEW1'`)).rows[0];
  ok('新規営業所の basket_cart_limit は既定50', r.basket_cart_limit === 50);
  const m = (await db.query(`select basket_cart_limit from public.offices where office_code='A01'`)).rows[0];
  ok('既存営業所(A01=10)は DEFAULT 変更の影響を受けない', m.basket_cart_limit === 10);
  await db.exec(`delete from public.offices where office_code='NEW1'`);
}

// ── CHECK 制約（不正値は DB が弾く）──
const expectFail = async (sql2, label) => {
  try { await db.exec(sql2); ok(label, false); }
  catch { ok(label, true); }
};
await expectFail(`update public.offices set basket_order='件数順' where office_code='IT01'`, 'CHECK: かご振り順は3択のみ（不正値を弾く）');
await expectFail(`update public.offices set basket_cart_limit=0 where office_code='IT01'`, 'CHECK: かご台車上限 0 を弾く');
await expectFail(`update public.offices set basket_cart_limit=501 where office_code='IT01'`, 'CHECK: かご台車上限 501 を弾く');
await expectFail(`update public.offices set auto_logout_minutes=0 where office_code='IT01'`, 'CHECK: 自動ログアウト 0分 を弾く');
await expectFail(`update public.offices set printer_model='EPSON XX' where office_code='IT01'`, 'CHECK: 未知の印刷機種を弾く');
{
  await db.exec(`update public.offices set basket_cart_limit=null, auto_logout_minutes=null, printer_model=null where office_code='IT01'`);
  ok('CHECK: NULL（未設定）は許可される', true);
  await db.exec(`update public.offices set basket_cart_limit=50 where office_code='IT01'`); // 戻す
}

// ── 保存口：hq のみ編集可 ──
{
  const r = await tryRpc(HQ, ['IT01', 40, 'ゾーン順', true, 30, 'Brother TD-2350']);
  ok('hq は update_office_settings を実行できる', r.ok === true);
}
{
  const r = await tryRpc(AREA, ['IT01', 40, 'ゾーン順', true, 30, 'Brother TD-2350']);
  ok(`area は編集できない（権限エラー）: ${r.msg?.slice(0, 40)}`, r.ok === false && /権限がありません/.test(r.msg));
}
{
  const r = await tryRpc(HQ, ['NOPE', 40, 'ゾーン順', true, 30, 'Brother TD-2350']);
  ok('存在しない営業所はエラー', r.ok === false && /営業所が存在しません/.test(r.msg));
}
{
  const r = await tryRpc(HQ, ['IT01', 40, '件数順', true, 30, 'Brother TD-2350']);
  ok('不正なかご振り順は関数側で弾く', r.ok === false && /かご振り順が不正/.test(r.msg));
}
{
  const r = await tryRpc(HQ, ['IT01', 600, 'ゾーン順', true, 30, 'Brother TD-2350']);
  ok('かご台車上限 600 は関数側で弾く', r.ok === false && /1〜500/.test(r.msg));
}

// ── 保存された値が実際に反映される（rollbackせず確定させて確認）──
// ※ set local はトランザクション内でしか効かない。ここはセッション設定で claims を与える。
await db.exec(`set request.jwt.claims = '${JSON.stringify({ role: 'authenticated', sub: HQ })}'`);
{
  await db.query(`select public.update_office_settings($1,$2,$3,$4,$5,$6)`,
    ['A01', 25, 'ゾーン順', true, 45, '汎用サーマル']);
  const r = (await db.query(`select basket_cart_limit, basket_order, auto_logout_enabled, auto_logout_minutes, printer_model
                             from public.offices where office_code='A01'`)).rows[0];
  ok('保存が反映される（A01: 25 / ゾーン順 / 有効45分 / 汎用サーマル）',
    r.basket_cart_limit === 25 && r.basket_order === 'ゾーン順' &&
    r.auto_logout_enabled === true && r.auto_logout_minutes === 45 && r.printer_model === '汎用サーマル');
}
// ── basket_order に NULL を渡すと現在値を維持（NOT NULL 列の保護）──
{
  await db.query(`select public.update_office_settings($1,$2,$3,$4,$5,$6)`, ['A01', null, null, null, null, null]);
  const r = (await db.query(`select basket_cart_limit, basket_order, auto_logout_minutes from public.offices where office_code='A01'`)).rows[0];
  ok('basket_order は NULL 指定で現在値を維持（ゾーン順のまま）', r.basket_order === 'ゾーン順');
  ok('他の列は NULL 指定で「未設定」に戻せる', r.basket_cart_limit === null && r.auto_logout_minutes === null);
}

// ── 採番との整合: NULL は 50 として扱われる（renumber の clamp と同じ式）──
{
  const r = (await db.query(`select greatest(1, least(500, coalesce(basket_cart_limit, 50))) as eff
                             from public.offices where office_code='A01'`)).rows[0];
  ok('未設定(NULL)は採番側で 50 として解決される', Number(r.eff) === 50);
}
await db.exec(`reset request.jwt.claims`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
