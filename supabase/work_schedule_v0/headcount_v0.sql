-- =============================================================
-- 指示書: ドライバー参照＋稼働予定 v0 — 手順 3/4
--   予測対象日の稼働人数を、承認済みの稼働予定から取得（営業所×日付）。
--   対応: 要件定義 6.4（予測対象日の稼働人数）/ 6.5（稼働人数は配車の入力）
-- 実行: SQL Editor。work_schedule_v0.sql の後。
-- =============================================================
-- ・稼働人数＝「承認済み(application_status='承認')」の稼働予定の人数。
-- ・営業所×日付で集計。0人のときも 0 と分かるよう全営業所を出す（LEFT JOIN）。
--   ※稼働予定が未登録（0人）だと配車で全件仮配車になる前提（6.5）。
-- =============================================================


-- §A. 予測対象日（1日）の営業所別 稼働人数 ----------------------
--   予測対象日を current_date + 7 とする（work_schedule_v0 §2/§3 の承認分）。
with target as (select (current_date + 7) as work_date)
select o.office_code,
       o.office_name,
       t.work_date,
       count(distinct ws.driver_id) as headcount   -- 承認済みドライバー数（0人なら0）
from public.offices o
cross join target t
left join public.drivers d
       on d.office_code = o.office_code
left join public.work_schedules ws
       on ws.driver_id = d.driver_id
      and ws.work_date = t.work_date
      and ws.application_status = '承認'
group by o.office_code, o.office_name, t.work_date
order by o.office_code;
-- 期待（current_date+7）: A01=1（DRV001承認）/ C01=2（DRV003承認＋DRV004直接入力）


-- §B. 期間内の全日付 × 営業所の 稼働人数（承認済み）------------
--   登録のある日付について営業所別人数を一覧。配車の入力に使える形。
select o.office_code, o.office_name, ws.work_date,
       count(distinct ws.driver_id) as headcount
from public.work_schedules ws
join public.drivers d on d.driver_id = ws.driver_id
join public.offices o on o.office_code = d.office_code
where ws.application_status = '承認'
group by o.office_code, o.office_name, ws.work_date
order by ws.work_date, o.office_code;


-- §C. 0人の明示（承認済みが居ない営業所×対象日）---------------
with target as (select (current_date + 7) as work_date)
select o.office_code, o.office_name, t.work_date, 0 as headcount
from public.offices o
cross join target t
where not exists (
  select 1
  from public.work_schedules ws
  join public.drivers d on d.driver_id = ws.driver_id
  where d.office_code = o.office_code
    and ws.work_date = t.work_date
    and ws.application_status = '承認'
)
order by o.office_code;
-- 期待: 対象日に承認済みが居ない営業所が 0 で並ぶ（今回の例では0行＝両営業所とも稼働あり）
