-- =============================================================
-- 指示書: エリアマスタ文字化け修正 v0.1 — ①-a 追加診断（件数が期待と乖離したため）
--   実測: area_master_staging=43 / area_master=37（期待 ≈20 / ≈13 の 2〜3倍）。
--   → 修正生成の前に「破損の質」を確認する。SELECT のみ（副作用なし）。
-- 実行: Supabase SQL Editor（postgres）。
--   ★ Supabase SQL Editor は複数文だと最後の結果しか出さないため、
--     全診断を「1つの結果表」に集約している。1回 Run すれば全部出る。
-- =============================================================
-- 読み方（section / key / cnt）:
--   Q1「rows with n_broken_cols=N」… 1行あたり破損列数。全部 N=1 なら「1行1フィールド」前提が健在。
--   Q2「broken col: X」            … どの列が何行壊れているか。
--   Q3「common_id intact / broken」… 突合キー common_id が健全な破損行数（intact＝common_idで原本突合可）。
-- =============================================================

with p as (select '%' || chr(65533) || '%' as m),
s_scan as (
  select
    array_remove(array[
      case when prefecture   like p.m then 'prefecture'   end,
      case when municipality like p.m then 'municipality' end,
      case when town         like p.m then 'town'         end,
      case when chome        like p.m then 'chome'        end,
      case when zone_no      like p.m then 'zone_no'      end,
      case when common_id    like p.m then 'common_id'    end,
      case when is_valid     like p.m then 'is_valid'     end,
      case when priority     like p.m then 'priority'     end,
      case when area         like p.m then 'area'         end,
      case when depot        like p.m then 'depot'        end,
      case when src_town_key like p.m then 'src_town_key' end,
      case when postal_code  like p.m then 'postal_code'  end
    ], null) as bc,
    (common_id like p.m) as cid_broken
  from public.area_master_staging, p
),
a_scan as (
  select
    array_remove(array[
      case when town_key        like p.m then 'town_key'        end,
      case when prefecture      like p.m then 'prefecture'      end,
      case when municipality    like p.m then 'municipality'    end,
      case when town            like p.m then 'town'            end,
      case when chome           like p.m then 'chome'           end,
      case when common_id       like p.m then 'common_id'       end,
      case when area            like p.m then 'area'            end,
      case when depot           like p.m then 'depot'           end,
      case when source_town_key like p.m then 'source_town_key' end,
      case when postal_code     like p.m then 'postal_code'     end
    ], null) as bc,
    (common_id like p.m) as cid_broken
  from public.area_master, p
)
select section, key, cnt from (
  -- ── area_master_staging ──
  select 1 as ord, 'staging'::text as section, 'TOTAL broken rows'::text as key, count(*)::bigint as cnt
    from s_scan where cardinality(bc) > 0
  union all
  select 2, 'staging', 'rows with n_broken_cols=' || cardinality(bc), count(*)
    from s_scan where cardinality(bc) > 0 group by cardinality(bc)
  union all
  select 3, 'staging', 'broken col: ' || col, count(*)
    from s_scan, unnest(bc) as col group by col
  union all
  select 4, 'staging', 'common_id intact (matchable by common_id)', count(*)
    from s_scan where cardinality(bc) > 0 and not cid_broken
  union all
  select 4, 'staging', 'common_id broken (need address match)', count(*)
    from s_scan where cardinality(bc) > 0 and cid_broken
  union all
  -- ── area_master ──
  select 5, 'area_master', 'TOTAL broken rows', count(*)
    from a_scan where cardinality(bc) > 0
  union all
  select 6, 'area_master', 'rows with n_broken_cols=' || cardinality(bc), count(*)
    from a_scan where cardinality(bc) > 0 group by cardinality(bc)
  union all
  select 7, 'area_master', 'broken col: ' || col, count(*)
    from a_scan, unnest(bc) as col group by col
  union all
  select 8, 'area_master', 'common_id intact (matchable by common_id)', count(*)
    from a_scan where cardinality(bc) > 0 and not cid_broken
  union all
  select 8, 'area_master', 'common_id broken (need address match)', count(*)
    from a_scan where cardinality(bc) > 0 and cid_broken
) t
order by ord, key;
