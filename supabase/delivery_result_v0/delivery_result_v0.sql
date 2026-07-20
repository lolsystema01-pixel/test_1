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

-- 冪等キー（PR#9レビューMED対応・2026-07-20）:
--   「サーバはcommit済みだがレスポンス到達前に通信断→キュー再送」で `不在` が二重記録される穴を塞ぐ。
--   タップ1回＝クライアント発行UUID1個。同一UUIDの再送は already・新しいタップ（日内再訪）は新UUID＝新規記録。
--   既存行・旧クライアントは null 許容（nullは重複チェック対象外＝互換維持）。
alter table public.delivery_results add column if not exists client_request_id uuid;
comment on column public.delivery_results.client_request_id is
  '冪等キー（タップ1回＝クライアント発行UUID1個）。再送重複の排除用。null=旧クライアント/管理経由';
create unique index if not exists uq_delivery_results_client_request
  on public.delivery_results (client_request_id) where client_request_id is not null;

-- 拠点配下の全ドライバーID（deliveries RLSのdepot分岐と同じ範囲をdrivers RLSを跨いで解決）
-- ※ public.drivers はhq/area/driver本人のみにSELECTポリシーがあり depot分岐が無いため、
--   ポリシー内で drivers を直接参照すると depot ロールは常に0件（fail-closed）になる。
--   my_office_drivers() と同じ「RLSを跨ぐSECURITY DEFINERヘルパー」パターンで解決する。
create or replace function public.my_depot_drivers()
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select driver_id from public.drivers
  where office_code in (select public.my_depot_offices())
$$;
revoke all on function public.my_depot_drivers() from public;
grant execute on function public.my_depot_drivers() to authenticated;
comment on function public.my_depot_drivers() is
  '拠点配下の全ドライバーID一覧（drivers のRLSを跨ぐ）。delivery_results のdepot可視範囲判定用';

-- ② RLS（SELECTのみ・書込みポリシーは作らない） --------------------
alter table public.delivery_results enable row level security;
grant select on public.delivery_results to authenticated;
drop policy if exists delivery_results_select on public.delivery_results;
create policy delivery_results_select on public.delivery_results
  for select to authenticated
  using (
    case public.my_role()
      when 'hq'     then true
      when 'depot'  then driver_id in (select public.my_depot_drivers())
      when 'area'   then driver_id = any (select public.my_office_drivers())
      when 'driver' then driver_id = public.my_driver()
      else false
    end
  );

-- ③ 記録口 --------------------------------------------------------
-- 旧4引数版の残骸を除去（引数追加は create or replace では別オーバーロードになるため。
--  drop→再作成でも、下で同名5引数版に grant し直すので権限は連続する）
drop function if exists public.record_delivery_result(text, text, double precision, double precision);

create or replace function public.record_delivery_result(
  p_tracking_number   text,
  p_result            text,
  p_lat               double precision default null,
  p_lng               double precision default null,
  p_client_request_id uuid default null
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
  v_dup     bigint;
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

  -- 二度押し/再送の並行実行対策（行ロック→敗者はalready）：
  -- for update で行ロックし、並行呼び出しの敗者は勝者のcommitまで待機してから
  -- 終端status（完了/不在）を読み、下の冪等ガードで already を返す。
  select d.status, d.driver_id into v_status, v_owner
  from public.deliveries d where d.tracking_number = p_tracking_number
  for update;
  if not found then
    raise exception '対象の荷物が見つかりません（問合番号=%）', p_tracking_number using errcode = 'P0002';
  end if;
  if v_owner is distinct from v_driver then
    raise exception 'この荷物の担当ではありません' using errcode = '42501';
  end if;

  -- 冪等キー（再送の重複排除・PR#9レビューMED対応）:
  --   同一 client_request_id が既に記録済み＝「そのタップは届いている」＝ already を返す。
  --   deliveries の行ロック取得後に判定するため、同一UUIDの並行再送も直列化され、
  --   敗者は勝者のcommit後にここで捕まる。新しいタップ（日内再訪）は新UUIDなので素通り＝正当に2行目。
  if p_client_request_id is not null then
    select r.id into v_dup from public.delivery_results r
    where r.client_request_id = p_client_request_id;
    if found then
      return jsonb_build_object('result','already','tracking_number',p_tracking_number,'status',v_status);
    end if;
  end if;

  -- 冪等: 既に完了なら何もしない（二度押し無害）。完了は終端のまま。
  -- 不在は日内再訪（LOL確定2026-07-18）で再処理可＝ここでは早期returnしない（下の遷移へ進む）。
  -- ※不在の「再送」重複は上の冪等キーが塞ぐ（キー無し=旧クライアントは従来どおり重複しうる＝READMEに既知の制限として明記）。
  if v_status = '完了' then
    return jsonb_build_object('result','already','tracking_number',p_tracking_number,'status',v_status);
  end if;

  -- 遷移: 仕分済（初回配達開始）または不在（日内再訪の再開）なら配送中を自動経由
  --   （線形検証・ログは既存記録口の実体に委譲。record_status_transition_internal を直接呼ぶ＝
  --    driverロールでも完了/不在に到達できるのは本関数からの内部呼び出しだけに限定するため
  --    〔公開ラッパー record_status_transition のdriverガードは経由しない。MED-2対応・record_status_transition_v0.sql参照〕）。
  if v_status in ('仕分済','不在') then
    perform public.record_status_transition_internal(p_tracking_number, '配送中', '配達', null);
  end if;
  perform public.record_status_transition_internal(p_tracking_number, p_result, '配達', null);

  insert into public.delivery_results (tracking_number, driver_id, result, lat, lng, created_by, client_request_id)
  values (p_tracking_number, v_driver, p_result, p_lat, p_lng, v_uid, p_client_request_id)
  returning id into v_id;

  return jsonb_build_object('result','recorded','id',v_id,
    'tracking_number',p_tracking_number,'status',p_result,
    'gps', p_lat is not null);
end $$;

revoke execute on function public.record_delivery_result(text, text, double precision, double precision, uuid) from public;
grant  execute on function public.record_delivery_result(text, text, double precision, double precision, uuid) to authenticated;
comment on function public.record_delivery_result(text, text, double precision, double precision, uuid) is
  '配達実績の記録口（8.11最小）。driver本人限定・冪等（完了=終端＋client_request_idで再送重複排除）・'
  '仕分済/不在→配送中→完了/不在を不可分に。完了/不在への唯一の正規経路（record_status_transition_internal 直呼び＝MED-2対応）。SECURITY DEFINER';
