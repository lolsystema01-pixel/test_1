-- =============================================================
-- 指示書: 拠点振分 v0.2 — 手順 3/3（確認）
--   付与結果・件数・保留・営業所別件数・経路成立 を実証する。
-- 実行: SQL Editor。assign_office_v0.sql【B. 本実行】の後。各ブロックを個別実行。
-- =============================================================


-- ① 経路成立：共通ID→拠点→営業所 が最後まで引ける件数 -----------
select count(*) as path_ok
from public.deliveries d
join public.zone_plan z on z.common_id  = d.common_id
join public.offices   o on o.depot_code = z.depot_code
where d.common_id is not null;
-- 期待: 14（共通IDのある荷物すべてが営業所まで到達）


-- ② 付与結果：拠点コード・営業所コードが入った件数 ----------------
select
  count(*) filter (where depot_code  is not null) as depot_assigned,
  count(*) filter (where office_code is not null) as office_assigned,
  count(*) filter (where common_id   is not null) as has_common_id
from public.deliveries;
-- 期待: depot_assigned=14 / office_assigned=14 / has_common_id=14


-- ③ 保留：保留荷物と内訳 -----------------------------------------
select
  (select count(*) from public.deliveries where status = '保留')                          as held_total,
  (select count(*) from public.deliveries where status = '保留' and common_id is null)     as held_no_common_id,   -- 前段（住所判定）由来
  (select count(*) from public.deliveries where status = '保留' and common_id is not null) as held_unresolved;     -- 本振分で拠点/営業所引けず
-- 期待: held_total=2 / held_no_common_id=2 / held_unresolved=0


-- ④ 営業所別の件数（後段＝配車の入力になる）----------------------
select coalesce(d.office_code,'(未割当)') as office_code,
       o.office_name,
       o.depot_code,
       count(*) as deliveries_cnt
from public.deliveries d
left join public.offices o on o.office_code = d.office_code
where d.common_id is not null
group by d.office_code, o.office_name, o.depot_code
order by office_code;
-- 期待: A01(愛知県1営業所)＋C01(愛知県2営業所) の合計が 14（内訳は判定結果で確定）


-- ⑤ 1:1 検証：どの拠点も営業所が1つ -----------------------------
select depot_code, count(*) as office_count
from public.offices
group by depot_code
having count(*) <> 1;
-- 期待: 0行（全拠点で営業所=1＝1:1が成立）


-- ⑥ 対象外：共通ID未付与（そのまま＝振分対象でない）--------------
select count(*) as out_of_scope_no_common_id
from public.deliveries
where common_id is null;
-- 期待: 2


-- ⑦ 経路スポット確認：岡崎(OKZ_C_01_08)→D01→A01 が引ける ----
select z.common_id, z.depot_code, o.office_code, o.office_name
from public.zone_plan z
join public.offices o on o.depot_code = z.depot_code
where z.common_id = 'OKZ_C_01_08';
-- 期待: OKZ_C_01_08 → D01 → A01(愛知県1営業所)
