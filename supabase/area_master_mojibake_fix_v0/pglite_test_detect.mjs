// pglite E2E: detect_mojibake_v0.sql（①-a 破損行特定・SELECTのみ）
//   検証: U+FFFD を仕込んだ行だけを、正しい broken_cols 付きで検出する／intact 行は拾わない。
// 実行: node supabase/area_master_mojibake_fix_v0/pglite_test_detect.mjs
import { PGlite } from '../../node_modules/@electric-sql/pglite/dist/index.js';

const db = new PGlite();
let pass = 0, fail = 0;
const ok = (n, c) => (c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.error(`  ✗ ${n}`)));
const FFFD = String.fromCharCode(65533); // U+FFFD

// area_master_schema_v0.sql と同じ列構成（最小・検証用）
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

// staging: 3行健全 + 2行破損（town 1件・src_town_key 1件）
await db.query(
  `insert into public.area_master_staging
     (depot, src_town_key, prefecture, municipality, town, chome, area, zone_no, is_valid, priority, common_id, postal_code)
   values
     ('愛知県1','愛知県|岡崎市|高隆寺町','愛知県','岡崎市','高隆寺町','','愛知県1','1','有効','7','OKZ_C_01_06',''),
     ('愛知県1','愛知県|岡崎市|保母町','愛知県','岡崎市','保母町','','愛知県1','1','有効','7','OKZ_C_01_06',''),
     ('富山県','富山県|下新川郡朝日町|大家庄','富山県','下新川郡朝日町','大家庄','','富山県','3','有効','5','TYM_A_02','939'),
     -- 破損1: town セルだけ U+FFFD（1行1フィールドのみ破損）。src_town_key は健全だが突合には使わない
     ('富山県','富山県|下新川郡朝日町|大家庄','富山県','下新川郡朝日町','${FFFD}','','富山県','3','有効','5','TYM_A_09','939'),
     -- 破損2: src_town_key セルが U+FFFD（intact 住所列は健全）
     ('福岡県','${FFFD}','福岡県','豊前市','中村','','福岡県','2','有効','6','FKO_B_03','828')`);

// area_master: 2行健全 + 1行 town_key(PK) 破損
await db.query(
  `insert into public.area_master
     (town_key, prefecture, municipality, town, chome, zone_no, common_id, area, depot, source_town_key, postal_code, is_valid, priority)
   values
     ('愛知県岡崎市高隆寺町','愛知県','岡崎市','高隆寺町','',1,'OKZ_C_01_06','愛知県1','愛知県1','愛知県|岡崎市|高隆寺町','',true,7),
     ('富山県下新川郡朝日町大家庄','富山県','下新川郡朝日町','大家庄','',3,'TYM_A_02','富山県','富山県','富山県|下新川郡朝日町|大家庄','939',true,5),
     ('富山県下新川郡朝日町${FFFD}','富山県','下新川郡朝日町','${FFFD}','',3,'TYM_A_09','富山県','富山県','富山県|下新川郡朝日町|大家庄','939',true,5)`);

// detect の §2 に相当（staging 破損詳細）
const stg = (await db.query(`
  with p as (select '%' || chr(65533) || '%' as m),
  scan as (
    select s.ctid,
      array_remove(array[
        case when s.prefecture   like p.m then 'prefecture'   end,
        case when s.municipality like p.m then 'municipality' end,
        case when s.town         like p.m then 'town'         end,
        case when s.chome        like p.m then 'chome'        end,
        case when s.zone_no      like p.m then 'zone_no'      end,
        case when s.common_id    like p.m then 'common_id'    end,
        case when s.is_valid     like p.m then 'is_valid'     end,
        case when s.priority     like p.m then 'priority'     end,
        case when s.area         like p.m then 'area'         end,
        case when s.depot        like p.m then 'depot'        end,
        case when s.src_town_key like p.m then 'src_town_key' end,
        case when s.postal_code  like p.m then 'postal_code'  end
      ], null) as broken_cols,
      s.common_id, s.postal_code, s.prefecture, s.municipality, s.town
    from public.area_master_staging s, p
  )
  select * from scan where cardinality(broken_cols) > 0 order by broken_cols
`)).rows;

ok(`staging 破損=2行検出（実 ${stg.length}）`, stg.length === 2);
{
  const townRow = stg.find(r => r.broken_cols.includes('town'));
  ok('破損1: broken_cols=[town]（1列だけ）', townRow && townRow.broken_cols.length === 1 && townRow.broken_cols[0] === 'town');
  ok('破損1: intact の common_id/postal_code が健全（原本突合キーに使える）',
     townRow && townRow.common_id === 'TYM_A_09' && townRow.postal_code === '939' && !townRow.common_id.includes(FFFD));
  const srcRow = stg.find(r => r.broken_cols.includes('src_town_key'));
  ok('破損2: broken_cols=[src_town_key]（住所列は健全）',
     srcRow && srcRow.broken_cols.length === 1 && srcRow.town === '中村' && srcRow.municipality === '豊前市');
}

// detect の §3 に相当（area_master 破損詳細）
const am = (await db.query(`
  with p as (select '%' || chr(65533) || '%' as m),
  scan as (
    select a.ctid,
      array_remove(array[
        case when a.town_key        like p.m then 'town_key'        end,
        case when a.town            like p.m then 'town'            end,
        case when a.common_id       like p.m then 'common_id'       end
      ], null) as broken_cols,
      a.town_key, a.common_id, a.municipality
    from public.area_master a, p
  )
  select * from scan where cardinality(broken_cols) > 0
`)).rows;
ok(`area_master 破損=1行検出（実 ${am.length}）`, am.length === 1);
ok('area_master: town_key(PK) が破損列に含まれる（ctid DELETE 対象）',
   am[0]?.broken_cols.includes('town_key') && am[0]?.common_id === 'TYM_A_09');

// intact 行は拾わない（誤検出なし）
const total = (await db.query(`
  with p as (select '%' || chr(65533) || '%' as m)
  select
    (select count(*) from public.area_master_staging s where s.town like p.m or s.src_town_key like p.m) as stg,
    (select count(*) from public.area_master a where a.town_key like p.m or a.town like p.m) as am
  from p`)).rows[0];
ok('誤検出なし: 健全行は拾わない（staging=2 / am=1 のみ）', Number(total.stg) === 2 && Number(total.am) === 1);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
