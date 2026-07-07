-- =============================================================
-- DRV001 を伊丹営業所(IT01)へ＋当日荷物を振り分け（ドライバーアプリ表示用）
-- 実行: Supabase SQL Editor。前提: region_setup(IT01)・move_batch_date(当日=2026-07-04) 済み。
--   ★ 日付を変えたら date '2026-07-04' を今日に。
-- =============================================================

-- 1) DRV001 の所属営業所を 伊丹(IT01) に
update public.drivers set office_code = 'IT01' where driver_id = 'DRV001';

-- 2) 当日(2026-07-04)の伊丹荷物のうち ITD001 の分を DRV001 に付け替え（配達順・かご記号はそのまま）
--    ※ 別の割り当てにしたいなら driver_id='ITD001' を他ドライバーに、or 件数指定に変える。
update public.deliveries
set driver_id = 'DRV001'
where delivery_date = date '2026-07-04' and office_code = 'IT01' and driver_id = 'ITD001';

-- 確認: DRV001 の当日担当件数
select count(*) as drv001_items,
       count(*) filter (where delivery_order is not null) as numbered,
       min(delivery_order) as ord_min, max(delivery_order) as ord_max
from public.deliveries
where delivery_date = date '2026-07-04' and driver_id = 'DRV001';
-- 期待: DRV001 に ~81件（ITD001の分）が付く。


-- =============================================================
-- 【ドライバーアプリで見るには】ログイン用アカウントの profile を driver/DRV001 に。
--   ★ 'YOUR_DRIVER_EMAIL' を、ドライバーアプリでログインするアカウントのメールに置換。
--   ※ profiles はトリガで自動作成済み（role=NULL）。ここで driver に更新。
-- =============================================================
-- update public.profiles set role = 'driver', driver_id = 'DRV001'
--  where user_id = (select id from auth.users where email = 'YOUR_DRIVER_EMAIL');
--
-- 確認:
-- select p.role, p.driver_id, u.email from public.profiles p
--   join auth.users u on u.id=p.user_id where u.email='YOUR_DRIVER_EMAIL';
--   -- 期待: role=driver / driver_id=DRV001
