-- =============================================================
-- 全国Master／ZonePlan 読込 v0.4（重複排除＋件数集計）
-- 実行: SQL Editor。create_master_v0.sql → reset_prev_master_v0.sql の後。
--   ★ このファイルを「2回」Run して重複排除を検証（1回目=投入、2回目=全件スキップ）。
-- 入力CSV: zenkoku_master_dummy.csv（14行）/ zenkoku_zoneplan_dummy.csv（8行）
--   ※【AI】が同内容を staging に seed として投入する。
-- =============================================================

-- ⚠⚠ RETIRED（2026-07-17・Master部分のみ）: address_master と master_staging は撤去済み（⑤）。
--   → **このファイルは今のままでは §1 の truncate で落ちます**（master_staging が存在しないため）。
--   ・全国Master の読込（§3・§6 の master_staging → address_master）は **retire**。後継は area_master_v0/。
--   ・**ZonePlan の読込（§2・§5）は現役**（zoneplan_staging → zone_plan。dispatch_v0 が
--     zoneplan_staging から分割閾値を読むため生きている）。
--   ★ zone_plan を再ロードしたい場合は、master_staging 側の行（下の truncate・§3・§6）を
--     読み飛ばし、ZonePlan の §2・§5 だけを選択実行してください。
--   ⚠ ただし zone_plan は②で **新語彙1,653件** が入っています。このファイルの ZonePlan seed は
--     **旧語彙の愛知ダミー8件**（§4 のハードコード）なので、素直に流すと旧語彙が復活し、
--     ゲート seq 7・8 が再び赤くなります（⑤の案aで掃除した行が戻る）。
--   経緯: supabase/vocab_fix_v0/README.md
-- =============================================================

-- §1. ステージングを毎回リセット --------------------------------
-- truncate public.master_staging;   -- RETIRED: master_staging は⑤で drop 済み
truncate public.zoneplan_staging;

-- §2. ZonePlan CSV を staging へ ------------------------------
insert into public.zoneplan_staging
  (common_id, depot, area, municipality, zone_from, zone_to, group_name, adjacent_raw, split_threshold, priority) values
 ('OKZ_C_01_08','D01','D01','岡崎市','1','8','岡崎-中央','岡崎-東,岡崎-西,岡崎-山','174','7'),
 ('OKZ_E_05_12','D01','D01','岡崎市','5','12','岡崎-東','岡崎-中央,岡崎-西,岡崎-山','174','7'),
 ('OKZ_W_13_18','D01','D01','岡崎市','13','18','岡崎-西','岡崎-中央,岡崎-東,岡崎-山','174','7'),
 ('OKZ_S_14_24','D01','D01','岡崎市','14','24','岡崎-山','岡崎-中央,岡崎-東,岡崎-西','174','7'),
 ('TYT_C_25_36','D01','D01','豊田市','25','36','豊田-中央','豊田-西,豊田-東,豊田-山','191','7'),
 ('TYT_W_32_40','D01','D01','豊田市','32','40','豊田-西','豊田-中央,豊田-東,豊田-山','191','7'),
 ('TKI_C_03_07','D02','D02','東海市','3','7','東海','知多,大府','206','7'),
 ('CTA_C_06_13','D02','D02','知多市','6','13','知多','東海,大府,半田','153','7');

