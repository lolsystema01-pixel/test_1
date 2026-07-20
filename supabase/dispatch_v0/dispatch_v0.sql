-- =============================================================
-- 指示書: 配車 v0.5（処理能力優先・仮ドライバー）— 手順 1/3：エンジン
--   対応: 要件定義 6.5 配車（ドライバー予測）。GAS 20_assign_main_fit_assign.js / 24_Logic_Dispatch 準拠。
-- 実行: Supabase SQL Editor。前提=DBスキーマ v0／RLS v0.2／seed_dispatch_v0.sql 実行済み。
-- =============================================================
-- 本指示書の範囲: ドライバー確定（実/仮）＋ステータス＝配車済み まで。
--   ・cap＝スキル（1時間あたり配達個数）× 稼働区分の時間（SHIFT_HOURS）。承認済み稼働予定のみ。
--   ・ゾーン候補＝共通ID別荷量を分割閾値で分割（≤閾値→1 / ≤1.8倍→2 / ≤2.6倍→3 / 以降 ceil）。
--   ・処理能力優先＝主担当ゾーン1本→隣接ランク≤3を積み増し（割当後≤cap）。
--   ・仮ドライバー＝残未配車を共通ID別に推奨枠200個で区切って 仮1,仮2…。承認0なら全件仮。
--   ・二段階: 【A】dry-run（書き込まない・集計のみ）→【B】本実行（確定・status更新）。
-- 採番一式（配達順→かご記号→問合Index同期）は別指示書。ここでは扱わない。
-- =============================================================


-- =============================================================
-- §0. 前提オブジェクト（設定・作業テーブル・関数）
-- =============================================================

-- 0-1) ZonePlan拡張：分割閾値（split_threshold）-------------------------------
--   全国ZonePlan v0.4 はマスタ本体に分割閾値を「持たない」とし、
--   「配車設計時に ZonePlan の拡張として扱う」と委譲している
--   （指示書 master_zoneplan v0.4『やらないこと』）。本配車がその拡張担当。
--   出所＝全国ZonePlan CSV「分割閾値(個)」。マスタ本体は無改修。既定170。
alter table public.zone_plan add column if not exists split_threshold integer not null default 170;
comment on column public.zone_plan.split_threshold is '分割閾値(個)。出所=全国ZonePlan CSV。配車がZonePlan拡張として保持（既定170）';

-- 直近の全国ZonePlan読込（zoneplan_staging）が残っていれば、その分割閾値(個)を
-- 正典として zone_plan へ同期する。staging はマスタ読込バッファなので、
-- 存在しない／空のときは既存値（seed/既定）を維持する。
do $$
begin
  if to_regclass('public.zoneplan_staging') is not null then
    update public.zone_plan zp
    set split_threshold = nullif(btrim(s.split_threshold), '')::int
    from public.zoneplan_staging s
    where s.common_id = zp.common_id
      and nullif(btrim(s.split_threshold), '') is not null;
  end if;
end $$;

-- 0-2) 稼働区分→時間（SHIFT_HOURS）。区分→時間は設定として保持 ----------------
create table if not exists public.shift_hours (
  work_type text primary key,   -- 稼働区分（フル/6時間/6中/2時間/半日 等）
  hours     numeric not null    -- 1日の稼働時間
);
comment on table public.shift_hours is '稼働区分→時間（cap＝スキル×時間 の時間側）';
insert into public.shift_hours (work_type, hours) values
  ('フル', 8), ('6時間', 6), ('6中', 6), ('2時間', 2), ('半日', 4)
  on conflict (work_type) do update set hours = excluded.hours;

-- 0-3) 作業テーブル（run_date 単位。dry-run/本実行で再計算される）--------------
create table if not exists public.dispatch_drivers (
  run_date     date    not null,
  office_code  text,
  driver_id    text    not null,                    -- 実=ドライバーID / 仮=仮1,仮2…
  driver_kind  text    not null check (driver_kind in ('実','仮')),
  skill        integer,                             -- スキル（1時間あたり個数。仮はNULL）
  hours        numeric,                             -- 稼働時間（仮はNULL）
  cap          integer,                             -- 実=skill×hours / 仮=推奨枠200
  assigned_qty integer not null default 0,          -- 実際に割り当てた個数
  primary key (run_date, driver_id)
);

create table if not exists public.dispatch_zones (
  run_date     date    not null,
  office_code  text,
  common_id    text    not null,
  municipality text,                                -- 自治体（rank2=同一市 判定の参考）
  qty          integer not null,                    -- ゾーン荷量（未配車）
  threshold    integer not null,                    -- 分割閾値
  split_count  integer not null,                    -- 分割数
  primary key (run_date, office_code, common_id)
);

