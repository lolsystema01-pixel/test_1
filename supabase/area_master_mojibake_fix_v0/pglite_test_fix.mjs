// pglite E2E: fix_area_master_mojibake_v0.sql（①-b UPDATE ＋ ①-c DELETE）の方式検証
//   確認結果メモの「pglite 9/9（破損を再現→生成UPDATE適用で U+FFFD 0件・値一致・
//   オトリ健全行不変・破損行のみDELETE）」に対応するテスト（本体は実データ43行ハードコードのため、
//   ここでは fix SQL と同一の作法〔intact列 WHERE ＋ 対象列の U+FFFD ガード・ctid非依存〕を
//   代表行で再現して検証する）。
// 実行: node supabase/area_master_mojibake_fix_v0/pglite_test_fix.mjs
import { PGlite } from '../../node_modules/@electric-sql/pglite/dist/index.js';

const FFFD = String.fromCharCode(65533);
let pass = 0, fail = 0;
const ok = (n, c) => (c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.error(`  ✗ ${n}`)));
const one = async (db, q, p=[]) => (await db.query(q, p)).rows[0];

const db = new PGlite();
// area_master_schema_v0.sql と同じ列構成（最小）
await db.exec(`
  create table public.area_master_staging (
    prefecture text, municipality text, town text, chome text, zone_no text,
    common_id text, is_valid text, priority text, area text, depot text,
    src_town_key text, postal_code text
  );
  create table public.area_master (
    town_key text primary key, prefecture text, municipality text, town text, chome text,
    zone_no integer, common_id text, area text, depot text, source_town_key text,
    postal_code text, is_valid boolean not null default true, priority integer
  );
`);

// staging: 破損3行（is_valid化け／depot化け／area化け＝原本CSVでのみ裏取りの3種）
//   ＋ オトリ健全行（同じ町名だが common_id 違い＝WHERE不一致で触られないこと）
//   ＋ 完全健全行（U+FFFD 無し＝ガードで触られないこと）
await db.query(
  `insert into public.area_master_staging
     (prefecture, municipality, town, common_id, src_town_key, is_valid, depot, area) values
   ($1,$2,$3,$4,$5,$6,$7,$8),
   ($9,$10,$11,$12,$13,$14,$15,$16),
   ($17,$18,$19,$20,$21,$22,$23,$24),
   ($25,$26,$27,$28,$29,$30,$31,$32),
   ($33,$34,$35,$36,$37,$38,$39,$40)`,
  [
    // (1) is_valid が化けた行（長崎県|壱岐市）
    '長崎県','壱岐市','勝本町本宮仲触','IKI_C_35_36','長崎県|壱岐市|勝本町本宮仲触', `有${FFFD}`, '長崎県','U-IKI-01',
    // (2) depot が化けた行（宮城県|石巻市）
    '宮城県','石巻市','川口町','ISI_C_143_147','宮城県|石巻市|川口町','有効', `宮城${FFFD}`, 'U-ISI-01',
    // (3) area が化けた行（鳥取県|智頭町）
    '鳥取県','智頭町','口宇波','CHZ_C_105_105','鳥取県|智頭町|口宇波','有効','鳥取県', `U-CHZ${FFFD}`,
    // (4) オトリ: (1)と同じ町名だが common_id 違い＝intact列WHERE で一致しない → 不変
    '長崎県','壱岐市','勝本町本宮仲触','IKI_C_99_99','長崎県|壱岐市|勝本町本宮仲触','有効','長崎県','U-IKI-99',
    // (5) 完全健全行（U+FFFD 無し）＝ガード（対象列 like %FFFD%）で拾わない → 不変
    '岐阜県','岐阜市','清水','GIF_C_01_02','岐阜県|岐阜市|清水','有効','岐阜県','U-GIF-01',
  ]
);

// area_master: town_key が化けた破損行 ＋ 健全行
await db.query(
  `insert into public.area_master (town_key, prefecture, municipality, town, common_id, is_valid) values
   ($1,$2,$3,$4,$5,true), ($6,$7,$8,$9,$10,true)`,
  [
    `岐阜県|岐阜市|清${FFFD}`, '岐阜県','岐阜市','清水','GIF_C_01_02',   // 破損（town_key に U+FFFD）
    '愛知県|岡崎市|箱柳町', '愛知県','岡崎市','箱柳町','OKZ_C_01_06',      // 健全
  ]
);

