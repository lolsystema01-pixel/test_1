-- =============================================================
-- 地域セット（伊丹デモ）v0 — ④配車 → ⑤採番(zone配達順) を 2026-06-29 で通す
-- 実行: Supabase SQL Editor。前提=region_setup_v0.sql 実行済み。
--       ＋ dispatch_v0（dispatch_build）／status_log_v0（record_status_transition）／
--         delivery_order_zone_sort_v0（renumber_build zone版）／seq_kago_index_v0（§0・delivery_index）適用済み。
-- ★各ブロックを順に実行。dry-run で確認 → 本実行。
-- =============================================================

-- ================= ④ 配車 =================
-- A. dry-run（書き込まない・集計）
select public.dispatch_build(date '2026-06-29');
select office_code, driver_kind,
       sum(assigned_qty) as assigned, count(*) filter (where driver_kind='仮') as virtual_cnt
from public.dispatch_drivers where run_date = date '2026-06-29'
group by office_code, driver_kind order by office_code, driver_kind;
-- 期待: IT01 に 実/仮 の割当が出る（実=ドライバー数×cap 目安、残りは仮）。

-- B. 本実行（driver_id 付与 ＋ status 記録口経由で 配車済）
select public.dispatch_build(date '2026-06-29');   -- 再計算（冪等）
update public.deliveries d
set driver_id = a.driver_id
from public.dispatch_assignments a
where a.run_date = date '2026-06-29' and a.tracking_number = d.tracking_number;

do $$
declare r record;
begin
  for r in
    select a.tracking_number
    from public.dispatch_assignments a
    join public.deliveries d on d.tracking_number = a.tracking_number
    where a.run_date = date '2026-06-29' and d.status = '未配車'
  loop
    perform public.record_status_transition(r.tracking_number, '配車済', '配車', null);
  end loop;
end $$;

-- 配車済件数
select status, count(*) from public.deliveries
where delivery_date = date '2026-06-29' group by status order by status;


-- ================= ⑤ 採番（zone配達順） =================
-- renumber_build は delivery_order_zone_sort_v0 適用済み（配達順＝common_id→時間→zone_no→住所→問合番号）
select public.renumber_build(date '2026-06-29');

-- deliveries へ配達順・かご記号を反映
update public.deliveries d
set delivery_order = p.delivery_order, basket_code = p.basket_code
from public.renumber_plan p
where p.run_date = date '2026-06-29' and p.tracking_number = d.tracking_number;

-- 問合Index同期
insert into public.delivery_index (tracking_number, driver_id, delivery_order, basket_code, common_id)
select p.tracking_number, p.driver_id, p.delivery_order, p.basket_code, p.common_id
from public.renumber_plan p
where p.run_date = date '2026-06-29'
on conflict (tracking_number) do update set
  driver_id      = excluded.driver_id,
  delivery_order = excluded.delivery_order,
  basket_code    = excluded.basket_code,
  common_id      = excluded.common_id;

-- 反映件数
select count(*) as plan_rows from public.renumber_plan where run_date = date '2026-06-29';
