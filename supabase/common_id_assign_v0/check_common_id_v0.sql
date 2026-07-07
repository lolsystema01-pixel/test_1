-- =============================================================
-- 共通ID付与 v0.4 確認SQL
-- 実行: common_id_assign_v0.sql（本実行）の後。
-- =============================================================

-- ① 付与率・zone_no保存・保留 -------------------------------------------------
select
  count(*)                                        as deliveries,
  count(*) filter (where common_id is not null)    as with_common_id,
  count(*) filter (where zone_no  is not null)     as with_zone_no,
  count(*) filter (where status = '保留')           as held,
  round(100.0*count(*) filter (where common_id is not null)/nullif(count(*),0),1) as assign_pct
from public.deliveries;
-- 期待: with_common_id と with_zone_no がほぼ一致（common_id付けば zone_no も付く）。保留＝未突合。

-- ② unit_no を保存していないこと（列が無い＝ユニット廃止）--------------------
select not exists (
  select 1 from information_schema.columns
  where table_schema='public' and table_name='deliveries' and column_name='unit_no'
) as unit_no_absent;   -- 期待: true（deliveries に unit_no 列が無い）

-- ③ zone_no は整数・common_idと対（サンプル）--------------------------------
select tracking_number, common_id, zone_no, status
from public.deliveries
where common_id is not null
order by common_id, zone_no
limit 20;

-- ④ 保留→再マッチの下地（マスタ更新前提の確認は common_id_rematch_v0.sql）----
select count(*) as held_rows,
       count(*) filter (where exists (select 1 from public.unregistered_addresses u
                                      where u.tracking_number = d.tracking_number)) as recorded
from public.deliveries d where status = '保留';

-- ⑤ 【人】現行GAS一致：付与後 common_id で ③office→④配車集計 が現行GAS出力と一致するか
--    （GASには触れないため、GAS出力を別途用意して突合。ここでは付与分布を出す）
select common_id, count(*) as cnt
from public.deliveries where common_id is not null
group by common_id order by common_id;
