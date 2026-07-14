// pglite E2E: call_logs ＋ record_call_log（冪等）／resolve_callback（CS認可）／callback_queue（RLS継承）。
// 実行: node supabase/call_log_v0/pglite_test.mjs
import { PGlite } from '../../node_modules/@electric-sql/pglite/dist/index.js';
import { readFileSync } from 'node:fs';

const db = new PGlite();
let pass = 0,
  fail = 0;
const ok = (n, c) => (c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.error(`  ✗ ${n}`)));
async function throws(n, fn) {
  try {
    await fn();
    fail++;
    console.error(`  ✗ ${n}（例外が出なかった）`);
  } catch {
    pass++;
    console.log(`  ✓ ${n}`);
  }
}

// ロール別ダミーUUID（rls_v0/seed_accounts_v0.sql と同じ値に統一）
const HQ = '00000000-0000-0000-0000-000000000001'; // hq
const DEPOT = '00000000-0000-0000-0000-000000000002'; // depot（D01配下）
const AREA = '00000000-0000-0000-0000-0000000000a1'; // area A01
const DRV = '00000000-0000-0000-0000-0000000000d1'; // driver DRV001
const SHIPPER = '00000000-0000-0000-0000-0000000000f1'; // shipper SHIP01

async function asUser(uid, fn) {
  await db.exec('begin');
  await db.exec(`set local request.jwt.claims = '${JSON.stringify({ role: 'authenticated', sub: uid })}'`);
  await db.exec('set local role authenticated');
  try {
    return await fn();
  } finally {
    await db.exec('rollback');
    await db.exec('reset role');
  }
}

async function asAnon(fn) {
  await db.exec('begin');
  await db.exec('set local role anon');
  try {
    return await fn();
  } finally {
    await db.exec('rollback');
    await db.exec('reset role');
  }
}

// asUserと同じだが、書込みを実際に残したい検証（resolve_callbackの永続化）用にcommitする。
async function asUserCommit(uid, fn) {
  await db.exec('begin');
  await db.exec(`set local request.jwt.claims = '${JSON.stringify({ role: 'authenticated', sub: uid })}'`);
  await db.exec('set local role authenticated');
  try {
    return await fn();
  } finally {
    await db.exec('commit');
    await db.exec('reset role');
  }
}

// --- Supabase互換の最小スタブ（call_logsはdeliveries非依存なのでprofiles＋my_role()のみ）---
await db.exec(`
  create schema if not exists auth;
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub','')::uuid
  $$;
  create role authenticated;
  create role anon;

  create table public.profiles (user_id uuid primary key, role text, office_code text, driver_id text, shipper_id text);
  create or replace function public.my_role() returns text language sql stable security definer as $$ select role from public.profiles where user_id=auth.uid() $$;

  insert into public.profiles values
    ('${HQ}','hq',null,null,null),
    ('${DEPOT}','depot',null,null,null),
    ('${AREA}','area','A01',null,null),
    ('${DRV}','driver',null,'DRV001',null),
    ('${SHIPPER}','shipper',null,null,'SHIP01');
`);

// 本体SQLを適用
await db.exec(readFileSync(new URL('./call_log_v0.sql', import.meta.url), 'utf8'));

const rec = (sid, opts = {}) =>
  db.query(
    `select public.record_call_log(
       p_call_sid        := $1,
       p_caller_phone    := $2,
       p_tracking_number := $3,
       p_band_key        := $4,
       p_intent          := $5,
       p_summary         := $6,
       p_transcript      := $7,
       p_recording_url   := $8,
       p_outcome         := $9,
       p_receipt_no      := $10,
       p_priority        := $11,
       p_channel         := $12,
       p_started_at      := $13,
       p_ended_at        := $14,
       p_duration_sec    := $15
     ) r`,
    [
      sid,
      opts.caller_phone ?? null,
      opts.tracking_number ?? null,
      opts.band_key ?? null,
      opts.intent ?? null,
      opts.summary ?? null,
      opts.transcript ?? null,
      opts.recording_url ?? null,
      opts.outcome ?? 'AI完結',
      opts.receipt_no ?? null,
      opts.priority ?? 0,
      opts.channel ?? 'ai_phone',
      opts.started_at ?? null,
      opts.ended_at ?? null,
      opts.duration_sec ?? null,
    ]
  );
const countCallLogs = async () => (await db.query(`select count(*)::int n from public.call_logs`)).rows[0].n;

