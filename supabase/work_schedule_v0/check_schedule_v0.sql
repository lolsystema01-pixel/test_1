-- =============================================================
-- 指示書: ドライバー参照＋稼働予定 v0 — 手順 4/4（確認）
--   状態遷移・フォールバック・申請可能期間・稼働人数 を実証する。
-- 実行: SQL Editor。seed→work_schedule→headcount の後。各ブロックを個別実行。
-- =============================================================


-- ① ドライバー seed と所属営業所の整合 --------------------------
select d.office_code, o.office_name, o.depot_code, count(*) as driver_cnt
from public.drivers d
join public.offices o on o.office_code = d.office_code
group by d.office_code, o.office_name, o.depot_code
order by d.office_code;
-- 期待: A01(愛知県1営業所)=2 / C01(愛知県2営業所)=2


-- ② 状態分布（申請中/承認/却下）--------------------------------
select application_status, count(*) as cnt
from public.work_schedules
group by application_status
order by application_status;


-- ③ 申請→承認（転記なし＝同じ行が承認状態）---------------------
select id, driver_id, work_date, work_type, application_status
from public.work_schedules
where driver_id = 'DRV001' and work_date = current_date + 7;
-- 期待: 1行・application_status=承認（申請した行がそのまま承認になっている）


-- ④ 却下の確認 -------------------------------------------------
select id, driver_id, work_date, work_type, application_status
from public.work_schedules
where driver_id = 'DRV002' and work_date = current_date + 5;
-- 期待: application_status=却下


-- ⑤ 営業所直接入力（フォールバック）---------------------------
select id, driver_id, work_date, work_type, application_status
from public.work_schedules
where driver_id = 'DRV004' and work_date = current_date + 7;
-- 期待: application_status=承認（営業所が直接登録）


-- ⑥ 申請可能期間：期間外が登録されていないこと -----------------
--   申請期限（current_date + request_period_days）を超える稼働予定が無い。
select count(*) as over_period_rows
from public.work_schedules ws
join public.drivers d on d.driver_id = ws.driver_id
join public.offices o on o.office_code = d.office_code
where o.request_period_days is not null
  and ws.work_date > current_date + o.request_period_days;
-- 期待: 0（current_date+60 の申請は §1 で弾かれ未登録）


-- ⑦ 予測対象日の稼働人数（承認済み・0人も0）-------------------
with target as (select (current_date + 7) as work_date)
select o.office_code, o.office_name, t.work_date,
       count(distinct ws.driver_id) as headcount
from public.offices o
cross join target t
left join public.drivers d on d.office_code = o.office_code
left join public.work_schedules ws
       on ws.driver_id = d.driver_id and ws.work_date = t.work_date and ws.application_status = '承認'
group by o.office_code, o.office_name, t.work_date
order by o.office_code;
-- 期待: A01=1 / C01=2（0人の営業所があれば 0 と表示される）
