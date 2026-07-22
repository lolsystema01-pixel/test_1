// pglite E2E: 置き配写真POD v0（delivery_photos表 ＋ 記録口 attach_delivery_photo／clear_delivery_photos）。
//   storage.objects は pgliteに（Supabase Storage実装が）無いため、storage.buckets/storage.objects/
//   storage.foldername は「delivery_photo_v0.sql の全文がそのままエラー無く適用できる」ことの確認
//   に必要な最小スタブのみ用意する（auth_rls_remaining_v1/pglite_test_storage.mjs と同方式）。
//   Storageポリシーの実効性（実際のオブジェクトへのINSERT/SELECT拒否）はここでは検証しない
//   ＝ rpc（attach_delivery_photo／clear_delivery_photos）と delivery_photos テーブル部分のみを対象とする。
//   clear_delivery_photos の storage.objects DELETEは、テスト内で直接INSERTした行（実アップロードの
//   代役）に対してSQLレベルのDELETEが効くことのみ確認する（実バックエンドの実体削除は範囲外＝README参照）。
// 実行: node supabase/delivery_photo_v0/pglite_test.mjs
import { PGlite } from '../../node_modules/@electric-sql/pglite/dist/index.js';
import { readFileSync } from 'node:fs';

const db = new PGlite();
let pass = 0,
  fail = 0;
const ok = (n, c) => (c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.error(`  ✗ ${n}`)));
async function throwsCode(n, code, fn) {
  try {
    await fn();
    fail++;
    console.error(`  ✗ ${n}（例外が出なかった）`);
  } catch (e) {
    if (code && e.code !== code) {
      fail++;
      console.error(`  ✗ ${n}（errcode不一致: expected=${code} actual=${e.code} ${e.message}）`);
    } else {
      pass++;
      console.log(`  ✓ ${n} [${e.code}]`);
    }
  }
}

// --- ダミーUUID（正準規格 v1: 愛知A01/C01・DRV001-003・SHIP01 に対応。delivery_result_v0と同じ割当）---
const HQ1 = '00000000-0000-0000-0000-000000000001'; // hq
const DEPOT_D1 = '00000000-0000-0000-0000-0000000000e1'; // depot D01（配下=A01）
const AREA_A1 = '00000000-0000-0000-0000-0000000000a1'; // area A01
const SHIP1 = '00000000-0000-0000-0000-0000000000f1'; // shipper SHIP01
const DRV1 = '00000000-0000-0000-0000-0000000000d1'; // driver DRV001（A01）
const DRV2 = '00000000-0000-0000-0000-0000000000d2'; // driver DRV002（A01・他ドライバー）

