-- =============================================================
-- 指示書: 配車 割当優先順位（希望エリア第一）v0.3 — ②③④⑥ dispatch_build に希望エリア第一を追加
--   §12.5.2。offices.preferred_area_first が真のとき、Phase1 主担当ゾーン選定で
--   「担当ドライバーの希望エリア(preferred_areas)一致」を最優先にする最小改修（order by に1句差込）。
-- 実行: Supabase SQL Editor（postgres）で丸ごと Run。冪等（create or replace）。
-- =============================================================
-- 【dispatch_build の正・適用順（重要）】
--   dispatch_build は create or replace で「関数まるごと」置き換わる。現時点の正は
--   shift_mgmt v0.7 の cap_wire_shift_labels_v0.sql（cap 時間側=shift_labels・(0)事前チェック付き）。
--   本ファイルは **その cap_wire 版を完全転記**したうえで、#28 の変更だけを加える:
--     ・declare に v_pref_first / v_pref_areas を追加。
--     ・(1) に offices を join し dispatch_drivers.preferred_area_first（割当モード）を記録。
--     ・(3) で営業所ごとに offices.preferred_area_first を、ドライバーごとに work_schedules.preferred_areas
--       を読む（1日1稼働 UNIQUE=shift_mgmt により (driver,date) の希望は一意）。
--     ・Phase1 主担当の order by 先頭に「希望エリア一致を最優先」の case 句を **1句だけ差込**。
--     ・Phase1/Phase2 の割当 insert に off_preference（希望外＝#29 と同一条件）を記録。
--   骨格（(0)事前チェック・(2)ゾーン候補=area_master・(3)cap順・Phase2 隣接充填・(4)仮ドライバー・
--   (5)集計・cap 式=#27・1配送物=1ドライバー）は **1文字も変えない**。
--   ⚠ 適用順: ④(migrate_functions) → cap_wire → **本ファイル** の順。cap_wire を後から流すと #28 が巻き戻る。
--
-- 【希望外（#29 と同一条件・業務A確定 2026-07-20）】
--   希望外 = 割当 common_id が担当ドライバーの preferred_areas に含まれない（実ドライバーのみ）。
--   ・preferred_areas が NULL（希望未指定）は「希望なし＝どこでも可」＝希望外に数えない（off_preference=false）。
--   ・仮ドライバーの割当は off_preference を記録しない（NULL）。#29 は仮割当を別指標で数える。
-- =============================================================


-- =============================================================
-- §0. 記録列（⑥・冪等に追加）
--   dispatch_assignments.off_preference … 希望外フラグ（実の割当のみ・#29 が件数集計に使う）。
--   dispatch_drivers.preferred_area_first … その配車でどのモードで割り当てたか（監査・#29 用）。
-- =============================================================
alter table public.dispatch_assignments add column if not exists off_preference boolean;
comment on column public.dispatch_assignments.off_preference is
  '希望外フラグ（§12.5.3・#29）: 割当 common_id が担当ドライバーの preferred_areas に含まれない=true。'
  '実ドライバーのみ記録・preferred_areas NULL は false（希望なし＝数えない）・仮ドライバーは NULL';

alter table public.dispatch_drivers add column if not exists preferred_area_first boolean;
comment on column public.dispatch_drivers.preferred_area_first is
  'この配車でのモード（offices.preferred_area_first を割当時に記録）。true=希望エリア第一で割り当てた';


-- =============================================================
-- §1. dispatch_build（cap_wire 版の完全転記＋#28 の差込）
-- =============================================================
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
  v_missing text;
  v_pref_first boolean;   -- ★#28: 対象営業所の offices.preferred_area_first
  v_pref_areas text[];    -- ★#28: 対象ドライバーの希望エリア（common_id[]）
