-- =============================================================
-- 指示書: シフト管理 v0.7 — 3つの書き込み口（DEFINER関数・認可は関数内で強制）
--   §12.2.1 日次シフト（申請/承認/直接入力）／§8.7 稼働申請（ドライバーアプリ）／認証v1.1
-- 実行: Supabase SQL Editor（postgres）で丸ごと Run。冪等。
--   前提: rls_v0（my_role/my_driver/my_office/my_office_drivers）・work_schedules_ext_v0.sql（列拡張）。
-- =============================================================
-- 【固定の前提】新基盤・検証環境のみ・全テーブルRLS・**書込はDEFINER関数のみ・write policyは作らない**・秘密は環境変数。
--
-- 【3つの書き込み口（認可が各々違う門番）】
--   apply_shift          … driver 本人のみ。request_period_days 期間チェック・二重申請防止。
--   approve_reject_shift … area。my_office_drivers() 配下のみ。状態遷移（申請中→承認/却下）。
--   office_direct_shift  … area。my_office_drivers() 配下のみ。承認状態で直接登録（フォールバック）。
--   ＝認可は関数内で強制するので、RPC 直叩きでも門番が効く。work_schedules に write policy は作らない。
--
-- 【なりすまし防止（指示書）】
--   apply_shift は driver_id を引数で受けず、認可元 my_driver() から取る（他人になりすまして申請できない）。
--   approve/office_direct は area が対象 driver_id を指定するが、my_office_drivers() に含まれる配下のみ許可。
--
-- 【移植元】work_schedule_v0.sql §1〜§4 のロジック（ハードコード DRV001 等を除去・引数化）。
-- =============================================================


