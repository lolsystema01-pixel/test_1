-- =============================================================
-- ②前提c の追加診断: min(zone_no) が共通ID名の From と食い違う13件は何か
--
--   背景（2026-07-17 実測・recheck_vocab_gates_v0.sql seq 12）:
--     共通IDは「ゾーン範囲」を名前に持つ（例 ABK_C_29_32 = zone 29〜32）。
--     名前の _from_to と min/max(zone_no) が 1559/1601（97.4%）で一致＝仮説は実測で確定。
--     ただし From 不一致が 13件 残った。②の zone_no := min(zone_no) を決める前に、
--     この13件の「質」を確認する（①で detect → diagnose とやったのと同じ手順）。
--
--   仮説: クエリが is_valid の行だけを見ているため、
--         「範囲の先頭ゾーンの町がすべて無効」だと有効行の最小が From より大きくなる。
--         → だとすれば異常ではなく、min(zone_no) の採用は妥当。
--         → 無効行を含めた min_all が name_from と一致すれば、この仮説が裏付けられる。
--
--   性質: SELECT のみ（副作用なし）。何度実行してもよい。
--   実行: Supabase SQL Editor（postgres）で丸ごと Run。最後のSELECTだけ結果が出る。
-- =============================================================

with r as (
  select
    common_id,
    ((regexp_match(common_id, '_(\d+)_(\d+)$'))[1])::int as name_from,
    ((regexp_match(common_id, '_(\d+)_(\d+)$'))[2])::int as name_to,
    min(zone_no) filter (where is_valid)      as min_valid,
    max(zone_no) filter (where is_valid)      as max_valid,
    min(zone_no)                              as min_all,      -- 無効行も含む
    max(zone_no)                              as max_all,
    count(*) filter (where is_valid)          as valid_rows,
    count(*) filter (where not is_valid)      as invalid_rows,
    string_agg(distinct depot, '・')          as depots
  from public.area_master
  where common_id ~ '_(\d+)_(\d+)$'
    and zone_no is not null
  group by common_id
),
ng as (
  select * from r
  where min_valid is not null
    and min_valid <> name_from        -- ＝ seq 12 の From 不一致 13件
)
select
  common_id,
  name_from, name_to,                                  -- 名前が主張する範囲
  min_valid, max_valid,                                -- 有効行だけの実測範囲
  min_all,   max_all,                                  -- 無効行も含めた実測範囲
  valid_rows, invalid_rows,
  depots,
  case
    when min_all = name_from and invalid_rows > 0
      then '✅ 仮説どおり: 先頭ゾーンの町が無効なだけ（min_all は名前と一致）'
    when min_all = name_from
      then '⚠ 無効行なしなのに min_valid がズレる（要確認）'
    when min_all > name_from
      then '⚠ 無効を含めても先頭ゾーンの町が存在しない（名前の範囲 > 実データ）'
    else '⚠ 想定外（min_all < name_from）'
  end as diagnosis
from ng
order by common_id;

-- 【読み方】
--   ・diagnosis が全件 ✅ … 13件は「先頭ゾーンの町が無効」なだけ＝データ異常ではない。
--       → ② は zone_no := min(zone_no) filter (where is_valid) で決定的に書いてよい。
--         （zone_plan は有効な町の実態を表すべきで、無効な町しかないゾーンを From に据える理由がない）
--   ・「名前の範囲 > 実データ」が出る … 名前が実データより広い範囲を主張している。
--       zone_plan.zone_no は現状どこからも読まれないため実害は無いが、
--       エリアマスタ原本の範囲定義と実データのズレとして業務Aへ申し送る。
--   ・「想定外」が出る … 仮説が崩れる。②の設計を再検討する。
