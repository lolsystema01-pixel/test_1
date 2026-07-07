-- =============================================================
-- 配達順の修正 v0.3 確認SQL
-- 実行: delivery_order_zone_sort_v0.sql（renumber_build 再定義）の後。
--   ★対象日は既定 current_date。実データが別日なら 'YYYY-MM-DD' に置換。
-- =============================================================

-- 前提: 配車済＋zone_no保存済み。まず採番を再計算（dry-run相当。deliveriesは未更新）。
select public.renumber_build(current_date);

-- ① 配達順が ゾーン番号順に並ぶ（同一common_id内・同一ドライバーで zone_no 昇順）--
select driver_id, delivery_order, common_id, basket_code,
       (select d.zone_no from public.deliveries d where d.tracking_number = p.tracking_number) as zone_no,
       (select d.address from public.deliveries d where d.tracking_number = p.tracking_number) as address
from public.renumber_plan p
where run_date = current_date
order by driver_id, delivery_order
limit 40;
-- 期待: 同一common_id・同一時間帯の中で zone_no 昇順 → 同一zone_no内は住所順。

-- ② zone_no 昇順が守られているか（隣接する配達順で zone_no が逆行しないか）------
with seq as (
  select p.driver_id, p.delivery_order, p.common_id,
         d.zone_no,
         lag(d.zone_no) over (partition by p.driver_id, p.common_id,
                               public.time_window_rank(d.time_window) order by p.delivery_order) as prev_zone
  from public.renumber_plan p
  join public.deliveries d on d.tracking_number = p.tracking_number
  where p.run_date = current_date
)
select count(*) as zone_backward_violations
from seq
where prev_zone is not null and zone_no is not null and zone_no < prev_zone;
-- 期待: 0（同一common_id・同一時間帯の中でゾーン番号が逆行しない）。

-- ③ 保留(zone_no欠損)の扱い：配車済でzone_no無しは末尾（nulls last）------------
select count(*) as dispatched_without_zone
from public.deliveries
where status = '配車済' and delivery_date = current_date and zone_no is null;
-- 期待: 0 が理想（付与済み）。>0 でも nulls last で末尾に回る。

-- ④ 冪等：再実行しても plan 件数が安定 --------------------------------------
select public.renumber_build(current_date);
select count(*) as plan_rows from public.renumber_plan where run_date = current_date;
-- 期待: ①の対象件数と同じ（再計算で安定）。

-- =============================================================
-- 合格条件との対応
--   ・①共通ID ②時間 ③zone_no ④住所 ⑤問合番号 の順で採番 … ①
--   ・同一エリア内がゾーン番号順（旧＝住所のみと異なる）      … ①②
--   ・zone_no欠損は末尾                                      … ③
--   ・採番本体（連番・冪等）は v0.5 のまま                    … ④
-- =============================================================
