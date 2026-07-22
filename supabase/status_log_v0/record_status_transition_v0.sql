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
--
-- 【2026-07-18 監査対応 MED-2】完了/不在への到達は record_delivery_result（delivery_result_v0）を
--   唯一の記録口にする。本関数は driver ロールから直接 to_status in (完了,不在) を呼ばれた場合は拒否し、
--   実際の遷移ロジックは非公開の record_status_transition_internal（authenticated へは GRANT しない）に
--   分離した。record_delivery_result は SECURITY DEFINER 同士の内部呼び出しとして internal を直接呼ぶため、
--   本関数の driver ガードを経由しない＝正規ルートのみ完了/不在に到達できる。
--   （関数所有者(postgres)は REVOKE FROM PUBLIC 後も自分が所有する関数を暗黙にEXECUTEできるため、
--     internal 関数は「authenticatedへの GRANT を出さない」だけで、SECURITY DEFINER関数からの
--     内部呼び出しは所有者権限で通り、authenticated からの直接RPC呼び出しだけを42501で塞げる。
--     session GUC・nonce等の複雑な仕掛けを使わない現実解＝README「MED-2対応」参照）。
--   同時に、driverロールからの呼び出しは source を常に '配達' に固定上書きする（source詐称の防止）。
-- =============================================================

-- ② 内部実装（非公開）：実際の遷移ロジック本体。
--   authenticated には GRANT しない＝直接のRPC呼び出しはできない。呼べるのは所有者権限で動く
--   SECURITY DEFINER関数（本ファイル内の record_status_transition ラッパー・record_delivery_result）のみ。
create or replace function public.record_status_transition_internal(
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

  -- ── 遷移検証：6.10 の線形順序＋日内再訪の戻し遷移のみ許可 ──
  --   未配車→配車済→仕分済→配送中→完了／不在
  --   不在→配送中 … 日内再訪（LOL確定2026-07-18）。同日中の再配達で「不在」から配送を再開できる。
  --     完了からの戻し（完了→配送中 等）は追加しない＝完了は引き続き終端。
  v_allowed := (v_from, p_to_status) in (
    ('未配車','配車済'),
    ('配車済','仕分済'),
    ('仕分済','配送中'),
    ('配送中','完了'),
    ('配送中','不在'),
    ('不在','配送中')
  );

  if not v_allowed then
    raise exception '許可されない遷移です（% → %）。許可: 未配車→配車済→仕分済→配送中→完了／不在（不在→配送中は日内再訪で可）',
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

-- internal は authenticated へ GRANT しない（default: PUBLICへのEXECUTEも無い＝revoke不要だが明示しておく）。
-- 呼べるのは所有者（本ファイル群を適用したロール＝postgres）が実行する SECURITY DEFINER関数内部からのみ。
revoke execute on function public.record_status_transition_internal(text, text, text, text) from public;

comment on function public.record_status_transition_internal(text, text, text, text) is
  'ステータス遷移の実体（6.10）。線形遷移検証＋scope認可＋status更新＋ログ記録を不可分に。SECURITY DEFINER。'
  'authenticatedへは非公開＝record_status_transition（公開ラッパー）／record_delivery_result からの内部呼び出し専用（MED-2対応）';


-- =============================================================
-- ③ 公開ラッパー：record_status_transition（既存の呼び出し元はシグネチャ不変のまま安全になる）
--   ・driverロールから to_status in (完了,不在) への直接呼び出しは拒否（記録口=record_delivery_result 経由必須）。
--   ・driverロールからの呼び出しは source を常に '配達' に固定（source詐称防止）。
--   ・それ以外（system/hq/depot/area/shipper、または driver からの完了/不在以外の遷移）はそのまま internal に委譲。
--     ＝ dispatch_status_hook_v0.sql・pipeline_demo_v0・region_itami_demo_v0・check_status_log_v0.sql 等の
--       既存の直接呼び出し（すべて auth.uid()なし=system扱い）は今までどおり動く。
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
  v_role   text := public.my_role();
  v_source text := p_source;
begin
  if v_role = 'driver' then
    -- source詐称防止：driverからの直接呼び出しは常に source='配達' に固定する。
    v_source := '配達';

    -- MED-2：driverが完了/不在へ直接遷移させることは禁止。記録口(record_delivery_result)を必ず経由させる。
    --   record_delivery_result 自体はこの公開ラッパーを経由せず record_status_transition_internal を
    --   直接呼ぶため、正規の完了/不在記録はここでは一切ブロックされない。
    if p_to_status in ('完了','不在') then
      raise exception '完了/不在への遷移は配達実績の記録口（record_delivery_result）経由でのみ行えます（driver直接呼び出しは不可）'
        using errcode = '42501';
    end if;
  end if;

  return public.record_status_transition_internal(p_tracking_number, p_to_status, v_source, p_note);
end $$;

revoke execute on function public.record_status_transition(text, text, text, text) from public;
grant  execute on function public.record_status_transition(text, text, text, text) to authenticated;

comment on function public.record_status_transition(text, text, text, text) is
  'ステータス遷移の記録口（6.10）公開ラッパー。driverからの完了/不在直接遷移を拒否しsourceを固定した上で'
  'record_status_transition_internal に委譲（MED-2対応）。SECURITY DEFINER';
