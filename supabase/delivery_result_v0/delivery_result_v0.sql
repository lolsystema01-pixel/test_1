-- =============================================================
-- 指示書(ドライバーMVP): 配達実績 v0 — delivery_results ＋ 記録口 record_delivery_result
--   対応: 要件定義 8.11（配達実績の取得・最小スライス）／6.10（status遷移は既存記録口を再利用）
-- 実行: Supabase SQL Editor（ブロック単位）。前提: dbschema_v0・rls_v0・status_log_v0。
-- =============================================================

-- ① 表 -----------------------------------------------------------
create table if not exists public.delivery_results (
  id              bigint generated always as identity primary key,
  tracking_number text not null references public.deliveries(tracking_number),
  driver_id       text not null,                                   -- 記録時の担当（my_driver()固定）
  result          text not null check (result in ('完了','不在')),  -- 結果
  lat             double precision check (lat between -90 and 90),  -- 完了地点 緯度（null=GPS取得失敗）
  lng             double precision check (lng between -180 and 180),-- 完了地点 経度
  recorded_at     timestamptz not null default now(),               -- 記録時刻
  created_by      uuid                                              -- auth.uid() 固定
);
comment on table  public.delivery_results is '配達実績（8.11の最小スライス）。書込みは record_delivery_result 関数経由のみ';
comment on column public.delivery_results.lat is '位置情報（機微）: 完了/不在タップ時のGPS緯度。空不在検知(8.5)の素';
comment on column public.delivery_results.lng is '位置情報（機微）: 同 経度';
create index if not exists idx_delivery_results_tracking on public.delivery_results (tracking_number);
create index if not exists idx_delivery_results_driver_day on public.delivery_results (driver_id, recorded_at);

-- ② RLS（SELECTのみ・書込みポリシーは作らない） --------------------
alter table public.delivery_results enable row level security;
grant select on public.delivery_results to authenticated;
drop policy if exists delivery_results_select on public.delivery_results;
create policy delivery_results_select on public.delivery_results
  for select to authenticated
  using (
    case public.my_role()
      when 'hq'     then true
      when 'depot'  then driver_id in (select d.driver_id from public.drivers d
                                        where d.office_code = any (select public.my_depot_offices()))
      when 'area'   then driver_id = any (select public.my_office_drivers())
      when 'driver' then driver_id = public.my_driver()
      else false
    end
  );

-- ③ 記録口 --------------------------------------------------------
create or replace function public.record_delivery_result(
  p_tracking_number text,
  p_result          text,
  p_lat             double precision default null,
  p_lng             double precision default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_driver  text := public.my_driver();
  v_status  text;
  v_owner   text;
  v_id      bigint;
begin
  -- 認可: driver本人のみ（管理の訂正は record_status_transition を直接使う）
  if v_uid is null or public.my_role() <> 'driver' or v_driver is null then
    raise exception '配達実績を記録できるのは担当ドライバーのみです' using errcode = '42501';
  end if;
  if p_result not in ('完了','不在') then
    raise exception '結果は 完了/不在 のみ（%）', coalesce(p_result,'(null)') using errcode = '23514';
  end if;
  if (p_lat is not null and (p_lat < -90 or p_lat > 90))
     or (p_lng is not null and (p_lng < -180 or p_lng > 180)) then
    raise exception '座標が不正です' using errcode = '23514';
  end if;

  select d.status, d.driver_id into v_status, v_owner
  from public.deliveries d where d.tracking_number = p_tracking_number;
  if not found then
    raise exception '対象の荷物が見つかりません（問合番号=%）', p_tracking_number using errcode = 'P0002';
  end if;
  if v_owner is distinct from v_driver then
    raise exception 'この荷物の担当ではありません' using errcode = '42501';
  end if;

  -- 冪等: 既に完了/不在なら何もしない（二度押し無害）
  if v_status in ('完了','不在') then
    return jsonb_build_object('result','already','tracking_number',p_tracking_number,'status',v_status);
  end if;

  -- 遷移: 仕分済なら配送中を自動経由（線形検証・ログは既存記録口に委譲）
  if v_status = '仕分済' then
    perform public.record_status_transition(p_tracking_number, '配送中', '配達', null);
  end if;
  perform public.record_status_transition(p_tracking_number, p_result, '配達', null);

  insert into public.delivery_results (tracking_number, driver_id, result, lat, lng, created_by)
  values (p_tracking_number, v_driver, p_result, p_lat, p_lng, v_uid)
  returning id into v_id;

  return jsonb_build_object('result','recorded','id',v_id,
    'tracking_number',p_tracking_number,'status',p_result,
    'gps', p_lat is not null);
end $$;

revoke execute on function public.record_delivery_result(text, text, double precision, double precision) from public;
grant  execute on function public.record_delivery_result(text, text, double precision, double precision) to authenticated;
comment on function public.record_delivery_result(text, text, double precision, double precision) is
  '配達実績の記録口（8.11最小）。driver本人限定・冪等・仕分済→配送中→完了/不在を不可分に。SECURITY DEFINER';
