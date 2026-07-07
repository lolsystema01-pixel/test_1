-- =============================================================
-- エリアマスタ取込 v0.1 — ② staging → area_master 確定（正規化・有効・優先度・upsert）
-- 実行: Supabase SQL Editor。前提=area_master_schema_v0.sql・staging へCSVロード済み。
--   ★まず【A. dry-run】で件数確認 → 問題なければ【B. 本実行】。冪等（再実行で件数安定）。
-- =============================================================
-- 確定ルール:
--   ・town_key = normalize_addr(都道府県+自治体+町名)（①と同一関数）。
--   ・有効のみ採用（is_valid が '有効'/TRUE/1/t）。common_id 空は除外。
--   ・zone_no は数値抽出（'1.0'→1）。数値でない行は zone_no=NULL。
--   ・同一 town_key 複数 → 【勝ちルール（要確認）】優先度の小さい方を採用（同値/無しは最終行）。
-- =============================================================

-- 有効判定・数値化のための共通ビュー（dry-run/本実行で使い回す）
create or replace view public.area_master_norm as
select
  -- 突合キー：都道府県+自治体+町名（★町名の「（…）」＝（その他）等は除去して実住所に前方一致させる）
  public.normalize_addr(
    coalesce(s.prefecture,'') || coalesce(s.municipality,'') ||
    regexp_replace(coalesce(s.town,''), '（[^）]*）', '', 'g')
  ) as town_key,
  s.prefecture, s.municipality, s.town, s.chome,
  case when s.zone_no ~ '^\s*[0-9]+(\.[0-9]+)?\s*$' then floor(btrim(s.zone_no)::numeric)::int else null end as zone_no,
  nullif(btrim(s.common_id),'')     as common_id,
  nullif(btrim(s.area),'')          as area,
  nullif(btrim(s.depot),'')         as depot,
  nullif(btrim(s.src_town_key),'')  as source_town_key,
  nullif(regexp_replace(coalesce(s.postal_code,''),'[^0-9]','','g'),'') as postal_code,  -- 郵便番号は数字のみ
  (btrim(coalesce(s.is_valid,'')) in ('有効','TRUE','true','1','t','True','有'))                 as is_valid,
  case when s.priority ~ '^\s*[0-9]+(\.[0-9]+)?\s*$' then floor(btrim(s.priority)::numeric)::int else null end as priority
from public.area_master_staging s;


-- =====================  A. dry-run（書き込まない）  ==========
select
  (select count(*) from public.area_master_staging)                                        as staging_rows,
  (select count(*) from public.area_master_norm where is_valid and common_id is not null)   as valid_rows,
  (select count(distinct town_key) from public.area_master_norm
     where is_valid and common_id is not null and town_key <> '')                           as distinct_town_keys,
  (select count(*) from public.area_master_norm
     where is_valid and common_id is not null and zone_no is null)                          as zone_no_missing;
-- 期待: valid_rows ≒ 取込対象、distinct_town_keys ≦ valid_rows（重複は優先度で1件化）、zone_no_missing は把握用。


-- =====================  B. 本実行（upsert）  ================
insert into public.area_master (town_key, prefecture, municipality, town, chome, zone_no, common_id, area, depot, source_town_key, postal_code, is_valid, priority)
select distinct on (town_key)
  town_key, prefecture, municipality, town, chome, zone_no, common_id, area, depot, source_town_key, postal_code, is_valid, priority
from public.area_master_norm
where is_valid and common_id is not null and town_key <> ''
order by town_key, priority asc nulls last     -- ★勝ちルール：優先度の小さい方（要確認）。同値/無しは物理順
on conflict (town_key) do update set
  prefecture      = excluded.prefecture,
  municipality    = excluded.municipality,
  town            = excluded.town,
  chome           = excluded.chome,
  zone_no         = excluded.zone_no,
  common_id       = excluded.common_id,
  area            = excluded.area,
  depot           = excluded.depot,
  source_town_key = excluded.source_town_key,
  postal_code     = excluded.postal_code,
  is_valid        = excluded.is_valid,
  priority        = excluded.priority;

-- 確定件数
select count(*) as area_master_rows, count(*) filter (where zone_no is null) as zone_no_null
from public.area_master;