begin
  -- 当日分の作業テーブルをリセット（冪等）
  delete from public.dispatch_assignments where run_date = p_date;
  delete from public.dispatch_zones       where run_date = p_date;
  delete from public.dispatch_drivers     where run_date = p_date;

  -- ★(0) 事前チェック（cap 計算の前に置く）：承認済み稼働の (office_code, work_type) が
  --   shift_labels に定義されているか。未定義があれば cap が silent に欠落するため名指しで停止。
  select string_agg(distinct m.office_code || '／' || m.work_type, '、' order by m.office_code || '／' || m.work_type)
    into v_missing
  from (
    select d.office_code, ws.work_type
    from public.work_schedules ws
    join public.drivers d on d.driver_id = ws.driver_id
    where ws.work_date = p_date
      and ws.application_status = '承認'
      and not exists (
        select 1 from public.shift_labels sl
        where sl.office_code = d.office_code and sl.work_type = ws.work_type)
  ) m;
  if v_missing is not null then
    raise exception
      '稼働区分のラベルが未定義です（営業所／稼働区分: %）。管理者設定で定義してください（seed_office_shift_labels で標準配布も可）。',
      v_missing using errcode = 'P0002';
  end if;

  -- (1) 実ドライバーを動的構築：cap＝スキル×稼働時間（shift_labels 参照・cap 式=#27 無変更）。
  --   ★#28: offices を join し preferred_area_first（割当モード）を dispatch_drivers に記録する。
  insert into public.dispatch_drivers (run_date, office_code, driver_id, driver_kind, skill, hours, cap, assigned_qty, preferred_area_first)
  select p_date, d.office_code, d.driver_id, '実',
         d.skill_per_hour, sl.hours, (d.skill_per_hour * sl.hours)::int, 0,
         coalesce(o.preferred_area_first, false)
  from public.work_schedules ws
  join public.drivers      d  on d.driver_id   = ws.driver_id
  join public.shift_labels sl on sl.office_code = d.office_code and sl.work_type = ws.work_type
  join public.offices      o  on o.office_code  = d.office_code
  where ws.work_date = p_date
    and ws.application_status = '承認';

  -- (2) ゾーン候補：共通ID別荷量＋分割（閾値・1.8倍・2.6倍・以降ceil）
  insert into public.dispatch_zones (run_date, office_code, common_id, municipality, qty, threshold, split_count)
  select p_date, dv.office_code, dv.common_id,
         (select am.municipality from public.area_master am
           where am.common_id = dv.common_id and am.is_valid
           order by am.priority asc nulls last, am.town_key limit 1),
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
    -- ★#28: 営業所の割当モードを読む（関数内で分岐＝4呼出経路で一貫）。
    select coalesce(preferred_area_first, false) into v_pref_first
    from public.offices where office_code = v_office;

    for v_driver in
      select * from public.dispatch_drivers
      where run_date = p_date and office_code = v_office and driver_kind = '実'
      order by cap desc, driver_id
    loop
      v_remaining := v_driver.cap;

      -- ★#28: このドライバーの希望エリア（1日1稼働 UNIQUE=shift_mgmt により (driver,date) は1行）。
      select preferred_areas into v_pref_areas
      from public.work_schedules
      where driver_id = v_driver.driver_id and work_date = p_date and application_status = '承認';

      -- Phase1: 主担当ゾーン。
      --   ★#28: preferred_area_first が真かつ希望エリアに含まれる common_id を最優先（order by に1句差込）。
      --   偽 or 希望未設定なら case は全ゾーンで 1 となり、現行の「残荷量最大→common_id」に自然に戻る（回帰一致）。
      select z.common_id into v_main
      from public.dispatch_zones z
      where z.run_date = p_date and z.office_code = v_office
        and ( z.qty - coalesce((select count(*) from public.dispatch_assignments a
                                where a.run_date = p_date and a.common_id = z.common_id), 0) ) > 0
      order by
        case when v_pref_first and v_pref_areas is not null and z.common_id = any(v_pref_areas)
             then 0 else 1 end,                                              -- ★#28: 希望エリア一致を最優先
        ( z.qty - coalesce((select count(*) from public.dispatch_assignments a
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
      insert into public.dispatch_assignments (run_date, tracking_number, office_code, common_id, driver_id, driver_kind, assign_rank, off_preference)
      select p_date, p.tracking_number, v_office, v_main, v_driver.driver_id, '実', 1,
             case when v_pref_areas is null then false                       -- ★#28: 希望なし=希望外に数えない
                  when v_main = any(v_pref_areas) then false                 --        希望内
                  else true end                                             --        希望あり but 不一致=希望外
      from picked p;
      get diagnostics v_take = row_count;
      v_remaining := v_remaining - v_take;

      -- Phase2: 主担当に対し隣接ランク≤3のゾーンを積み増し（cap充填）。骨格無変更。
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
        insert into public.dispatch_assignments (run_date, tracking_number, office_code, common_id, driver_id, driver_kind, assign_rank, off_preference)
        select p_date, p.tracking_number, v_office, v_adj, v_driver.driver_id, '実',
               public.zone_rank(v_main, v_adj),
               case when v_pref_areas is null then false                     -- ★#28: 希望外（Phase2積み増しにも同条件）
                    when v_adj = any(v_pref_areas) then false
                    else true end
        from picked p;
        get diagnostics v_take = row_count;
        exit when v_take = 0;          -- 念のため無限ループ防止
        v_remaining := v_remaining - v_take;
      end loop;
    end loop;
  end loop;

  -- (4) 仮ドライバー：残った未配車を 営業所×共通ID でまとめ、推奨枠200個で区切る。骨格無変更。
  --   ★#28: 仮ドライバー行にも割当モードを記録（off_preference は仮では記録しない＝NULL）。
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

      insert into public.dispatch_drivers (run_date, office_code, driver_id, driver_kind, skill, hours, cap, assigned_qty, preferred_area_first)
      values (p_date, v_grp.office_code, v_vid, '仮', null, null, 200, 0,
              (select coalesce(preferred_area_first, false) from public.offices where office_code = v_grp.office_code));

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

  -- (5) 割当個数を集計して記録。骨格無変更。
  update public.dispatch_drivers dd
  set assigned_qty = coalesce((select count(*) from public.dispatch_assignments a
                               where a.run_date = p_date and a.driver_id = dd.driver_id), 0)
  where dd.run_date = p_date;
end;
$$;

comment on function public.dispatch_build(date) is
  '配車計算本体（④=area_master 参照・cap 時間側=shift_labels）＋#28 希望エリア第一（offices.preferred_area_first 真で '
  'Phase1 主担当に希望エリア一致を最優先）。骨格・cap 式=#27 無変更。off_preference(希望外)/preferred_area_first(モード)を記録';