create table if not exists public.dispatch_assignments (
  run_date     date    not null,
  tracking_number text not null,
  office_code  text,
  common_id    text,
  driver_id    text    not null,
  driver_kind  text    not null,
  assign_rank  integer,                             -- 1=主担当/2=同一市/3=隣接
  primary key (run_date, tracking_number)
);

-- RLS（前提A：全テーブルRLS）。バックエンド計算テーブルなので本部参照のみ。-------
alter table public.shift_hours          enable row level security;
alter table public.dispatch_drivers     enable row level security;
alter table public.dispatch_zones       enable row level security;
alter table public.dispatch_assignments enable row level security;
grant select on public.shift_hours, public.dispatch_drivers,
                public.dispatch_zones, public.dispatch_assignments to authenticated;
drop policy if exists shift_hours_hron          on public.shift_hours;
drop policy if exists dispatch_drivers_hq       on public.dispatch_drivers;
drop policy if exists dispatch_zones_hq         on public.dispatch_zones;
drop policy if exists dispatch_assignments_hq   on public.dispatch_assignments;
create policy shift_hours_hron        on public.shift_hours          for select to authenticated using ( public.my_role() = 'hq' );
create policy dispatch_drivers_hq     on public.dispatch_drivers     for select to authenticated using ( public.my_role() = 'hq' );
create policy dispatch_zones_hq       on public.dispatch_zones       for select to authenticated using ( public.my_role() = 'hq' );
create policy dispatch_assignments_hq on public.dispatch_assignments for select to authenticated using ( public.my_role() = 'hq' );

-- =============================================================
-- ⚠⚠ RETIRED（2026-07-17）: この下の zone_rank / dispatch_build は **旧版** です。
--   本番DBの実体は vocab_fix_v0/migrate_functions_to_area_master_v0.sql（④）で
--   **area_master 参照に書き換え済み**。address_master は⑤で drop 済み（存在しません）。
--
--   ★このファイルを再実行すると④を巻き戻します。
--     ・⑤drop後（現状）＝ fail-closed：zone_rank は language sql のため address_master 不在で
--       **作成時にエラー**になり、そこで止まる（＝巻き戻りは起きない）。
--     ・⚠ ④実施〜⑤drop の「窓」の間だけは危険：address_master がまだ存在するため
--       **作成時エラーにならず、旧版が静かに上書き**され④が巻き戻る（新語彙の市名が引けず
--       「エラー無しで市名NULL・同一市判定不成立」に戻る）。この窓では本ファイルを実行しないこと。
--     ・drop後に仮に address_master を復活させてから実行した場合も同じ劣化になる。
--
--   配車ロジックを直すときは **migrate_functions_to_area_master_v0.sql の側を正** とし、
--   このファイルの関数定義は履歴として読むだけにしてください。
--   経緯: supabase/vocab_fix_v0/README.md ／ 確認結果メモ.md
-- =============================================================

-- 0-4) 隣接ランク（1=同一ゾーン / 2=同一市 / 3=隣接 / 99=対象外）---------------
--   ※ RETIRED（上記）。実体は④で area_master 参照へ移行済み。
create or replace function public.zone_rank(a text, b text)
returns integer language sql stable as $$
  select case
    when a = b then 1
    when (select am.municipality from public.address_master am where am.common_id = a limit 1)
       = (select am.municipality from public.address_master am where am.common_id = b limit 1)
      then 2
    when b = any (
        select trim(x) from unnest(
          string_to_array(coalesce((select zp.adjacent_zones from public.zone_plan zp where zp.common_id = a), ''), ',')
        ) as x )
      then 3
    when a = any (
        select trim(x) from unnest(
          string_to_array(coalesce((select zp.adjacent_zones from public.zone_plan zp where zp.common_id = b), ''), ',')
        ) as x )
      then 3
    else 99
  end;
$$;

-- 0-5) 配車計算本体（dry-run/本実行 共通で呼ぶ。deliveries は更新しない）--------
--   作業3テーブルを run_date 分だけ作り直す。処理能力優先＋隣接積み増し＋仮ドライバー。
create or replace function public.dispatch_build(p_date date)
returns void language plpgsql as $$
declare
  v_office text;
  v_driver record;
  v_grp    record;
  v_main   text;
  v_adj    text;
  v_remaining integer;
  v_take   integer;
  v_vnum   integer := 0;
  v_vid    text;