async function asUser(uid, fn, { commit = false } = {}) {
  await db.exec('begin');
  await db.exec(`set local request.jwt.claims = '${JSON.stringify({ role: 'authenticated', sub: uid })}'`);
  await db.exec('set local role authenticated');
  try {
    return await fn();
  } finally {
    await db.exec(commit ? 'commit' : 'rollback');
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

// --- Supabase互換の最小スタブ（delivery_result_v0/pglite_test.mjs と同一の下地）---
await db.exec(`
  create schema if not exists auth;
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub','')::uuid
  $$;
  create role authenticated;
  create role anon;

  create table public.profiles (
    user_id uuid primary key, role text,
    depot_code text, office_code text, driver_id text, shipper_id text
  );
  create table public.offices (office_code text primary key, depot_code text);
  create table public.drivers (driver_id text primary key, office_code text);
  grant select on public.drivers to authenticated;

  create or replace function public.my_role()   returns text language sql stable security definer as $$ select role from public.profiles where user_id=auth.uid() $$;
  create or replace function public.my_office() returns text language sql stable security definer as $$ select office_code from public.profiles where user_id=auth.uid() $$;
  create or replace function public.my_depot()  returns text language sql stable security definer as $$ select depot_code from public.profiles where user_id=auth.uid() $$;
  create or replace function public.my_driver() returns text language sql stable security definer as $$ select driver_id from public.profiles where user_id=auth.uid() $$;
  create or replace function public.my_shipper() returns text language sql stable security definer as $$ select shipper_id from public.profiles where user_id=auth.uid() $$;
  create or replace function public.my_depot_offices() returns setof text language sql stable security definer as $$
    select office_code from public.offices where depot_code = public.my_depot() $$;
  create or replace function public.my_office_drivers() returns setof text language sql stable security definer as $$
    select driver_id from public.drivers where office_code = public.my_office() $$;

  alter table public.drivers enable row level security;
  create policy drivers_hq     on public.drivers for select to authenticated using ( public.my_role()='hq' );
  create policy drivers_area   on public.drivers for select to authenticated using ( public.my_role()='area'   and office_code=public.my_office() );
  create policy drivers_self   on public.drivers for select to authenticated using ( public.my_role()='driver' and driver_id=public.my_driver() );

  create table public.deliveries (
    tracking_number text primary key,
    office_code text, driver_id text, shipper_id text,
    status text not null default '未配車'
  );
  alter table public.deliveries enable row level security;
  grant select on public.deliveries to authenticated;
  create policy d_hq     on public.deliveries for select to authenticated using ( public.my_role()='hq' );
  create policy d_area   on public.deliveries for select to authenticated using ( public.my_role()='area'   and office_code=public.my_office() );
  create policy d_driver on public.deliveries for select to authenticated using ( public.my_role()='driver' and driver_id=public.my_driver() );
  create policy d_shipper on public.deliveries for select to authenticated using ( public.my_role()='shipper' and shipper_id=public.my_shipper() );

  insert into public.offices (office_code, depot_code) values ('A01','D01'), ('C01','D02');
  insert into public.drivers (driver_id, office_code) values ('DRV001','A01'), ('DRV002','A01'), ('DRV003','C01');

  insert into public.profiles (user_id, role, depot_code, office_code, driver_id, shipper_id) values
    ('${HQ1}',      'hq',      null,  null,  null,     null),
    ('${DEPOT_D1}', 'depot',   'D01', null,  null,     null),
    ('${AREA_A1}',  'area',    'D01', 'A01', null,     null),
    ('${SHIP1}',    'shipper', null,  null,  null,     'SHIP01'),
    ('${DRV1}',     'driver',  'D01', 'A01', 'DRV001', null),
    ('${DRV2}',     'driver',  'D01', 'A01', 'DRV002', null);

  -- 9000帯12桁（本モジュール専用レンジ 900000000401〜408・他モジュールと非衝突）
  -- status='仕分済' で投入し、record_delivery_result 経由で目的のstatusにする（delivery_results 行を
  -- 正規のパスで作らないと photo attach の前提行が無いため）。
  insert into public.deliveries (tracking_number, office_code, driver_id, shipper_id, status) values
    ('900000000401','A01','DRV001','SHIP01','仕分済'),  -- T1系: DRV001所有・写真attach対象（→完了）
    ('900000000402','A01','DRV002','SHIP01','仕分済'),  -- T4: DRV002所有（DRV001が触れない）（→完了）
    ('900000000403','A01','DRV001','SHIP01','仕分済'),  -- T5: パス厳密一致違反の対象（→完了）
    ('900000000404','A01','DRV001','SHIP01','仕分済'),  -- T7: 非driverロール拒否の対象（→完了）
    ('900000000406','A01','DRV001','SHIP01','仕分済'),  -- T-clear系: DRV001所有（→不在。clear_delivery_photos）
    ('900000000407','A01','DRV002','SHIP01','仕分済'),  -- T-clear系: DRV002所有（→不在。他人拒否の対象）
    ('900000000408','A01','DRV001','SHIP01','仕分済');  -- T-clear系: DRV001所有（→完了。status不一致拒否の対象）
  -- 900000000405 は意図的に deliveries/delivery_results どちらにも作らない（T8: 未存在）

  -- storage スキーマの最小スタブ（delivery_photo_v0.sql の全文適用を通すためだけの最小限。
  -- 実オブジェクトのRLS実効性はここでは検証しない＝auth_rls_remaining_v1/pglite_test_storage.mjs と同方式）
  create schema storage;
  create table storage.buckets (
    id text primary key, name text, public boolean,
    file_size_limit bigint, allowed_mime_types text[]
  );
  create table storage.objects (id bigint generated always as identity primary key, bucket_id text, name text);
  create or replace function storage.foldername(name text) returns text[] language sql immutable as $$
    select (string_to_array(name, '/'))[1 : array_length(string_to_array(name, '/'), 1) - 1]
  $$;
  alter table storage.objects enable row level security;
  grant usage on schema storage to authenticated;
  grant select, insert on storage.objects to authenticated;
`);

// 依存記録口＋本体を適用
await db.exec(readFileSync(new URL('../status_log_v0/status_log_v0.sql', import.meta.url), 'utf8'));
await db.exec(readFileSync(new URL('../status_log_v0/record_status_transition_v0.sql', import.meta.url), 'utf8'));
await db.exec(readFileSync(new URL('../delivery_result_v0/delivery_result_v0.sql', import.meta.url), 'utf8'));

// delivery_photo_v0.sql: ⑥の確認クエリ（pg_policies等）は末尾に含まれるが postgres専用の情報照会でしかない
// ため、そのまま流してもpgliteで害はない（結果は捨てる）。全文が例外なく適用できることを確認する。
let applyOk = true;
try {
  await db.exec(readFileSync(new URL('./delivery_photo_v0.sql', import.meta.url), 'utf8'));
} catch (e) {
  applyOk = false;
  console.error('delivery_photo_v0.sql 適用時エラー:', e.message);
}
ok('delivery_photo_v0.sql が例外なく適用できる（Storageスタブ込み）', applyOk);

console.log('\n[0. スキーマ確認：旧photo_path列が消えている・delivery_photos表＋RLS・Storageポリシー2件]');
{
  const oldCol = await db.query(
    `select count(*)::int n from information_schema.columns where table_schema='public' and table_name='delivery_results' and column_name='photo_path'`
  );
  ok('旧 delivery_results.photo_path 列は残っていない（0）', oldCol.rows[0].n === 0);

  const cols = await db.query(
    `select column_name from information_schema.columns where table_schema='public' and table_name='delivery_photos' order by ordinal_position`
  );
  const colNames = cols.rows.map((r) => r.column_name);
  ok(
    'delivery_photos 表に想定の列がある',
    ['id', 'result_id', 'tracking_number', 'driver_id', 'seq', 'photo_path', 'recorded_at', 'created_by'].every((c) =>
      colNames.includes(c)
    )
  );

  const tablePol = await db.query(
    `select policyname, cmd from pg_policies where schemaname='public' and tablename='delivery_photos'`
  );
  ok('delivery_photos のRLSポリシーは1件（SELECTのみ）', tablePol.rows.length === 1 && tablePol.rows[0].cmd === 'SELECT');

  const pol = await db.query(
    `select policyname from pg_policies where schemaname='storage' and tablename='objects' and policyname in ('delivery_photos_insert','delivery_photos_select')`
  );
  ok('Storageポリシーが2件（insert/select）登録されている', pol.rows.length === 2);
}

const call = (tn, seq, path) => db.query(`select public.attach_delivery_photo($1,$2,$3) r`, [tn, seq, path]);
const clear = (tn) => db.query(`select public.clear_delivery_photos($1) r`, [tn]);
const photosOf = async (tn) =>
  (await db.query(`select seq, photo_path from public.delivery_photos where tracking_number=$1 order by seq`, [tn])).rows;
const objectCount = async (prefix) =>
  (
    await db.query(`select count(*)::int n from storage.objects where bucket_id='delivery-photos' and name like $1`, [
      prefix + '%',
    ])
  ).rows[0].n;

// まず DRV001/DRV002 として record_delivery_result 経由で delivery_results 行を作る
// （attach_delivery_photo は delivery_results 行の存在＋所有者一致が前提のため）
await asUser(DRV1, async () => {
  await db.query(`select public.record_delivery_result($1,'完了')`, ['900000000401']);
  await db.query(`select public.record_delivery_result($1,'完了')`, ['900000000403']);
  await db.query(`select public.record_delivery_result($1,'完了')`, ['900000000404']);
  await db.query(`select public.record_delivery_result($1,'不在')`, ['900000000406']);
  await db.query(`select public.record_delivery_result($1,'完了')`, ['900000000408']);
}, { commit: true });
await asUser(DRV2, async () => {
  await db.query(`select public.record_delivery_result($1,'完了')`, ['900000000402']);
  await db.query(`select public.record_delivery_result($1,'不在')`, ['900000000407']);
}, { commit: true });

console.log('\n[1. 本人紐付けOK：DRV001が自分のフォルダ配下・厳密一致のパスをattach（seq=1,2,3） → recorded]');
await asUser(DRV1, async () => {
  const r1 = (await call('900000000401', 1, 'DRV001/900000000401/1.jpg')).rows[0].r;
  ok('seq=1 result=recorded', r1.result === 'recorded');
  const r2 = (await call('900000000401', 2, 'DRV001/900000000401/2.jpg')).rows[0].r;
  ok('seq=2 result=recorded', r2.result === 'recorded');
  const r3 = (await call('900000000401', 3, 'DRV001/900000000401/3.jpg')).rows[0].r;
  ok('seq=3 result=recorded', r3.result === 'recorded');
}, { commit: true });
const photos401 = await photosOf('900000000401');
ok('delivery_photos に3行（seq1〜3）保存されている', photos401.length === 3);
ok('パスが期待どおり', photos401.every((p, i) => p.photo_path === `DRV001/900000000401/${i + 1}.jpg`));

console.log('\n[2. 冪等：同一seq×同一パスの再送 → already・値は変わらない]');
await asUser(DRV1, async () => {
  const r = (await call('900000000401', 1, 'DRV001/900000000401/1.jpg')).rows[0].r;
  ok('result=already', r.result === 'already');
}, { commit: true });
ok('delivery_photos は3行のまま（増えない）', (await photosOf('900000000401')).length === 3);

console.log('\n[3. 既に別の写真がある枠(seq)への上書きは拒否（P0001＝明示エラー・23505ではない）]');
// 注: 通常のRPC経路ではパスが{driver_id}/{tracking_number}/{seq}.jpgに厳密決定される（MED-3対応）ため、
//   「同一seqに異なるパスを渡す」こと自体がパス検証（42501）で先に弾かれ、この分岐には通常到達しない。
//   ここでは「何らかの理由でズレたパスの行が既に存在する」データ不整合を想定した防御的分岐として、
//   直接INSERT（postgres・RLSバイパス）で再現して検証する。
await db.exec(`
  insert into public.delivery_photos (result_id, tracking_number, driver_id, seq, photo_path, created_by)
  select id, '900000000403', 'DRV001', 1, 'DRV001/900000000403/1_inconsistent.jpg', null
  from public.delivery_results where tracking_number='900000000403' order by id desc limit 1;
`);
await asUser(DRV1, async () => {
  await throwsCode(
    '既存行のパスが期待値と食い違う場合はattachを拒否（P0001・防御的分岐）',
    'P0001',
    () => call('900000000403', 1, 'DRV001/900000000403/1.jpg') // 期待どおりの正しいパスを渡しても、既存行と食い違うため拒否
  );
});
ok(
  '既存の（不整合な）pathは書き換わっていない（上書き防止）',
  (await photosOf('900000000403')).find((p) => p.seq === 1)?.photo_path === 'DRV001/900000000403/1_inconsistent.jpg'
);
await db.exec(`delete from public.delivery_photos where tracking_number='900000000403' and seq=1;`); // 後続テストのため後始末

console.log('\n[4. 枚数上限：seqは1〜3のみ（0や4は23514で拒否＝3枚を超える枠を作れない）]');
await asUser(DRV1, async () => {
  await throwsCode('seq=0は拒否', '23514', () => call('900000000401', 0, 'DRV001/900000000401/0.jpg'));
});
await asUser(DRV1, async () => {
  await throwsCode('seq=4は拒否（最大3枚）', '23514', () => call('900000000401', 4, 'DRV001/900000000401/4.jpg'));
});
ok('delivery_photos は3行のまま', (await photosOf('900000000401')).length === 3);

console.log('\n[5. 他人拒否：DRV001がDRV002所有の delivery_results 行にattach → 42501]');
await asUser(DRV1, async () => {
  await throwsCode('DRV001 は DRV002 所有の実績にattachできない', '42501', () =>
    call('900000000402', 1, 'DRV001/900000000402/1.jpg')
  );
});
ok('T4は未attachのまま', (await photosOf('900000000402')).length === 0);

console.log('\n[6. MED-3対応：パスは {driver_id}/{tracking_number}/{seq}.jpg に厳密一致（前方一致では不十分）]');
await asUser(DRV1, async () => {
  await throwsCode('他人（DRV002）のフォルダを指すパスは拒否', '42501', () =>
    call('900000000403', 1, 'DRV002/900000000403/1.jpg')
  );
});
await asUser(DRV1, async () => {
  await throwsCode('ルート直下（フォルダ無し）のパスは拒否', '42501', () => call('900000000403', 1, '900000000403.jpg'));
});
await asUser(DRV1, async () => {
  // ★MED-3の核心：driver_idは自分のものだが、別のtracking_numberフォルダを指すパス（使い回し／誤紐付け）は拒否
  await throwsCode(
    '★自分のフォルダだが別tracking_numberを指すパスは拒否（誤紐付け防止）',
    '42501',
    () => call('900000000403', 1, 'DRV001/900000000401/1.jpg') // 401は自分の別配達の実際のパス
  );
});
await asUser(DRV1, async () => {
  // ★seq偽装：パス内のseqとp_seq引数が食い違う場合も拒否
  await throwsCode('★パス内seqと引数p_seqの不一致は拒否（seq偽装防止）', '42501', () =>
    call('900000000403', 1, 'DRV001/900000000403/2.jpg')
  );
});
ok('T5は未attachのまま', (await photosOf('900000000403')).length === 0);

console.log('\n[7. 非driver拒否：area/hq/shipper/anon は attach_delivery_photo を呼べない → 42501]');
await asUser(AREA_A1, async () => {
  await throwsCode('area は attach_delivery_photo を呼べない', '42501', () =>
    call('900000000404', 1, 'A01/900000000404/1.jpg')
  );
});
await asUser(HQ1, async () => {
  await throwsCode('hq は attach_delivery_photo を呼べない', '42501', () => call('900000000404', 1, 'x/x/1.jpg'));
});
await asUser(SHIP1, async () => {
  await throwsCode('shipper は attach_delivery_photo を呼べない', '42501', () => call('900000000404', 1, 'x/x/1.jpg'));
});
await asAnon(async () => {
  await throwsCode('anon は attach_delivery_photo を呼べない（GRANT無し）', '42501', () =>
    call('900000000404', 1, 'x/x/1.jpg')
  );
});
ok('T7は未attachのまま', (await photosOf('900000000404')).length === 0);

console.log('\n[8. delivery_results 未存在は拒否 → P0002]');
await asUser(DRV1, async () => {
  await throwsCode('delivery_results 行が無い問合番号は拒否', 'P0002', () =>
    call('900000000405', 1, 'DRV001/900000000405/1.jpg')
  );
});

console.log('\n[9. clear_delivery_photos：日内再訪（不在）時のみ許可・旧オブジェクト/行を削除して新規3枠にする]');
// 実アップロードの代役として、対象パス＋紛らわしい別バケット風の名前を持つ行を直接投入しておく
await db.exec(`
  insert into storage.objects (bucket_id, name) values
    ('delivery-photos','DRV001/900000000406/1.jpg'),
    ('delivery-photos','DRV001/900000000406/2.jpg'),
    ('delivery-photos','other-bucket/DRV001/900000000406/1.jpg');
`);
await asUser(DRV1, async () => {
  const r1 = (await call('900000000406', 1, 'DRV001/900000000406/1.jpg')).rows[0].r;
  ok('T-clear①：1枚目attach成功', r1.result === 'recorded');
  const r2 = (await call('900000000406', 2, 'DRV001/900000000406/2.jpg')).rows[0].r;
  ok('T-clear①：2枚目attach成功', r2.result === 'recorded');
}, { commit: true });
ok('clear前：delivery_photos 2行', (await photosOf('900000000406')).length === 2);
ok('clear前：storage.objects に DRV001/900000000406/ 配下2件', (await objectCount('DRV001/900000000406/')) === 2);

console.log('\n[9a. 安全装置：status=完了（不在ではない）の荷物へのclearは拒否]');
await asUser(DRV1, async () => {
  await throwsCode('完了状態のclearは拒否（不在からの再配達時のみ許可）', '42501', () => clear('900000000408'));
});

console.log('\n[9b. 他人拒否：DRV001がDRV002所有(不在)の写真をclearできない]');
await asUser(DRV1, async () => {
  await throwsCode('DRV001 は DRV002 所有の荷物をclearできない', '42501', () => clear('900000000407'));
});

console.log('\n[9c. 未存在拒否：存在しない問合番号のclearはP0002]');
await asUser(DRV1, async () => {
  await throwsCode('存在しない問合番号のclearはP0002', 'P0002', () => clear('900000000499'));
});

console.log('\n[9d. 本人・不在状態でのclear成功：旧オブジェクト（自バケット内一致分のみ）とdelivery_photos行が消える]');
await asUser(DRV1, async () => {
  const r = (await clear('900000000406')).rows[0].r;
  ok('result=cleared', r.result === 'cleared');
  ok('objects_deleted=2', r.objects_deleted === 2);
  ok('rows_deleted=2', r.rows_deleted === 2);
}, { commit: true });
ok('clear後：delivery_photos 0行', (await photosOf('900000000406')).length === 0);
ok('clear後：DRV001/900000000406/ 配下のstorage.objectsは0件', (await objectCount('DRV001/900000000406/')) === 0);
ok(
  '★別バケット風の紛らわしい名前(other-bucket/...)は消えずに残る（prefix一致のみ削除）',
  (await objectCount('other-bucket/DRV001/900000000406/')) === 1
);

console.log('\n[9e. clear後：同じパスへの再attachが「新規3枠」として成功する（already/衝突にならない）]');
await asUser(DRV1, async () => {
  const r = (await call('900000000406', 1, 'DRV001/900000000406/1.jpg')).rows[0].r;
  ok('★clear後の再attachはrecorded（旧行が本当に消えている証拠）', r.result === 'recorded');
}, { commit: true });
ok('delivery_photos 1行（再attach分のみ）', (await photosOf('900000000406')).length === 1);

console.log(`\ndelivery_photo pglite: ${pass} passed, ${fail} failed`);
await db.close();
if (fail > 0) process.exit(1);
