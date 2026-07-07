-- =============================================================
-- パイプラインデモ v0 — フロントの「配車開始／採番開始」ボタン用 SECURITY DEFINER 関数
--   ・本物の配車(dispatch_build)・採番(renumber_build)・記録口(record_status_transition)を内部で呼ぶ。
--   ・anon キーから呼べる（DEFINER＝owner権限で実行）。service_role 不要。
--   ・対象は p_date（デモは 2026-06-29）。デモ用途＝一時的。
-- 実行: Supabase SQL Editor。前提=取込＋②付与＋region_setup（office/drivers）＋
--       dispatch_v0／status_log_v0／delivery_order_zone_sort_v0 適用済み。
-- =============================================================

-- ④-dry 配車プレビュー：dispatch_build で作業表だけ計算（deliveriesは書かない）------
create or replace function public.demo_dispatch_preview(p_date date)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.dispatch_build(p_date);
  return jsonb_build_object(
    'to_dispatch',      (select count(*) from public.dispatch_assignments where run_date=p_date),
    'real_count',       (select count(*) from public.dispatch_drivers where run_date=p_date and driver_kind='実'),
    'real_assigned',    (select coalesce(sum(assigned_qty),0) from public.dispatch_drivers where run_date=p_date and driver_kind='実'),
    'virtual_count',    (select count(*) from public.dispatch_drivers where run_date=p_date and driver_kind='仮'),
    'virtual_assigned', (select coalesce(sum(assigned_qty),0) from public.dispatch_drivers where run_date=p_date and driver_kind='仮')
  );
end $$;

-- ⑤-dry 採番プレビュー：renumber_build で renumber_plan だけ計算（deliveriesは書かない）--
create or replace function public.demo_renumber_preview(p_date date)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.renumber_build(p_date);
  return jsonb_build_object(
    'plan_rows', (select count(*) from public.renumber_plan where run_date=p_date),
    'drivers',   (select count(distinct driver_id) from public.renumber_plan where run_date=p_date)
  );
end $$;

-- ④ 配車開始：dispatch_build → driver_id付与 → status=配車済（＋遷移ログ）--------
--   ※ デモは area ユーザーがブラウザから押すため auth.uid()=そのユーザーになり、
--     記録口 record_status_transition の「呼び出し元scope認可」で拒否される。
--     デモは"システムバッチ"扱いなので、記録口を通さず status を直接更新し、
--     ログ(delivery_status_log)を actor='system' で直書きする（DEFINER＝owner実行）。
create or replace function public.demo_dispatch(p_date date)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.dispatch_build(p_date);
  update public.deliveries d
     set driver_id = a.driver_id
    from public.dispatch_assignments a
   where a.run_date = p_date and a.tracking_number = d.tracking_number;

  -- 遷移ログ（未配車→配車済・system）を先に記録（更新前の from_status を読む）
  insert into public.delivery_status_log (tracking_number, from_status, to_status, changed_by, actor, source)
  select d.tracking_number, d.status, '配車済', null, 'system', '配車'
  from public.deliveries d
  join public.dispatch_assignments a on a.run_date = p_date and a.tracking_number = d.tracking_number
  where d.status = '未配車';

  -- status を配車済へ
  update public.deliveries d
     set status = '配車済'
    from public.dispatch_assignments a
   where a.run_date = p_date and a.tracking_number = d.tracking_number and d.status = '未配車';

  return jsonb_build_object(
    'dispatched', (select count(*) from public.deliveries where delivery_date=p_date and status='配車済'),
    'drivers',    (select count(distinct driver_id) from public.deliveries where delivery_date=p_date and driver_id is not null)
  );
end $$;

