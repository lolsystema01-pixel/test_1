-- =============================================================
-- 地域セット（伊丹デモ）v0 確認SQL — 2026-06-29
-- =============================================================

-- ① 全体サマリ（取込→②→配車→採番 が通ったか）------------------------------
select
  count(*)                                        as total,
  count(*) filter (where common_id is not null)    as with_common_id,
  count(*) filter (where zone_no  is not null)     as with_zone_no,
  count(*) filter (where status = '配車済')         as dispatched,
  count(*) filter (where status = '保留')           as held,
  count(*) filter (where driver_id is not null)     as with_driver,
  count(*) filter (where delivery_order is not null) as numbered
from public.deliveries where delivery_date = date '2026-06-29';

-- ② 配達順が zone_no 順に並ぶ（同一ドライバー・同一common_id内で zone_no 昇順）------
select driver_id, delivery_order, common_id, zone_no, basket_code, address
from public.deliveries
where delivery_date = date '2026-06-29' and driver_id is not null
order by driver_id, delivery_order
limit 40;

-- ③ ゾーン逆行チェック（同一driver×common_id×時間帯で zone_no が逆行しない）-------
with seq as (
  select driver_id, common_id, delivery_order, zone_no,
         lag(zone_no) over (partition by driver_id, common_id,
                            public.time_window_rank(time_window) order by delivery_order) as prev_zone
  from public.deliveries
  where delivery_date = date '2026-06-29' and driver_id is not null
)
select count(*) as zone_backward_violations
from seq where prev_zone is not null and zone_no is not null and zone_no < prev_zone;
-- 期待: 0

-- ④ 記録口ログ（配車済への遷移が残っているか）--------------------------------
select count(*) as dispatched_log
from public.delivery_status_log where to_status='配車済' and source='配車'
  and tracking_number in (select tracking_number from public.deliveries where delivery_date=date '2026-06-29');

-- ⑤ ドライバー別 件数（実/仮）------------------------------------------------
select driver_id, count(*) as cnt
from public.deliveries where delivery_date=date '2026-06-29' and driver_id is not null
group by driver_id order by (driver_id like '仮%'), driver_id;
