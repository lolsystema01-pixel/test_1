-- =============================================================
-- 指示書: 荷主マスタ v0.2（shippers テーブル作成＋直接seed＋RLS＋FK）
--   荷主（shippers）を作り、直接seedで HACHI EXPRESS(SHIP01) を登録。
--   shipper_id は text 確定（deliveries.shipper_id / profiles.shipper_id と同流儀。uuidは使わない）。
--   対応: 要件定義 9.2（荷主：荷主ID・名称）／7.2 荷主ポータル（shipper_id=my_shipper() の土台）。
-- 実行: Supabase SQL Editor にコピペして Run。
-- 前提: dbschema_v0（deliveries 等）／rls_v0（profiles・my_shipper()）作成済み。
--
-- ★ 実行順（README参照）:
--   1) このファイル（create+seed+RLS。未解決名が残っていれば FK は自動スキップしNOTICE）
--   2) import_shipper_map_v0.sql（取込経路の差し替え＋既存名称→コード backfill）
--   3) このファイルを「もう一度」Run（未解決0件になり FK が張られる）
--   ※ create は if not exists / seed は upsert / RLS は drop→create なので何度でも安全に再実行可。
-- =============================================================


-- §1. shippers テーブル（最小列：コード＋名称のみ）------------
--   契約・KPI参照範囲は後続（T2-P2）。v0は shipper_id・名称まで。
create table if not exists public.shippers (
  shipper_id   text primary key,   -- 荷主ID（コード。deliveries.shipper_id / profiles.shipper_id と揃える text）
  shipper_name text not null        -- 荷主名称（用語集v0.1: 荷主）
);
comment on table  public.shippers              is 'マスタ: 荷主（荷主ID・名称）。契約・KPI参照範囲は範囲外（T2-P2）';
comment on column public.shippers.shipper_id   is '荷主ID（コード）。text。uuidは使わない';
comment on column public.shippers.shipper_name is '荷主名称（用語集v0.1: 荷主）';

-- 名称→コード解決を一意にする（同名の二重登録を防ぐ）。
create unique index if not exists ux_shippers_name on public.shippers (shipper_name);


-- §2. 直接seed（正準ダミーデータ規格 v1）-----------------------
--   ・SHIP01 = HACHI EXPRESS … 取込ダミーの実体（csv_import）。突合は名称1対応で足りる。
--   ・SHIP02 = ニコイチ運輸   … RLS分離デモ用の2社目（荷主の「自社のみ＝範囲外0件」を実証）。
--     ※ 各 seed（rls_v0 等）が参照する SHIP02 の FK もこれで成立する。
--   upsert で冪等（再実行しても2行のまま）。
insert into public.shippers (shipper_id, shipper_name) values
  ('SHIP01', 'HACHI EXPRESS'),
  ('SHIP02', 'ニコイチ運輸')
on conflict (shipper_id) do update set shipper_name = excluded.shipper_name;


-- §3. RLS（SELECT可視範囲）------------------------------------
--   hq=全 / shipper=自社行（shipper_id=my_shipper()） / area・depot=全（荷主名表示用・任意）。
--   driver ロールのポリシーは置かない（＝driverはshippersを読めない。offices と同じ流儀）。
--   ※ shippers は非機微の名称マスタ。area/depot は配下荷物の荷主名表示のため全行参照可とする。
alter table public.shippers enable row level security;

grant select on public.shippers to authenticated;

drop policy if exists shippers_hq      on public.shippers;
drop policy if exists shippers_shipper on public.shippers;
drop policy if exists shippers_area    on public.shippers;
drop policy if exists shippers_depot   on public.shippers;

create policy shippers_hq on public.shippers for select to authenticated
  using ( public.my_role() = 'hq' );

create policy shippers_shipper on public.shippers for select to authenticated
  using ( public.my_role() = 'shipper' and shipper_id = public.my_shipper() );

create policy shippers_area on public.shippers for select to authenticated
  using ( public.my_role() = 'area' );

create policy shippers_depot on public.shippers for select to authenticated
  using ( public.my_role() = 'depot' );


-- §4. FK（deliveries.shipper_id → shippers.shipper_id）---------
--   ★「未解決0件」を満たしてから張る。名称（HACHI EXPRESS 等）が残っている／
--     マスタ未登録のコードがある状態では張らず、NOTICE で案内（import_shipper_map_v0.sql を先に）。
--   冪等: 既存FKを drop してから条件を満たせば張り直す。
do $$
declare
  v_unresolved int;
  v_examples   text;
begin
  -- 既存FKを掃除（再実行・張り直しのため）
  alter table public.deliveries drop constraint if exists deliveries_shipper_id_fkey;

  -- マスタに無い shipper_id（NULL以外）の件数＝未解決件数
  select count(*) into v_unresolved
  from public.deliveries d
  where d.shipper_id is not null
    and not exists (select 1 from public.shippers s where s.shipper_id = d.shipper_id);

  if v_unresolved = 0 then
    alter table public.deliveries
      add constraint deliveries_shipper_id_fkey
      foreign key (shipper_id) references public.shippers(shipper_id);
    raise notice 'FK deliveries_shipper_id_fkey を作成しました（未解決0件）。';
  else
    select string_agg(distinct quote_literal(d.shipper_id), ', ')
      into v_examples
    from public.deliveries d
    where d.shipper_id is not null
      and not exists (select 1 from public.shippers s where s.shipper_id = d.shipper_id);
    raise notice 'FKは未作成。未解決 % 件（マスタに無い値: %）。import_shipper_map_v0.sql を実行後、本ファイルを再Runしてください。',
      v_unresolved, v_examples;
  end if;
end $$;