console.log('\n[記録：record_call_logで1行入る]');
const r1 = (await rec('CA-TEST-0001', {
  caller_phone: '090-0000-0001',
  tracking_number: '900000000001',
  band_key: 'demo9000',
  intent: '状況照会',
  summary: '配達予定の確認',
  channel: 'ai_phone',
  started_at: '2026-07-15T09:00:00+09:00',
  ended_at: '2026-07-15T09:02:30+09:00',
  duration_sec: 150,
})).rows[0].r;
ok('返り値 result=recorded', r1.result === 'recorded');
ok('call_id が採番される', typeof r1.call_id === 'number' || typeof r1.call_id === 'bigint');
ok('call_sid が一致', r1.call_sid === 'CA-TEST-0001');
ok('callback_status=不要（outcome既定=AI完結）', r1.callback_status === '不要');
ok('全体1行', (await countCallLogs()) === 1);
const row1 = (await db.query(`select tracking_number, band_key, intent, summary, channel, duration_sec, started_at, outcome, callback_status from public.call_logs where call_sid='CA-TEST-0001'`)).rows[0];
ok('列が正しく入る（tracking_number/band_key/intent/summary）', row1.tracking_number === '900000000001' && row1.band_key === 'demo9000' && row1.intent === '状況照会' && row1.summary === '配達予定の確認');
ok('★通話メタが入る（channel=ai_phone/duration_sec=150/started_at NOT NULL）', row1.channel === 'ai_phone' && row1.duration_sec === 150 && row1.started_at !== null);
ok('outcome 既定=AI完結', row1.outcome === 'AI完結');

console.log('\n[冪等：同じcall_sidで再実行→duplicate・行が増えない]');
const r1b = (await rec('CA-TEST-0001', { caller_phone: '999-9999-9999' })).rows[0].r;
ok('返り値 result=duplicate', r1b.result === 'duplicate');
ok('call_id が初回と同じ', r1b.call_id === r1.call_id);
ok('行数は増えない（1行のまま）', (await countCallLogs()) === 1);
const stillOld = (await db.query(`select caller_phone from public.call_logs where call_sid='CA-TEST-0001'`)).rows[0].caller_phone;
ok('重複実行の引数では上書きされない（初回の値のまま）', stillOld === '090-0000-0001');

console.log('\n[折り返し：outcome=折り返し要→callback_status=待ち／AI完結→不要]');
const r2 = (await rec('CA-TEST-0002', { outcome: '折り返し要', intent: '再配達', priority: 0 })).rows[0].r;
ok('折り返し要→callback_status=待ち', r2.callback_status === '待ち');
const r3 = (await rec('CA-TEST-0003', { outcome: 'AI完結', intent: '状況照会' })).rows[0].r;
ok('AI完結→callback_status=不要', r3.callback_status === '不要');

console.log('\n[callback_queue：待ちのみ載る（HQで確認）]');
await asUser(HQ, async () => {
  const q = (await db.query(`select call_sid from public.callback_queue`)).rows.map((r) => r.call_sid);
  ok('CA-TEST-0002（待ち）はqueueに載る', q.includes('CA-TEST-0002'));
  ok('CA-TEST-0003（不要）はqueueに載らない', !q.includes('CA-TEST-0003'));
});

console.log('\n[優先度順：priority高→古い順でqueueが並ぶ]');
await rec('CA-PRI-1', { outcome: '折り返し要', priority: 1, intent: '低優先' });
await rec('CA-PRI-2', { outcome: '折り返し要', priority: 5, intent: '高優先(先)' });
await rec('CA-PRI-3', { outcome: '折り返し要', priority: 5, intent: '高優先(後)' });
// created_at の順序を決定的にする（同priority内は古い順＝CA-PRI-2が先）。
await db.exec(`update public.call_logs set created_at = now() - interval '10 minutes' where call_sid='CA-PRI-2'`);
await db.exec(`update public.call_logs set created_at = now() - interval '5 minutes'  where call_sid='CA-PRI-3'`);
await db.exec(`update public.call_logs set created_at = now() - interval '1 minutes'  where call_sid='CA-PRI-1'`);
await asUser(HQ, async () => {
  const order = (await db.query(`select call_sid from public.callback_queue where call_sid like 'CA-PRI-%' order by priority desc, created_at asc`)).rows.map((r) => r.call_sid);
  ok('順序＝優先度5(古い)→優先度5(新しい)→優先度1', JSON.stringify(order) === JSON.stringify(['CA-PRI-2', 'CA-PRI-3', 'CA-PRI-1']));
  const viewOrder = (await db.query(`select call_sid from public.callback_queue where call_sid like 'CA-PRI-%'`)).rows.map((r) => r.call_sid);
  ok('ビュー自体の既定順（priority desc, created_at asc）が一致', JSON.stringify(viewOrder) === JSON.stringify(['CA-PRI-2', 'CA-PRI-3', 'CA-PRI-1']));
});