// ---- ①-b: staging の破損セルを原本値で個別UPDATE（fix SQL と同一作法） ----
// (1) is_valid → '有効'
await db.exec(`update public.area_master_staging set is_valid = '有効'
  where prefecture='長崎県' and municipality='壱岐市' and town='勝本町本宮仲触'
    and common_id='IKI_C_35_36' and src_town_key='長崎県|壱岐市|勝本町本宮仲触'
    and is_valid like '%' || chr(65533) || '%';`);
// (2) depot → '宮城県'
await db.exec(`update public.area_master_staging set depot = '宮城県'
  where prefecture='宮城県' and municipality='石巻市' and town='川口町'
    and common_id='ISI_C_143_147' and src_town_key='宮城県|石巻市|川口町'
    and depot like '%' || chr(65533) || '%';`);
// (3) area → 'U-CHZ-01'
await db.exec(`update public.area_master_staging set area = 'U-CHZ-01'
  where prefecture='鳥取県' and municipality='智頭町' and town='口宇波'
    and common_id='CHZ_C_105_105' and src_town_key='鳥取県|智頭町|口宇波'
    and area like '%' || chr(65533) || '%';`);

// ---- 検証（9項目） ----
const stagingFFFD = async () => (await one(db, `
  select count(*)::int as n from public.area_master_staging s
  where s.prefecture like $1 or s.municipality like $1 or s.town like $1 or s.common_id like $1
     or s.is_valid like $1 or s.depot like $1 or s.area like $1 or s.src_town_key like $1`,
  ['%'+FFFD+'%'])).n;

ok('1. staging: 破損セルの U+FFFD が 0件になった', (await stagingFFFD()) === 0);
ok('2. is_valid が原本値「有効」に修正された',
   (await one(db, `select is_valid from public.area_master_staging where common_id='IKI_C_35_36'`)).is_valid === '有効');
ok('3. depot が原本値「宮城県」に修正された',
   (await one(db, `select depot from public.area_master_staging where common_id='ISI_C_143_147'`)).depot === '宮城県');
ok('4. area が原本値「U-CHZ-01」に修正された',
   (await one(db, `select area from public.area_master_staging where common_id='CHZ_C_105_105'`)).area === 'U-CHZ-01');
ok('5. オトリ健全行（同町名・common_id違い）は WHERE不一致で不変',
   (await one(db, `select is_valid from public.area_master_staging where common_id='IKI_C_99_99'`)).is_valid === '有効');
ok('6. 完全健全行（U+FFFD無し）はガードで拾われず不変',
   (await one(db, `select area from public.area_master_staging where common_id='GIF_C_01_02'`)).area === 'U-GIF-01');

// ---- ①-c: area_master の破損行を U+FFFD ガードで DELETE（town_key が壊れ upsert では消えない） ----
const amBefore = (await one(db, `select count(*)::int as n from public.area_master`)).n;
await db.exec(`delete from public.area_master a
  where a.town_key like '%' || chr(65533) || '%' or a.prefecture like '%' || chr(65533) || '%'
     or a.municipality like '%' || chr(65533) || '%' or a.town like '%' || chr(65533) || '%'
     or a.common_id like '%' || chr(65533) || '%';`);
const amAfter = (await one(db, `select count(*)::int as n from public.area_master`)).n;

ok('7. area_master: 破損行だけ DELETE された（2→1）', amBefore === 2 && amAfter === 1);
ok('8. area_master: 健全行（箱柳町）は残っている',
   (await one(db, `select count(*)::int as n from public.area_master where common_id='OKZ_C_01_06'`)).n === 1);
ok('9. area_master: U+FFFD を含む行が 0件になった',
   (await one(db, `select count(*)::int as n from public.area_master a
     where a.town_key like $1 or a.prefecture like $1 or a.municipality like $1
        or a.town like $1 or a.common_id like $1`, ['%'+FFFD+'%'])).n === 0);

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
await db.close();
process.exit(fail ? 1 : 0);
