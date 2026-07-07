-- =============================================================
-- 共通ID付与 v0.4 — 保留行の再判定・再マッチ（高速版：接頭辞生成＋town_key等値結合）
--   マスタ（area_master）更新後、保留（common_id 未付与）だけを再突合して付け直す。
-- 実行: Supabase SQL Editor。前提=common_id_assign_v0.sql・area_master 更新済み。冪等。
-- =============================================================

-- A. dry-run（保留のうち今なら突合できる件数）
with mx as (select max(length(town_key)) as m from public.area_master),
held as (
  select tracking_number, public.normalize_addr(address) as na
  from public.deliveries where common_id is null and status = '保留'
),
prefixes as (
  select h.tracking_number, left(h.na, gs) as p
  from held h, mx, generate_series(1, least(length(h.na), mx.m)) gs
),
matched as (
  select distinct pr.tracking_number
  from prefixes pr join public.area_master a on a.town_key = pr.p
)
select (select count(*) from held)    as held_total,
       (select count(*) from matched) as now_matchable;

-- B. 本実行（保留のみ再付与→復帰）
with mx as (select max(length(town_key)) as m from public.area_master),
held as (
  select tracking_number, public.normalize_addr(address) as na
  from public.deliveries where common_id is null and status = '保留'
),
prefixes as (
  select h.tracking_number, left(h.na, gs) as p, gs as plen
  from held h, mx, generate_series(1, least(length(h.na), mx.m)) gs
),
cand as (
  select pr.tracking_number, a.common_id, a.zone_no, pr.plen
  from prefixes pr join public.area_master a on a.town_key = pr.p
),
best as (
  select distinct on (tracking_number) tracking_number, common_id, zone_no
  from cand order by tracking_number, plen desc
)
update public.deliveries d
set common_id = b.common_id,
    zone_no   = b.zone_no,
    status    = '未配車'                 -- 保留→未配車に復帰（配車対象へ戻す）
from best b
where b.tracking_number = d.tracking_number
  and b.common_id is not null;

-- 復帰した行の未登録記録を解消（対応済みに）
update public.unregistered_addresses u
set resolved = true, note = coalesce(note,'') || ' [再マッチで解消]'
where u.resolved = false
  and exists (select 1 from public.deliveries d where d.tracking_number = u.tracking_number and d.common_id is not null);

-- 件数
select
  (select count(*) from public.deliveries where status='保留') as still_held,
  (select count(*) from public.deliveries where common_id is not null) as assigned;