console.log('\n[入力ハードニング：列長CHECK制約（セキュリティレビューI-1）]');
await throws('transcript が上限(20000)超過でreject', () => rec('CA-LEN-TRANSCRIPT', { transcript: 'あ'.repeat(20001) }));
await throws('summary が上限(4000)超過でreject', () => rec('CA-LEN-SUMMARY', { summary: 'あ'.repeat(4001) }));
await throws('caller_phone が上限(32)超過でreject', () => rec('CA-LEN-PHONE', { caller_phone: '0'.repeat(33) }));
const rLenOk = (
  await rec('CA-LEN-OK', {
    transcript: 'あ'.repeat(20000),
    summary: 'あ'.repeat(4000),
    caller_phone: '0'.repeat(32),
  })
).rows[0].r;
ok('上限ちょうど（20000/4000/32）は許可される', rLenOk.result === 'recorded');

console.log('\n[入力ハードニング：priority clamp（セキュリティレビューI-1・キューポイズニング対策）]');
await rec('CA-CLAMP-BIG', { priority: 999999999 });
const rowClampBig = (await db.query(`select priority from public.call_logs where call_sid='CA-CLAMP-BIG'`)).rows[0];
ok('巨大priorityは9にclampされる', rowClampBig.priority === 9);
await rec('CA-CLAMP-NEG', { priority: -50 });
const rowClampNeg = (await db.query(`select priority from public.call_logs where call_sid='CA-CLAMP-NEG'`)).rows[0];
ok('負のpriorityは0にclampされる', rowClampNeg.priority === 0);

console.log('\n[resolve_callback：CSが解決→queueから消える／anonは拒否／再解決はalready]');
// ★永続化して確認したいので asUserCommit（commitする版）を使う。
const targetId = (await db.query(`select id from public.call_logs where call_sid='CA-TEST-0002'`)).rows[0].id;
await asUserCommit(AREA, async () => {
  const res = (await db.query(`select public.resolve_callback($1,$2) r`, [targetId, '折り返し完了・本人と通話済み'])).rows[0].r;
  ok('返り値 result=resolved', res.result === 'resolved');
  ok('callback_by=area(AREA)のuid', res.callback_by === AREA);
});
const resolved = (await db.query(`select callback_status, callback_by, callback_at, callback_note from public.call_logs where call_sid='CA-TEST-0002'`)).rows[0];
ok('callback_status=完了', resolved.callback_status === '完了');
ok('callback_by=area(AREA)', resolved.callback_by === AREA);
ok('callback_at が入る', resolved.callback_at !== null);
ok('callback_note が入る', resolved.callback_note === '折り返し完了・本人と通話済み');
await asUser(HQ, async () => {
  const q = (await db.query(`select call_sid from public.callback_queue`)).rows.map((r) => r.call_sid);
  ok('解決後 CA-TEST-0002 はqueueから消える', !q.includes('CA-TEST-0002'));
});

await throws('anonはresolve_callbackを実行不可', () =>
  asAnon(async () => {
    await db.query(`select public.resolve_callback($1,$2) r`, [targetId, 'x']);
  })
);

await asUser(AREA, async () => {
  const res2 = (await db.query(`select public.resolve_callback($1,$2) r`, [targetId, '再解決メモ'])).rows[0].r;
  ok('再解決は冪等（result=already）', res2.result === 'already');
});
ok('★再解決後もnoteは上書きされない（最初のまま）', (await db.query(`select callback_note from public.call_logs where call_sid='CA-TEST-0002'`)).rows[0].callback_note === '折り返し完了・本人と通話済み');

console.log('\n[resolve_callback：p_status=不要／待ち以外への再resolveは対象外／不正値は拒否／driver・shipperは拒否]');
await rec('CA-RSV-1', { outcome: '折り返し要', intent: '状況照会' });
const rsv1Id = (await db.query(`select id from public.call_logs where call_sid='CA-RSV-1'`)).rows[0].id;
await asUserCommit(HQ, async () => {
  const res = (await db.query(`select public.resolve_callback($1,$2,$3) r`, [rsv1Id, '不要と判断', '不要'])).rows[0].r;
  ok('p_status=不要でresolved', res.result === 'resolved' && res.callback_status === '不要');
});
const rsv1Row = (await db.query(`select callback_status, callback_note from public.call_logs where call_sid='CA-RSV-1'`)).rows[0];
ok('callback_status=不要が記録される', rsv1Row.callback_status === '不要');

await asUser(HQ, async () => {
  const res2 = (await db.query(`select public.resolve_callback($1,$2) r`, [rsv1Id, '再度メモ'])).rows[0].r;
  ok('★不要行への再resolveは対象外（result=already・更新されない）', res2.result === 'already');
});
ok(
  '★不要行のnoteは上書きされない',
  (await db.query(`select callback_note from public.call_logs where call_sid='CA-RSV-1'`)).rows[0].callback_note === '不要と判断'
);
await asUser(HQ, async () => {
  const res2b = (await db.query(`select public.resolve_callback($1,$2) r`, [targetId, '完了行への再resolveメモ'])).rows[0].r;
  ok('★完了行への再resolveも対象外（result=already・更新されない）', res2b.result === 'already');
});

