-- =============================================================
-- 指示書: シフト管理 v0.7 — cap 結線（v0.4）：時間側参照を shift_hours→shift_labels へ差替
--   cap＝スキル×時間 の**式は #27 のまま無変更**。時間側の参照だけ営業所別 shift_labels に切替える。
-- 実行: Supabase SQL Editor（postgres）。★前提: shift_labels_office_v0.sql 適用済み。
-- =============================================================
-- 【固定の前提】新基盤・検証環境のみ・全テーブルRLS・書込DEFINER一本化・秘密は環境変数。
--
-- 【dispatch_build の正について（重要）】
--   本ファイルは dispatch_build を create or replace する。dispatch_build の実体は
--   vocab_fix_v0/migrate_functions_to_area_master_v0.sql（④・area_master 参照版）が正で、
--   本ファイルは **その④版を完全転記**したうえで、変更点を2つだけ加えている:
--     (a) (1) の直前に「承認済み稼働の (office_code, work_type) が shift_labels に在るか」を
--         事前チェックし、未定義なら **名指しで raise**（フォールバックしない＝指示書『必ず定義させる』）。
--     (b) (1) の cap の時間側 join を `shift_hours(work_type)` → `shift_labels(office_code, work_type)` に差替。
--   それ以外（(2)ゾーン候補=area_master／(3)配分／(4)仮ドライバー／(5)集計）は④版の**1文字も変えない転記**。
--   ⚠ このファイルは④より後に適用すること（先に④、次に本ファイル）。dispatch_v0.sql の旧版(shift_hours参照)
--     を後から流すと巻き戻る（dispatch_v0.sql は RETIRED 表明済み）。
--
-- 【is_absent について（スコープ外）】
--   指示書は cap 変更を「時間側の参照だけ差替」と明確に絞っている。is_absent（欠勤）による cap 除外は
--   本ファイルでは行わない（列は work_schedules_ext_v0.sql で用意済み＝器のみ・消費側は将来）。
--   ＝ printer_model / auto_logout と同じ「器あり・消費未実装」の扱い。承認済みは従来どおり cap に入る。
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
begin
  -- 当日分の作業テーブルをリセット（冪等）
  delete from public.dispatch_assignments where run_date = p_date;
  delete from public.dispatch_zones       where run_date = p_date;
  delete from public.dispatch_drivers     where run_date = p_date;

  -- ★(0) 事前チェック（cap 計算の前に置く）：承認済み稼働の (office_code, work_type) が
  --   shift_labels に定義されているか。未定義があれば cap が silent に欠落する（ドライバーが
  --   join から落ちて cap 不足＝静かな劣化）ため、ここで **名指しで停止** する。フォールバックしない。
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

  -- (1) 実ドライバーを動的構築：cap＝スキル×稼働時間。承認済み稼働予定のみ。
  --   ★時間側は営業所別 shift_labels(office_code, work_type) を参照（cap の式=#27 は無変更）。
  --     office は driver 経由で解決（work_schedules に office 列は持たない）。
  insert into public.dispatch_drivers (run_date, office_code, driver_id, driver_kind, skill, hours, cap, assigned_qty)
  select p_date, d.office_code, d.driver_id, '実',
         d.skill_per_hour, sl.hours, (d.skill_per_hour * sl.hours)::int, 0
  from public.work_schedules ws
  join public.drivers      d  on d.driver_id   = ws.driver_id
  join public.shift_labels sl on sl.office_code = d.office_code and sl.work_type = ws.work_type
  where ws.work_date = p_date
    and ws.application_status = '承認';

  -- (2) ゾーン候補：共通ID別荷量＋分割（閾値・1.8倍・2.6倍・以降ceil）
  --     ※対象は「当日(delivery_date=p_date)の未配車」のみ。別日の在庫は対象外。
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

comment on function public.dispatch_build(date) is
  '配車計算本体（④=area_master 参照）＋シフト管理v0.7の cap 時間側を shift_labels(office_code,work_type) へ差替。'
  'cap 式=#27 無変更。承認済み稼働のラベル未定義は事前チェックで名指し停止（フォールバックなし）';
