-- =============================================================
-- 配達実績の記録口（ステータス遷移）v0 — ② 記録口関数 record_status_transition
--   対応: 6.10 第1項。status の書き込み口を関数1本に限定（書込みRLS整備の代替）。
-- 実行: Supabase SQL Editor。前提=status_log_v0.sql。
-- =============================================================
-- 【設計選択（指示書・要LOL確認 → 採用）】SECURITY DEFINER ＋ 関数内認可。
--   ・テーブルの書込みRLSを整備しなくても、status の更新を本関数1本に限定して安全に行う。
--   ・呼び出し元のロール／帰属（my_role()/my_office()/my_driver()/my_shipper()/my_depot_offices()）で
--     「その荷物に触ってよいか（＝deliveries で見える範囲か）」を認可。範囲外は拒否。
--   ・遷移は 6.10 の線形順序のみ許可。許可外（順序飛ばし・逆行・同一）は拒否。
--   ・①遷移検証 → ②deliveries.status 更新 → ③ログ1行記録 を1トランザクションで不可分に実行。
-- =============================================================

create or replace function public.record_status_transition(
  p_tracking_number text,
  p_to_status       text,
  p_source          text default '手動',
  p_note            text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_role       text := public.my_role();
  v_actor      text := coalesce(public.my_role(), 'system');
  v_from       text;
  v_office     text;
  v_driver     text;
  v_shipper    text;
  v_allowed    boolean;
  v_can_touch  boolean;
  v_log_id     bigint;
begin
  -- 対象荷物（現状態＋帰属）を取得（DEFINER＝RLS回避のため自前で認可する）
  select d.status, d.office_code, d.driver_id, d.shipper_id
    into v_from, v_office, v_driver, v_shipper
  from public.deliveries d
  where d.tracking_number = p_tracking_number;

  if not found then
    raise exception '対象の荷物が見つかりません（問合番号=%）', p_tracking_number
      using errcode = 'P0002';
  end if;

  -- ── 認可：呼び出し元が「その荷物を見える範囲」か（deliveries RLS と同じ判定）──
  --   system（auth.uid() なし＝SQL Editor／配車バッチ等）は許可。
  if v_uid is null then
    v_can_touch := true;
  else
    v_can_touch := case v_role
      when 'hq'      then true
      when 'depot'   then v_office = any (select public.my_depot_offices())
      when 'area'    then v_office = public.my_office()
      when 'driver'  then v_driver = public.my_driver()
      when 'shipper' then v_shipper = public.my_shipper()
      else false
    end;
  end if;

  if not v_can_touch then
    raise exception 'この荷物のステータスを変更する権限がありません（問合番号=%・role=%）',
      p_tracking_number, v_actor using errcode = '42501';
  end if;

  -- ── 遷移検証：6.10 の線形順序のみ許可 ──
  --   未配車→配車済→仕分済→配送中→完了／不在
  v_allowed := (v_from, p_to_status) in (
    ('未配車','配車済'),
    ('配車済','仕分済'),
    ('仕分済','配送中'),
    ('配送中','完了'),
    ('配送中','不在')
  );

  if not v_allowed then
    raise exception '許可されない遷移です（% → %）。許可: 未配車→配車済→仕分済→配送中→完了／不在',
      coalesce(v_from,'(null)'), coalesce(p_to_status,'(null)') using errcode = '23514';
  end if;

  -- ② status 更新（同一トランザクション）
  update public.deliveries
     set status = p_to_status
   where tracking_number = p_tracking_number;

  -- ③ ログ記録（from＝旧status）
  insert into public.delivery_status_log
    (tracking_number, from_status, to_status, changed_by, actor, source, note)
  values
    (p_tracking_number, v_from, p_to_status, v_uid, v_actor, p_source, p_note)
  returning id into v_log_id;

  return jsonb_build_object(
    'log_id', v_log_id,
    'tracking_number', p_tracking_number,
    'from_status', v_from,
    'to_status', p_to_status,
    'actor', v_actor,
    'source', p_source
  );
end $$;

revoke execute on function public.record_status_transition(text, text, text, text) from public;
grant  execute on function public.record_status_transition(text, text, text, text) to authenticated;

comment on function public.record_status_transition(text, text, text, text) is
  'ステータス遷移の記録口（6.10）。線形遷移検証＋scope認可＋status更新＋ログ記録を不可分に。SECURITY DEFINER';