-- §3. 全国Master CSV を staging へ ----------------------------
insert into public.master_staging
  (depot, town_key, prefecture, municipality, town, chome, common_id, valid) values
 ('D01','愛知県|岡崎市|箱柳町','愛知県','岡崎市','箱柳町','','OKZ_C_01_08','有効'),
 ('D01','愛知県|岡崎市|高隆寺町','愛知県','岡崎市','高隆寺町','','OKZ_C_01_08','有効'),
 ('D01','愛知県|岡崎市|小美町','愛知県','岡崎市','小美町','','OKZ_E_05_12','有効'),
 ('D01','愛知県|岡崎市|明大寺町','愛知県','岡崎市','明大寺町','','OKZ_C_01_08','有効'),
 ('D01','愛知県|岡崎市|戸崎町','愛知県','岡崎市','戸崎町','','OKZ_W_13_18','有効'),
 ('D01','愛知県|岡崎市|鴨田町','愛知県','岡崎市','鴨田町','','OKZ_S_14_24','有効'),
 ('D01','愛知県|豊田市|西町','愛知県','豊田市','西町','','TYT_C_25_36','有効'),
 ('D01','愛知県|豊田市|小坂町','愛知県','豊田市','小坂町','','TYT_C_25_36','有効'),
 ('D01','愛知県|豊田市|神田町','愛知県','豊田市','神田町','','TYT_W_32_40','有効'),
 ('D02','愛知県|東海市|南柴田町','愛知県','東海市','南柴田町','','TKI_C_03_07','有効'),
 ('D02','愛知県|東海市|名和町','愛知県','東海市','名和町','','TKI_C_03_07','有効'),
 ('D02','愛知県|東海市|荒尾町','愛知県','東海市','荒尾町','','TKI_C_03_07','有効'),
 ('D02','愛知県|知多市|八幡','愛知県','知多市','八幡','','CTA_C_06_13','有効'),
 ('D02','愛知県|知多市|新知','愛知県','知多市','新知','','CTA_C_06_13','有効');


-- §4. 件数記録用の一時テーブル --------------------------------
drop table if exists _load_counts;
create temp table _load_counts (tbl text, csv_rows int, unique_rows int, inserted int, existing_dup_skipped int);


-- §5. ZonePlan を読込（共通IDで重複排除・隣接名→共通IDへ変換）---
--   隣接(adjacent_raw)はグループ名なので、staging自身の グループ名→共通ID 対応で変換。
--   スライス外のグループ名（大府・半田・豊田-東/山）は対応が無く除外される。
with zsrc as (
  select distinct on (z.common_id)
    z.common_id,
    z.zone_from as zone_no,                 -- 単一ゾーン番号＝From（範囲は配車側へ）
    z.depot     as depot_code,
    (
      select string_agg(m.common_id, ',' order by m.common_id)
      from unnest(string_to_array(z.adjacent_raw, ',')) as nb(name)
      join public.zoneplan_staging m on btrim(m.group_name) = btrim(nb.name)
    ) as adjacent_zones
  from public.zoneplan_staging z
  order by z.common_id
),
zins as (
  insert into public.zone_plan (common_id, zone_no, depot_code, adjacent_zones, version, is_valid)
  select common_id, zone_no, depot_code, adjacent_zones, 1, true
  from zsrc
  on conflict (common_id) do nothing
  returning common_id
)
insert into _load_counts
select 'zone_plan',
       (select count(*) from public.zoneplan_staging),
       (select count(*) from zsrc),
       (select count(*) from zins),
       (select count(*) from zsrc) - (select count(*) from zins);


-- §6. 全国Master を読込（TownKeyで重複排除）-------------------
with msrc as (
  select distinct on (s.town_key)
    s.town_key,
    s.prefecture,
    s.municipality,
    s.town,
    nullif(btrim(s.chome), '') as chome,    -- 丁目は空→NULL
    s.common_id,
    s.depot as depot_code,
    (s.valid = '有効') as is_valid
  from public.master_staging s
  order by s.town_key
),
mins as (
  insert into public.address_master (town_key, prefecture, municipality, town, chome, common_id, depot_code, version, is_valid)
  select town_key, prefecture, municipality, town, chome, common_id, depot_code, 1, is_valid
  from msrc
  on conflict (town_key) do nothing
  returning town_key
)
insert into _load_counts
select 'address_master',
       (select count(*) from public.master_staging),
       (select count(*) from msrc),
       (select count(*) from mins),
       (select count(*) from msrc) - (select count(*) from mins);


-- §7. 読込件数を表示（1回目=投入 / 2回目=全件スキップ）---------
select * from _load_counts order by tbl;
-- 期待:
--   zone_plan      : csv 8  / unique 8  / inserted 8(1回目)・0(2回目) / skipped 0・8
--   address_master : csv 14 / unique 14 / inserted 14(1回目)・0(2回目)/ skipped 0・14