begin
  -- 当日分の作業テーブルをリセット（冪等）
  delete from public.dispatch_assignments where run_date = p_date;
  delete from public.dispatch_zones       where run_date = p_date;
  delete from public.dispatch_drivers     where run_date = p_date;

  -- (1) 実ドライバーを動的構築：cap＝スキル×稼働時間。承認済み稼働予定のみ。
  insert into public.dispatch_drivers (run_date, office_code, driver_id, driver_kind, skill, hours, cap, assigned_qty)
  select p_date, d.office_code, d.driver_id, '実',
         d.skill_per_hour, sh.hours, (d.skill_per_hour * sh.hours)::int, 0
  from public.work_schedules ws
  join public.drivers     d  on d.driver_id  = ws.driver_id
  join public.shift_hours sh on sh.work_type = ws.work_type
  where ws.work_date = p_date
    and ws.application_status = '承認';

  -- (2) ゾーン候補：共通ID別荷量＋分割（閾値・1.8倍・2.6倍・以降ceil）
  --     ※対象は「当日(delivery_date=p_date)の未配車」のみ。別日の在庫は対象外。
  insert into public.dispatch_zones (run_date, office_code, common_id, municipality, qty, threshold, split_count)
  select p_date, dv.office_code, dv.common_id,
         (select am.municipality from public.address_master am where am.common_id = dv.common_id limit 1),
         count(*)::int,
         coalesce(zp.split_threshold, 170),
         case
           when count(*) <= coalesce(zp.split_threshold,170)         then 1
           when count(*) <= 1.8 * coalesce(zp.split_threshold,170)   then 2
           when count(*) <= 2.6 * coalesce(zp.split_threshold,170)   then 3
           else ceil(count(*)::numeric / coalesce(zp.split_threshold,170))::int
         end
  from public.deliveries dv
  left join public.zone_plan zp on zp.common_id = dv.common_id
  where dv.status = '未配車' and dv.common_id is not null and dv.delivery_date = p_date
  group by dv.office_code, dv.common_id, zp.split_threshold;

  -- (3) 処理能力優先で配分：営業所ごと、cap の大きい実ドライバーから
  for v_office in
    select distinct office_code from public.dispatch_drivers where run_date = p_date and driver_kind = '実'
  loop
    for v_driver in
      select * from public.dispatch_drivers
      where run_date = p_date and office_code = v_office and driver_kind = '実'
      order by cap desc, driver_id
    loop
      v_remaining := v_driver.cap;

      -- Phase1: 主担当ゾーン＝残荷量が最大のゾーンを1本
      select z.common_id into v_main
      from public.dispatch_zones z
      where z.run_date = p_date and z.office_code = v_office
        and ( z.qty - coalesce((select count(*) from public.dispatch_assignments a
                                where a.run_date = p_date and a.common_id = z.common_id), 0) ) > 0
      order by ( z.qty - coalesce((select count(*) from public.dispatch_assignments a
                                   where a.run_date = p_date and a.common_id = z.common_id), 0) ) desc,
               z.common_id
      limit 1;

      if v_main is null then
        continue;  -- このドライバーに割り当てる荷物が無い
      end if;

      with picked as (
        select d.tracking_number
        from public.deliveries d
        where d.status = '未配車' and d.delivery_date = p_date and d.office_code = v_office and d.common_id = v_main
          and not exists (select 1 from public.dispatch_assignments a
                          where a.run_date = p_date and a.tracking_number = d.tracking_number)
        order by d.tracking_number
        limit v_remaining
      )
      insert into public.dispatch_assignments (run_date, tracking_number, office_code, common_id, driver_id, driver_kind, assign_rank)
      select p_date, p.tracking_number, v_office, v_main, v_driver.driver_id, '実', 1 from picked p;
      get diagnostics v_take = row_count;
      v_remaining := v_remaining - v_take;

      -- Phase2: 主担当に対し隣接ランク≤3のゾーンを積み増し（cap充填）
      loop
        exit when v_remaining <= 0;

        select z.common_id into v_adj
        from public.dispatch_zones z
        where z.run_date = p_date and z.office_code = v_office
          and public.zone_rank(v_main, z.common_id) <= 3
          and ( z.qty - coalesce((select count(*) from public.dispatch_assignments a
                                  where a.run_date = p_date and a.common_id = z.common_id), 0) ) > 0
        order by public.zone_rank(v_main, z.common_id),
                 ( z.qty - coalesce((select count(*) from public.dispatch_assignments a
                                     where a.run_date = p_date and a.common_id = z.common_id), 0) ) desc,
                 z.common_id
        limit 1;

        exit when v_adj is null;

        with picked as (
          select d.tracking_number
          from public.deliveries d
          where d.status = '未配車' and d.delivery_date = p_date and d.office_code = v_office and d.common_id = v_adj
            and not exists (select 1 from public.dispatch_assignments a
                            where a.run_date = p_date and a.tracking_number = d.tracking_number)
          order by d.tracking_number
          limit v_remaining
        )
        insert into public.dispatch_assignments (run_date, tracking_number, office_code, common_id, driver_id, driver_kind, assign_rank)
        select p_date, p.tracking_number, v_office, v_adj, v_driver.driver_id, '実',
               public.zone_rank(v_main, v_adj) from picked p;
        get diagnostics v_take = row_count;
        exit when v_take = 0;          -- 念のため無限ループ防止
        v_remaining := v_remaining - v_take;
      end loop;
    end loop;
  end loop;

  -- (4) 仮ドライバー：残った未配車を 営業所×共通ID でまとめ、推奨枠200個で区切る
  for v_grp in
    select d.office_code, d.common_id
    from public.deliveries d
    where d.status = '未配車' and d.common_id is not null and d.delivery_date = p_date
      and not exists (select 1 from public.dispatch_assignments a
                      where a.run_date = p_date and a.tracking_number = d.tracking_number)
    group by d.office_code, d.common_id
    order by d.office_code, d.common_id
  loop
    loop
      select count(*) into v_take
      from public.deliveries d
      where d.status = '未配車' and d.delivery_date = p_date and d.office_code = v_grp.office_code and d.common_id = v_grp.common_id
        and not exists (select 1 from public.dispatch_assignments a
                        where a.run_date = p_date and a.tracking_number = d.tracking_number);
      exit when v_take = 0;

      v_vnum := v_vnum + 1;
      v_vid  := '仮' || v_vnum;

      insert into public.dispatch_drivers (run_date, office_code, driver_id, driver_kind, skill, hours, cap, assigned_qty)
      values (p_date, v_grp.office_code, v_vid, '仮', null, null, 200, 0);

      with picked as (
        select d.tracking_number
        from public.deliveries d
        where d.status = '未配車' and d.delivery_date = p_date and d.office_code = v_grp.office_code and d.common_id = v_grp.common_id
          and not exists (select 1 from public.dispatch_assignments a
                          where a.run_date = p_date and a.tracking_number = d.tracking_number)
        order by d.tracking_number
        limit 200
      )
      insert into public.dispatch_assignments (run_date, tracking_number, office_code, common_id, driver_id, driver_kind, assign_rank)
      select p_date, p.tracking_number, v_grp.office_code, v_grp.common_id, v_vid, '仮', 1 from picked p;
    end loop;
  end loop;

  -- (5) 割当個数を集計して記録
  update public.dispatch_drivers dd
  set assigned_qty = coalesce((select count(*) from public.dispatch_assignments a
                               where a.run_date = p_date and a.driver_id = dd.driver_id), 0)
  where dd.run_date = p_date;
