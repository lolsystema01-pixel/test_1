-- =============================================================
-- 指示書: 配車 割当優先順位（希望エリア第一）v0.3 — ⑤ 表示名解決ビュー common_id_display
--   common_id → area・municipality ＋ ゾーン範囲 min(zone_no)〜max(zone_no) を area_master から導出。
--   希望エリア選択UI（シフト v0.7）と #29 配車サマリが「common_id を人間可読名で見せる」ために参照する。
-- 実行: Supabase SQL Editor（postgres）で丸ごと Run。冪等（create or replace view）。
-- =============================================================
-- 【なぜビューで復元するか（指示書⑤）】
--   zone_plan には「ゾーン範囲」が無い。area_master には zone_no(integer) が町丁目単位で入るため、
--   common_id ごとに min(zone_no)〜max(zone_no) を集約して範囲を復元する（列は追加しない＝ビューで導出）。
--   ・area / municipality は「決定的に1つ」に解決する（既存 dispatch_build(2)・delivery_status_public と
--     同じ order by＝priority asc nulls last, town_key の先頭）。同一 common_id が複数町丁目に跨っても一意。
--   ・is_valid=false の行は除外（語彙是正後の健全な行のみ）。
-- =============================================================

create or replace view public.common_id_display as
with ranked as (
  select
    am.common_id,
    am.area,
    am.municipality,
    am.zone_no,
    row_number() over (
      partition by am.common_id
      order by am.priority asc nulls last, am.town_key
    ) as rn
  from public.area_master am
  where am.is_valid and am.common_id is not null
)
select
  common_id,
  max(area)         filter (where rn = 1) as area,          -- 決定的な代表 area（先頭行）
  max(municipality) filter (where rn = 1) as municipality,  -- 決定的な代表 municipality（先頭行）
  min(zone_no) as zone_no_min,                              -- ゾーン範囲の下限
  max(zone_no) as zone_no_max                               -- ゾーン範囲の上限
from ranked
group by common_id;

comment on view public.common_id_display is
  'common_id の表示名解決（§12.5.2⑤）: area・municipality（priority asc nulls last, town_key の先頭で決定的）＋'
  'ゾーン範囲 zone_no_min〜zone_no_max（area_master から集約・zone_plan不使用）。希望エリアUI・#29 が参照';

grant select on public.common_id_display to authenticated;


-- =============================================================
-- 確認：common_id → area/municipality/zone範囲 が引ける
-- =============================================================
select common_id, area, municipality, zone_no_min, zone_no_max
from public.common_id_display
order by common_id
limit 20;
-- 期待: 各 common_id に area・municipality と zone_no_min≤zone_no_max が入る（is_valid行のみ）。