await rec('CA-RSV-2', { outcome: '折り返し要', intent: 'その他' });
const rsv2Id = (await db.query(`select id from public.call_logs where call_sid='CA-RSV-2'`)).rows[0].id;
await throws('p_statusに不正値を渡すとreject（許可外の値）', () =>
  asUser(HQ, async () => {
    await db.query(`select public.resolve_callback($1,$2,$3) r`, [rsv2Id, 'x', '保留']);
  })
);
ok(
  '不正値rejectの対象行はcallback_status=待ちのまま（変更されない）',
  (await db.query(`select callback_status from public.call_logs where call_sid='CA-RSV-2'`)).rows[0].callback_status === '待ち'
);
await asUserCommit(HQ, async () => {
  const res3 = (await db.query(`select public.resolve_callback($1,$2) r`, [rsv2Id, '通常解決'])).rows[0].r;
  ok('待ち行への正常遷移（p_status省略時デフォルト=完了）', res3.result === 'resolved' && res3.callback_status === '完了');
});

await throws('★driverはresolve_callbackを実行不可', () =>
  asUser(DRV, async () => {
    await db.query(`select public.resolve_callback($1,$2) r`, [rsv1Id, 'x']);
  })
);
await throws('★shipperはresolve_callbackを実行不可', () =>
  asUser(SHIPPER, async () => {
    await db.query(`select public.resolve_callback($1,$2) r`, [rsv1Id, 'x']);
  })
);

console.log('\n[anonはrecord_call_logを実行できる（受電経路）が、SELECTはできない]');
await asAnon(async () => {
  const ra = (await db.query(`select public.record_call_log($1) r`, ['CA-ANON-1'])).rows[0].r;
  ok('anonからのrecord_call_logはOK（result=recorded）', ra.result === 'recorded');
});
await throws('anonはcall_logsをSELECT不可（GRANTなし）', () =>
  asAnon(async () => {
    await db.query(`select count(*) from public.call_logs`);
  })
);
await throws('anonはcallback_queueをSELECT不可', () =>
  asAnon(async () => {
    await db.query(`select count(*) from public.callback_queue`);
  })
);

console.log('\n[RLS 5ロール：hq/depot/areaは全件可視・driver/shipperは0件]');
const total = await countCallLogs();
await asUser(HQ, async () => {
  const n = (await db.query(`select count(*)::int n from public.call_logs`)).rows[0].n;
  ok(`hq は全件可視（${n}件=総数${total}件）`, n === total && n > 0);
});
await asUser(DEPOT, async () => {
  const n = (await db.query(`select count(*)::int n from public.call_logs`)).rows[0].n;
  ok(`depot は全件可視（${n}件=総数${total}件）`, n === total && n > 0);
});
await asUser(AREA, async () => {
  const n = (await db.query(`select count(*)::int n from public.call_logs`)).rows[0].n;
  ok(`area は全件可視（${n}件=総数${total}件）`, n === total && n > 0);
});
await asUser(DRV, async () => {
  const n = (await db.query(`select count(*)::int n from public.call_logs`)).rows[0].n;
  ok('★driver は call_logs=0件（範囲外0件）', n === 0);
});
await asUser(SHIPPER, async () => {
  const n = (await db.query(`select count(*)::int n from public.call_logs`)).rows[0].n;
  ok('★shipper は call_logs=0件（範囲外0件）', n === 0);
});

console.log('\n[callback_queueも同型：hq可視・driver/shipperは0件]');
const totalQueue = (await db.query(`select count(*)::int n from public.callback_queue`)).rows[0].n; // 上で実行中は top-levelなのでRLSなし（超級権限相当）
await asUser(HQ, async () => {
  const n = (await db.query(`select count(*)::int n from public.callback_queue`)).rows[0].n;
  ok(`hq は callback_queue 可視（${n}件）`, n === totalQueue && n > 0);
});
await asUser(DRV, async () => {
  const n = (await db.query(`select count(*)::int n from public.callback_queue`)).rows[0].n;
  ok('★driver は callback_queue=0件', n === 0);
});
await asUser(SHIPPER, async () => {
  const n = (await db.query(`select count(*)::int n from public.callback_queue`)).rows[0].n;
  ok('★shipper は callback_queue=0件', n === 0);
});

console.log(`\ncall_log pglite: ${pass} passed, ${fail} failed`);
await db.close();
if (fail > 0) process.exit(1);