-- ⑤ 採番開始：renumber_build(zone版) → deliveries反映 → 問合Index同期 --------
create or replace function public.demo_renumber(p_date date)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.renumber_build(p_date);
  update public.deliveries d
     set delivery_order = p.delivery_order, basket_code = p.basket_code
    from public.renumber_plan p
   where p.run_date = p_date and p.tracking_number = d.tracking_number;
  insert into public.delivery_index (tracking_number, driver_id, delivery_order, basket_code, common_id)
  select p.tracking_number, p.driver_id, p.delivery_order, p.basket_code, p.common_id
  from public.renumber_plan p where p.run_date = p_date
  on conflict (tracking_number) do update set
    driver_id=excluded.driver_id, delivery_order=excluded.delivery_order,
    basket_code=excluded.basket_code, common_id=excluded.common_id;
  return jsonb_build_object(
    'numbered', (select count(*) from public.deliveries where delivery_date=p_date and delivery_order is not null)
  );
end $$;

-- リセット：配車/採番前に戻す（common_id/zone_no は残す＝②はやり直さない）------
create or replace function public.demo_reset(p_date date)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  update public.deliveries
     set status = '未配車', driver_id = null, delivery_order = null, basket_code = null
   where delivery_date = p_date and common_id is not null;
  delete from public.dispatch_assignments where run_date = p_date;
  delete from public.dispatch_zones       where run_date = p_date;
  delete from public.dispatch_drivers     where run_date = p_date;
  delete from public.renumber_plan        where run_date = p_date;
  -- デモの配車ログも消して再実演をきれいに
  delete from public.delivery_status_log
   where source = '配車' and to_status = '配車済'
     and tracking_number in (select tracking_number from public.deliveries where delivery_date = p_date);
  return jsonb_build_object('reset', true,
    'unassigned', (select count(*) from public.deliveries where delivery_date=p_date and status='未配車'));
end $$;

-- サマリ（件数）------------------------------------------------------------
create or replace function public.demo_summary(p_date date)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'total',        count(*),
    'with_common',  count(*) filter (where common_id is not null),
    'with_zone',    count(*) filter (where zone_no is not null),
    'dispatched',   count(*) filter (where status='配車済'),
    'numbered',     count(*) filter (where delivery_order is not null),
    'held',         count(*) filter (where status='保留')
  )
  from public.deliveries where delivery_date = p_date;
$$;

-- 配達順一覧（デモ表示用。zone配達順が見える）-------------------------------
create or replace function public.demo_delivery_order(p_date date, p_driver text default null, p_limit int default 60)
returns table(driver_id text, delivery_order int, common_id text, zone_no int, basket_code text, address text)
language sql stable security definer set search_path = public as $$
  select d.driver_id, d.delivery_order, d.common_id, d.zone_no, d.basket_code, d.address
  from public.deliveries d
  where d.delivery_date = p_date and d.driver_id is not null
    and (p_driver is null or d.driver_id = p_driver)
  order by d.driver_id, d.delivery_order
  limit greatest(1, least(500, p_limit));
$$;

-- ドライバー一覧（フィルタ用）----------------------------------------------
create or replace function public.demo_drivers(p_date date)
returns table(driver_id text, cnt bigint)
language sql stable security definer set search_path = public as $$
  select d.driver_id, count(*) as cnt
  from public.deliveries d
  where d.delivery_date = p_date and d.driver_id is not null
  group by d.driver_id order by (d.driver_id like '仮%'), d.driver_id;
$$;

-- 権限：anon/authenticated から呼べるように（DEFINERで owner 実行）----------
do $$
declare fn text;
begin
  for fn in select unnest(array[
    'public.demo_dispatch_preview(date)','public.demo_renumber_preview(date)',
    'public.demo_dispatch(date)','public.demo_renumber(date)','public.demo_reset(date)',
    'public.demo_summary(date)','public.demo_delivery_order(date,text,int)','public.demo_drivers(date)'
  ]) loop
    execute format('revoke execute on function %s from public', fn);
    execute format('grant execute on function %s to anon, authenticated', fn);
  end loop;
end $$;
