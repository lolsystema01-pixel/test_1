-- =============================================================
-- エリアマスタ取込 v0.1 確認SQL
-- 実行: area_master_load_v0.sql（本実行）の後。
-- =============================================================

-- ① 件数・town_key 一意性（PKなので重複0が保証）・zone_no 欠損率 --------------
select
  count(*)                                   as rows,
  count(distinct town_key)                   as distinct_town_keys,   -- = rows
  count(*) filter (where zone_no is null)     as zone_no_null,
  round(100.0 * count(*) filter (where zone_no is null) / nullif(count(*),0), 1) as zone_no_null_pct,
  count(*) filter (where common_id is null)   as common_id_null       -- 0 のはず（取込で除外）
from public.area_master;

-- ② 廃止列が無いこと（親バッグ/バッグ番号/ユニット番号）----------------------
select string_agg(column_name, ', ' order by ordinal_position) as area_master_columns
from information_schema.columns
where table_schema='public' and table_name='area_master';
-- 期待: town_key,prefecture,municipality,town,chome,zone_no,common_id,area,depot,source_town_key,postal_code,is_valid,priority
--       ＝ 親バッグ/バッグ番号/ユニット番号 を含まない（拠点=depot・TownKey=source_town_key・エリア=area・郵便番号=postal_code は保持）。

-- ③ サンプル一致（岡崎市 箱柳町 → common_id/zone_no）------------------------
select town_key, town, common_id, zone_no
from public.area_master
where municipality = '岡崎市' and town like '箱柳町%'
order by town;
-- 期待: 箱柳町（その他）→ common_id OKZ_C_01_06 / zone_no 1（現行エリアマスタの値）。

-- ④ 直lookup の疎通（住所→町キー前方一致で common_id/zone_no が引けるか）------
--    ダミー住所で確認（実データは deliveries で common_id付与v0.4 が使う）。
with probe(addr) as (values ('愛知県岡崎市箱柳町12-3'))
select p.addr,
  (select a.common_id from public.area_master a
    where public.normalize_addr(p.addr) like a.town_key || '%'
    order by length(a.town_key) desc limit 1) as common_id,
  (select a.zone_no from public.area_master a
    where public.normalize_addr(p.addr) like a.town_key || '%'
    order by length(a.town_key) desc limit 1) as zone_no
from probe p;
-- 期待: common_id/zone_no が返る（前方一致・最長一致）。
