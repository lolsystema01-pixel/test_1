-- =============================================================
-- 荷主ポータル：CSVアップロード取込のための SECURITY DEFINER 関数
--   ★ service_role を使わず・INSERTポリシー（書込みRLS）も足さずに、
--     「荷主が自社の荷物だけ登録できる」唯一の書込み口を提供する。
--   ・deliveries の RLS は SELECT のみのまま（ユーザーの直接 INSERT は今までどおり拒否）。
--   ・書けるのはこの関数だけ。関数内で shipper_id := my_shipper() に固定するため、
--     呼び出した荷主自身の shipper_id 以外は絶対に書けない（バイパスを関数内に閉じる）。
--   対応: 要件定義 7.2（荷主ポータル）/ 6.1（問合番号で重複排除・未配車・取込バッチID）/ 11.3。
-- 実行: Supabase SQL Editor。前提: rls_v0（my_role/my_shipper）＋荷主マスタ v0（shippers・recipient_name列）。
-- =============================================================

create or replace function public.shipper_import_deliveries(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sid      text;
  v_batch    text;
  v_received int;
  v_inserted int;
begin
  -- 呼び出し元が荷主であることを関数内で強制（auth.uid() → my_role()/my_shipper()）。
  --   ＝ shipper 以外・帰属無しは取込不可。403 相当（PostgREST が 42501→HTTP403 に変換）。
  if public.my_role() is distinct from 'shipper' or public.my_shipper() is null then
    raise exception '荷主アカウントのみ取込できます。' using errcode = '42501';
  end if;

  v_sid := public.my_shipper();                                   -- ★自社IDに固定（CSVの値は使わない）
  v_batch := 'BATCH-' || to_char(now(), 'YYYYMMDD-HH24MISS');     -- 取込バッチID
  v_received := coalesce(jsonb_array_length(p_rows), 0);

  -- 重複排除取込（問合番号で ON CONFLICT DO NOTHING・status=未配車）。
  with src as (
    select
      nullif(btrim(r->>'tracking_number'), '')      as tracking_number,
      nullif(r->>'delivery_date', '')::date         as delivery_date,
      nullif(btrim(r->>'address'), '')              as address,
      nullif(btrim(r->>'recipient_name'), '')       as recipient_name
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) as r
  ),
  ins as (
    insert into public.deliveries
      (tracking_number, delivery_date, address, recipient_name, status, shipper_id, import_batch_id)
    select tracking_number, delivery_date, address, recipient_name, '未配車', v_sid, v_batch
    from src
    where tracking_number is not null and address is not null    -- 念のためのガード（本検証はサーバ側）
    on conflict (tracking_number) do nothing
    returning 1
  )
  select count(*) into v_inserted from ins;

  return jsonb_build_object(
    'batch_id',   v_batch,
    'shipper_id', v_sid,
    'received',   v_received,
    'inserted',   v_inserted
  );
end;
$$;

-- 実行権限：認証ユーザーのみ（既定の PUBLIC 実行権は剥がす）。anon/直接ユーザーは my_shipper()=null で弾かれる。
revoke execute on function public.shipper_import_deliveries(jsonb) from public;
grant  execute on function public.shipper_import_deliveries(jsonb) to authenticated;

comment on function public.shipper_import_deliveries(jsonb) is
  '荷主ポータルCSV取込。呼び出し荷主の shipper_id(my_shipper())で deliveries へ重複排除取込。SELECT専用RLSのまま唯一の書込み口。';
