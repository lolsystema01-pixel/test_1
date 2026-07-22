// pglite: check_office_init_v0.sql §4（なりすまし実証ブロック）が実際に機能するかの検証
//   目的: 「手動でUID置換しなくても set_config で area になりすませる」ことを確かめる。
//         §4 は実DBで人が実行するブロックなので、渡す前にここで動作を保証する。
// 実行: node supabase/office_init_setup_v0/pglite_test_check_sql.mjs
import { PGlite } from '../../node_modules/@electric-sql/pglite/dist/index.js';
import { readFileSync } from 'node:fs';

const CHECK = readFileSync(new URL('./check_office_init_v0.sql', import.meta.url), 'utf8');
const SETUP = readFileSync(new URL('./office_init_setup_v0.sql', import.meta.url), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c) => (c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.error(`  ✗ ${n}`)));

const db = new PGlite();
await db.exec(`create role authenticated;`);

// 本基盤相当の最小スキーマ＋ my_role()/my_office()（実物と同じく auth.uid() 由来）
await db.exec(`
  create schema if not exists auth;
  create function auth.uid() returns text language sql stable as $$
    select nullif(current_setting('request.jwt.claims', true)::json->>'sub', '')
  $$;
  create table public.profiles (user_id text primary key, role text, office_code text);
  create table public.offices (
    office_code text primary key, office_name text,
    basket_cart_limit integer, basket_order text not null default 'ドライバー順',
    auto_logout_enabled boolean, auto_logout_minutes integer, printer_model text
  );
  alter table public.offices add constraint offices_printer_model_chk
    check (printer_model is null or printer_model in ('Brother TD-2350', '汎用サーマル'));
  create function public.my_role() returns text language sql stable security definer as $$
    select role from public.profiles where user_id = auth.uid()
  $$;
  create function public.my_office() returns text language sql stable security definer as $$
    select office_code from public.profiles where user_id = auth.uid()
  $$;
  insert into public.offices (office_code, office_name) values ('IT01','伊丹営業所'),('A01','愛知県1営業所');
  insert into public.profiles values ('uid-area-it01','area','IT01'), ('uid-hq','hq',null);
  grant select on public.profiles, public.offices to authenticated;
`);
await db.exec(SETUP);

// §4 の実行ブロックだけを抜き出す。
//   ※ ヘッダの説明文にも「`begin;` から `rollback;` まで」と出てくるため、
//     単純な indexOf だと解説文を拾ってしまう（実際に踏んだ）。行頭の begin; を探す。
const lines = CHECK.split('\n');
const s = lines.findIndex((l) => l.trimEnd() === 'begin;');
const e = lines.findIndex((l, i) => i > s && l.trimStart().startsWith('rollback;'));
const block = lines.slice(s, e + 1).join('\n');
// ※ CRLF 環境（git の LF→CRLF 変換）だと行末に \r が残るので trim して判定する。
ok('§4 が begin;〜rollback; として抽出できる（コメントアウトされていない）',
   block.trim().startsWith('begin;') && block.trim().endsWith('rollback;'));
ok('§4 に手動置換のプレースホルダが残っていない', !/<AREA_UID>|<○○_UID>/.test(block));

// ---- ③ なりすましが成立するか（⑤の失敗前まで） ----
const upto4 = block.slice(0, block.indexOf('-- ⑤'));
{
  await db.exec(upto4.replace(/^begin;/, 'begin;'));
  const who = (await db.query(`select public.my_role() as role, public.my_office() as office`)).rows[0];
  ok('③ set_config だけで area になりすませる（role=area / office=IT01）',
     who.role === 'area' && who.office === 'IT01');
  const saved = (await db.query(`select gdrive_folder_url from public.offices where office_code='IT01'`)).rows[0];
  ok('④ 初回設定として保存できている',
     saved.gdrive_folder_url === 'https://drive.google.com/drive/folders/TEST');
}

// ---- ⑤ 2回目が拒否されるか ----
{
  let err = null;
  try {
    await db.query(`select public.save_office_init_setup(
      public.my_office(), 'https://drive.google.com/drive/folders/AGAIN', '汎用サーマル')`);
  } catch (e) { err = e.message; }
  ok('⑤ 2回目は拒否される（area は恒久的な編集権を持たない）', err !== null);
  ok('⑤ エラーが管理者設定へ誘導している', err !== null && /管理者設定/.test(err));
}

// ---- rollback で元に戻るか ----
{
  await db.exec(`rollback;`);
  const after = (await db.query(`select gdrive_folder_url from public.offices where office_code='IT01'`)).rows[0];
  ok('rollback で DB が元に戻る（④の書き込みも消える＝実DBを汚さない）',
     after.gdrive_folder_url === null);
  const role = (await db.query(`select current_user`)).rows[0];
  ok('rollback 後はロールも戻っている', role.current_user !== 'authenticated');
}

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
await db.close();
process.exit(fail ? 1 : 0);