end;
$$;


-- =============================================================
-- §A. dry-run（書き込まない。集計・割当・不足・仮数だけ出す）
--   ※ deliveries は更新しないので、実行後も全件「未配車」のまま。
-- =============================================================
select public.dispatch_build(current_date);

-- A-1) ゾーン別荷量・分割
select office_code, common_id, municipality, qty, threshold, split_count
from public.dispatch_zones where run_date = current_date
order by office_code, common_id;
-- 期待: A01 OKZ_C=300(th174,split2)/OKZ_E=150(split1)/TYT_C=250(th191,split2)
--       C01 TKI_C=60(th206,split1)/CTA_C=40(th153,split1)

-- A-2) ドライバー cap と割当（承認外DRV004は出ない＝除外）
select office_code, driver_id, driver_kind, skill, hours, cap, assigned_qty
from public.dispatch_drivers where run_date = current_date
order by office_code, driver_kind, cap desc nulls last, driver_id;
-- 期待(実): DRV001 cap=160/DRV002 cap=108/DRV003 cap=176（DRV004は不在）
--           DRV003は TKI_C+CTA_C を束ねて assigned=100（≤176）

-- A-3) 営業所別の実割当/仮割当/仮人数・不足
select office_code,
       sum(case when driver_kind='実' then assigned_qty else 0 end) as real_assigned,
       sum(case when driver_kind='仮' then assigned_qty else 0 end) as virtual_assigned,
       count(*) filter (where driver_kind='仮')                     as virtual_count
from public.dispatch_drivers where run_date = current_date
group by office_code order by office_code;
-- 期待: A01 real=268 / virtual=432 / 仮3人  ｜ C01 real=100 / virtual=0 / 仮0人

-- A-4) dry-run では未配車のまま（書き込んでいない確認）
select count(*) as still_mihaisha
from public.deliveries where status = '未配車' and tracking_number like 'DSP-%';
-- 期待: 800（A01 700＋C01 100）＝まだ書き込んでいない


-- =============================================================
-- §B. 本実行（確定）：割当に従い driver_id 付与＋status=配車済み
--   ※ dry-run 結果に納得してから実行する。再計算してから反映（冪等）。
-- =============================================================
select public.dispatch_build(current_date);

update public.deliveries d
set driver_id = a.driver_id,
    status    = '配車済'
from public.dispatch_assignments a
where a.run_date = current_date
  and a.tracking_number = d.tracking_number;

-- 確定件数
select status, count(*) as cnt
from public.deliveries where tracking_number like 'DSP-%'
group by status order by status;
-- 期待: 配車済=800（未配車=0）