-- =============================================================
-- ① apply_shift（driver 本人が申請）
--   ・driver_id は my_driver() から（引数で受けない＝なりすまし防止）。
--   ・期間チェック: work_date が [today, today + request_period_days] の将来日。
--   ・二重申請防止: 同一 (driver_id, work_date, work_type) が既にあれば 'already'。
--   ・希望エリア: preferred_areas（common_id[]）を任意で受ける（CHECK で妥当性検証）。
-- =============================================================
create or replace function public.apply_shift(
  p_work_date       date,
  p_work_type       text,
  p_preferred_areas text[] default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver text := public.my_driver();
  v_office text;
  v_period integer;
  v_id     bigint;
  v_status_existing text;
begin
  -- 認可: driver 本人のみ
  if public.my_role() is distinct from 'driver' or v_driver is null then
    raise exception '稼働申請できるのは担当ドライバー本人のみです (role=%)',
      coalesce(public.my_role(), '(未設定)') using errcode = '42501';
  end if;

  if p_work_type is null or btrim(p_work_type) = '' then
    raise exception '稼働区分（work_type）は必須です' using errcode = '22023';
  end if;

  -- 所属営業所と申請可能期間を取得
  select d.office_code, o.request_period_days into v_office, v_period
  from public.drivers d join public.offices o on o.office_code = d.office_code
  where d.driver_id = v_driver;
  if v_office is null then
    raise exception 'ドライバーの所属営業所が解決できません（driver=%）', v_driver using errcode = 'P0002';
  end if;

  -- 期間チェック（今日以降 かつ request_period_days 以内。NULL=無制限）
  if p_work_date < current_date
     or (v_period is not null and p_work_date > current_date + v_period) then
    raise exception
      '申請可能期間外です（%）。%〜% の範囲で申請してください。',
      p_work_date, current_date,
      case when v_period is null then '無制限' else (current_date + v_period)::text end
      using errcode = '22023';
  end if;

  -- 二重申請防止：★1日1稼働のため判定キーは (driver, date)（work_type は問わない）。
  --   UNIQUE(driver_id, work_date) と同じキーに寄せる（3つ組のままだと別 work_type の2件目が
  --   INSERT 時に 23505 で不親切に落ちるため。レビュー指摘）。
  --   ・既存が「申請中/承認」なら already（同日は1稼働まで）。
  --   ・既存が「却下」なら **本人の再申請を許す**：同じ行を 申請中 に戻して希望も更新する
  --     （却下後は3関数に削除口が無く、tuple一致で always already だと再申請経路が塞がる。レビューLOW）。
  select id, application_status into v_id, v_status_existing
  from public.work_schedules
  where driver_id = v_driver and work_date = p_work_date;
  if found then
    if v_status_existing = '却下' then
      update public.work_schedules
         set work_type = p_work_type, application_status = '申請中', preferred_areas = p_preferred_areas
       where id = v_id;
      return jsonb_build_object('result','reapplied','id',v_id,
        'driver_id',v_driver,'work_date',p_work_date,'work_type',p_work_type,'status','申請中');
    end if;
    return jsonb_build_object('result','already','id',v_id,
      'driver_id',v_driver,'work_date',p_work_date,'work_type',p_work_type,'status',v_status_existing);
  end if;

  insert into public.work_schedules (driver_id, work_date, work_type, application_status, preferred_areas)
  values (v_driver, p_work_date, p_work_type, '申請中', p_preferred_areas)
  returning id into v_id;

  return jsonb_build_object('result','applied','id',v_id,
    'driver_id',v_driver,'work_date',p_work_date,'work_type',p_work_type,'status','申請中');
end $$;

comment on function public.apply_shift(date, text, text[]) is
  '稼働申請（§8.7・driver本人のみ）。driver_id は my_driver() から取得（なりすまし防止）。期間チェック・二重申請防止・希望エリア(common_id[])。SECURITY DEFINER';
revoke execute on function public.apply_shift(date, text, text[]) from public;
grant  execute on function public.apply_shift(date, text, text[]) to authenticated;


-- =============================================================
-- ② approve_reject_shift（area が承認/却下）
--   ・area が my_office_drivers() 配下のドライバーの「申請中」を 承認/却下 に遷移。
--   ・状態遷移は 申請中→承認 / 申請中→却下 のみ（それ以外は拒否）。
-- =============================================================
create or replace function public.approve_reject_shift(
  p_id       bigint,
  p_decision text          -- '承認' | '却下'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row     record;
  v_updated integer;
begin
  if public.my_role() is distinct from 'area' then
    raise exception '承認/却下できるのは営業所(area)のみです (role=%)',
      coalesce(public.my_role(), '(未設定)') using errcode = '42501';
  end if;
  if p_decision not in ('承認','却下') then
    raise exception '決定は 承認/却下 のみ（%）', coalesce(p_decision,'(null)') using errcode = '23514';
  end if;

  select ws.id, ws.driver_id, ws.application_status into v_row
  from public.work_schedules ws where ws.id = p_id;
  if not found then
    raise exception '対象の稼働予定が見つかりません (id=%)', p_id using errcode = 'P0002';
  end if;

  -- 配下ドライバーのみ（他営業所は拒否）
  if v_row.driver_id not in (select public.my_office_drivers()) then
    raise exception 'この稼働予定は自営業所の配下ではありません (id=%, driver=%)', p_id, v_row.driver_id
      using errcode = '42501';
  end if;

  -- 状態遷移: 申請中 → 承認/却下 のみ
  update public.work_schedules
     set application_status = p_decision
   where id = p_id and application_status = '申請中';
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception '申請中の稼働予定のみ承認/却下できます（現状: %）', v_row.application_status
      using errcode = '23514';
  end if;

  return jsonb_build_object('result','decided','id',p_id,
    'driver_id',v_row.driver_id,'status',p_decision);
end $$;

comment on function public.approve_reject_shift(bigint, text) is
  '稼働予定の承認/却下（§12.2.1・area・my_office_drivers 配下のみ）。申請中→承認/却下 の遷移のみ。SECURITY DEFINER';
revoke execute on function public.approve_reject_shift(bigint, text) from public;
grant  execute on function public.approve_reject_shift(bigint, text) to authenticated;


-- =============================================================
-- ③ office_direct_shift（area が直接登録・フォールバック）
--   ・アプリ未使用者・訂正用。area が配下ドライバーの稼働を「承認」状態で直接登録。
--   ・二重登録防止（同一 driver/date/work_type）。希望エリア任意。
-- =============================================================
create or replace function public.office_direct_shift(
  p_driver_id       text,
  p_work_date       date,
  p_work_type       text,
  p_preferred_areas text[] default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint;
  v_status_existing text;
begin
  if public.my_role() is distinct from 'area' then
    raise exception '直接入力できるのは営業所(area)のみです (role=%)',
      coalesce(public.my_role(), '(未設定)') using errcode = '42501';
  end if;
  -- ★入力必須チェックは認可ゲートの前後で先に（NIT: p_driver_id=NULL だと NOT IN が NULL 評価で
  --   認可 raise をすり抜け、下流の NOT NULL(23502) 頼みになる。ここで明示的に弾く。レビュー指摘）。
  if p_driver_id is null or btrim(p_driver_id) = '' then
    raise exception 'ドライバーID（driver_id）は必須です' using errcode = '22023';
  end if;
  if p_work_type is null or btrim(p_work_type) = '' then
    raise exception '稼働区分（work_type）は必須です' using errcode = '22023';
  end if;

  -- 配下ドライバーのみ
  if p_driver_id not in (select public.my_office_drivers()) then
    raise exception 'このドライバーは自営業所の配下ではありません (driver=%)', p_driver_id
      using errcode = '42501';
  end if;

  -- 二重登録防止：★1日1稼働のため判定キーは (driver, date)（UNIQUE と同じキー）。
  --   既存が却下なら承認で上書き（訂正用の直接入力＝却下を承認に戻せる）。それ以外は already。
  select id, application_status into v_id, v_status_existing
  from public.work_schedules
  where driver_id = p_driver_id and work_date = p_work_date;
  if found then
    if v_status_existing = '却下' then
      update public.work_schedules
         set work_type = p_work_type, application_status = '承認', preferred_areas = p_preferred_areas
       where id = v_id;
      return jsonb_build_object('result','registered','id',v_id,
        'driver_id',p_driver_id,'work_date',p_work_date,'work_type',p_work_type,'status','承認');
    end if;
    return jsonb_build_object('result','already','id',v_id,
      'driver_id',p_driver_id,'work_date',p_work_date,'work_type',p_work_type,'status',v_status_existing);
  end if;

  insert into public.work_schedules (driver_id, work_date, work_type, application_status, preferred_areas)
  values (p_driver_id, p_work_date, p_work_type, '承認', p_preferred_areas)   -- 直接入力＝承認で作成
  returning id into v_id;

  return jsonb_build_object('result','registered','id',v_id,
    'driver_id',p_driver_id,'work_date',p_work_date,'work_type',p_work_type,'status','承認');
end $$;

comment on function public.office_direct_shift(text, date, text, text[]) is
  '営業所直接入力（§12.2.1・area・my_office_drivers 配下のみ）。承認状態で直接登録（フォールバック）。二重登録防止。SECURITY DEFINER';
revoke execute on function public.office_direct_shift(text, date, text, text[]) from public;
grant  execute on function public.office_direct_shift(text, date, text, text[]) to authenticated;


-- =============================================================
-- ④ 確認：work_schedules に write policy が無い（＝直接INSERT/UPDATEは全ロール不可・書込は3関数のみ）
-- =============================================================
select
  (select count(*) from pg_policies where schemaname='public' and tablename='work_schedules'
     and cmd in ('INSERT','UPDATE','DELETE','ALL'))                       as work_write_policies,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname in
       ('apply_shift','approve_reject_shift','office_direct_shift')
     and p.prosecdef)                                                     as definer_write_funcs;
-- 期待: work_write_policies=0 / definer_write_funcs=3。
