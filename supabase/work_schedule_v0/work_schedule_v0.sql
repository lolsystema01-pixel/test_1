-- =============================================================
-- 指示書: ドライバー参照＋稼働予定 v0 — 手順 2/4
--   稼働予定の状態遷移（申請中→承認/却下）＋営業所直接入力＋申請可能期間チェック。
--   対応: 要件定義 6.4（申請・承認/営業所直接入力/申請可能期間）
-- 実行: SQL Editor。seed_drivers_v0.sql の後。各ブロックを Ctrl/Cmd+Enter で個別実行。
-- =============================================================
-- 状態（application_status）: 申請中 / 承認 / 却下
--   ・申請：ドライバーが 稼働日・稼働区分（フル/2時間/6時間 等）で申請（=申請中）。
--   ・承認/却下：営業所が 申請中→承認 または 却下 に更新。承認は転記不要（同じ行が承認状態）。
--   ・営業所直接入力：営業所が稼働予定を直接登録（フォールバック。例 application_status=承認）。
--   ・申請可能期間：申請日(current_date)から 営業所設定 request_period_days 以内の将来日のみ可。
-- ※「誰が申請/承認できるか」の書込み権限の強制は操作系RLS（別指示書）。ここは状態遷移と集計まで。
-- ※日付は current_date 起点の相対日（実行日に依存しない）。
-- =============================================================


-- =====================  §1. 申請（申請可能期間チェック付き）  =====================
-- ドライバーが稼働予定を申請（=申請中）。期間外（request_period_days 超）は弾く。
with applicants(driver_id, work_date, work_type) as (
  values
    ('DRV001', current_date + 7,  'フル'),    -- 期間内（A01: 30日以内）
    ('DRV002', current_date + 5,  '6時間'),   -- 期間内
    ('DRV003', current_date + 7,  'フル'),    -- 期間内（C01）
    ('DRV001', current_date + 60, 'フル')     -- 期間外（30日超）→弾く想定
),
chk as (
  select a.driver_id, a.work_date, a.work_type,
         d.office_code, o.request_period_days,
         (a.work_date >= current_date
          and (o.request_period_days is null
               or a.work_date <= current_date + o.request_period_days)) as within_period
  from applicants a
  join public.drivers d on d.driver_id = a.driver_id
  join public.offices o on o.office_code = d.office_code
),
ins as (
  insert into public.work_schedules (driver_id, work_date, work_type, application_status)
  select c.driver_id, c.work_date, c.work_type, '申請中'
  from chk c
  where c.within_period
    and not exists (                               -- 再実行時の二重申請を防ぐ
      select 1 from public.work_schedules w
      where w.driver_id = c.driver_id and w.work_date = c.work_date and w.work_type = c.work_type)
  returning id
)
select
  (select count(*) from ins)                          as applied,         -- 申請成立（申請中で登録）
  (select count(*) from chk where not within_period)  as rejected_period; -- 申請可能期間外で弾いた
-- 期待: applied=3（初回）/ rejected_period=1（current_date+60 が期間外）


-- =====================  §2. 承認 / 却下（営業所が更新）  =====================
-- 承認：申請中 → 承認（転記なし・同じ行が承認状態になる）
update public.work_schedules
set application_status = '承認'
where driver_id = 'DRV001' and work_date = current_date + 7 and application_status = '申請中';

update public.work_schedules
set application_status = '承認'
where driver_id = 'DRV003' and work_date = current_date + 7 and application_status = '申請中';

-- 却下：申請中 → 却下
update public.work_schedules
set application_status = '却下'
where driver_id = 'DRV002' and work_date = current_date + 5 and application_status = '申請中';


-- =====================  §3. 営業所直接入力（フォールバック）  =====================
-- アプリ未使用者・訂正用。営業所が稼働予定を直接登録（=承認で作成）。
insert into public.work_schedules (driver_id, work_date, work_type, application_status)
select 'DRV004', current_date + 7, 'フル', '承認'
where not exists (
  select 1 from public.work_schedules w
  where w.driver_id = 'DRV004' and w.work_date = current_date + 7);


-- =====================  §4. 申請可能期間チェック（単体確認）  =====================
-- 各営業所の申請期限（current_date + request_period_days）と、期間内/外の判定例。
select o.office_code, o.office_name, o.request_period_days,
       current_date                          as today,
       current_date + o.request_period_days  as apply_deadline,
       (current_date + 7  <= current_date + o.request_period_days) as d_plus7_in,    -- 期間内？
       (current_date + 60 <= current_date + o.request_period_days) as d_plus60_in    -- 期間外？
from public.offices o
order by o.office_code;
-- 期待: d_plus7_in=true / d_plus60_in=false（request_period_days=30）
