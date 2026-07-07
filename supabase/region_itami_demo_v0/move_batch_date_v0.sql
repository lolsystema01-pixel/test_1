-- =============================================================
-- デモバッチの日付移動：2026-07-03 → 2026-07-04（今日）
--   配車表PDF等は既定が「今日」なので、データを今日の日付にすると初期表示で出る。
-- 実行: Supabase SQL Editor。★ 日付を変えるときは FROM/TO の2値を書き換える。
--   FROM = 2026-07-03 ／ TO = 2026-07-04
-- =============================================================

-- 1) 荷物データ（deliveries）の配達日を移動
update public.deliveries
set delivery_date = date '2026-07-04'
where delivery_date = date '2026-07-03';

-- 2) 伊丹ドライバーの稼働予定も同日へ（配車が承認稼働を当日で探すため）
update public.work_schedules
set work_date = date '2026-07-04'
where work_date = date '2026-07-03' and driver_id like 'ITD%';

-- 3) 旧日付の作業表を掃除（表示は deliveries を見るので中間表は不要）
delete from public.dispatch_assignments where run_date = date '2026-07-03';
delete from public.dispatch_zones       where run_date = date '2026-07-03';
delete from public.dispatch_drivers     where run_date = date '2026-07-03';
delete from public.renumber_plan        where run_date = date '2026-07-03';

-- 確認
select delivery_date, count(*) as cnt,
       count(*) filter (where status='配車済') as dispatched,
       count(*) filter (where delivery_order is not null) as numbered
from public.deliveries
where delivery_date = date '2026-07-04'
group by delivery_date;
-- 期待: 2026-07-04 に ~2538件（配車済/採番も維持）。
