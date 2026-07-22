-- =============================================================
-- 手順 2/4: 全テーブルRLS有効化 ＋ SELECTポリシー
-- 実行: SQL Editor に貼り付けて Run（profiles_v0.sql の後）
-- =============================================================
-- ・今回は SELECT の可視範囲のみ（INSERT/UPDATE/DELETE は別指示書）。
-- ・荷物・問合Index = 5ロールの詳細ポリシー。
-- ・それ以外 = 最低ライン（本部=全行 ＋ 営業所=自営業所 等）。
-- ・複数の permissive ポリシーは OR で合成される。
-- =============================================================

-- ---- 全テーブルでRLSを有効化（前提A：全テーブルRLS）----
alter table public.profiles       enable row level security;
alter table public.depots         enable row level security;
alter table public.offices        enable row level security;
alter table public.zone_plan      enable row level security;
-- ⚠ RETIRED（2026-07-17）: address_master は撤去済み（⑤）。後継 area_master の RLS 有効化は
--   area_master_v0/area_master_schema_v0.sql:50 が持つ。
-- alter table public.address_master enable row level security;
alter table public.deliveries     enable row level security;
alter table public.delivery_index enable row level security;
alter table public.drivers        enable row level security;
alter table public.work_schedules enable row level security;

-- ---- テーブルへのSELECT権限を authenticated に付与 ----
-- RLS(行の絞り込み)の前に、まずテーブルへのアクセス権(GRANT)が必要。
-- これが無いと authenticated は「permission denied」で弾かれる（RLS以前の段階）。
-- 実際に見える行は、この上で各ポリシーが行レベルに絞り込む（GRANT=入口の許可のみ）。
-- ⚠ RETIRED（2026-07-17）: address_master は撤去済み（⑤）。後継は area_master で、
--   GRANT と hq ポリシーは area_master_v0/area_master_schema_v0.sql:52-55 が持つ。
--   → この GRANT から address_master を外した（残すと再実行時に「テーブル無し」で落ちる）。
grant select on
  public.profiles, public.depots, public.offices, public.zone_plan,
  public.deliveries, public.delivery_index,
  public.drivers, public.work_schedules
to authenticated;

-- 再実行できるよう既存ポリシーを掃除 --------------------------
drop policy if exists profiles_self           on public.profiles;
drop policy if exists profiles_hq             on public.profiles;
drop policy if exists deliveries_hq           on public.deliveries;
drop policy if exists deliveries_depot        on public.deliveries;
drop policy if exists deliveries_area         on public.deliveries;
drop policy if exists deliveries_driver       on public.deliveries;
drop policy if exists deliveries_shipper      on public.deliveries;
drop policy if exists delivery_index_visible  on public.delivery_index;
drop policy if exists offices_hq              on public.offices;
drop policy if exists offices_area            on public.offices;
drop policy if exists offices_depot           on public.offices;
drop policy if exists drivers_hq              on public.drivers;
drop policy if exists drivers_area            on public.drivers;
drop policy if exists drivers_self            on public.drivers;
drop policy if exists depots_hq               on public.depots;
drop policy if exists depots_own              on public.depots;
drop policy if exists work_schedules_hq       on public.work_schedules;
drop policy if exists work_schedules_area     on public.work_schedules;
drop policy if exists work_schedules_driver   on public.work_schedules;
drop policy if exists zone_plan_hq            on public.zone_plan;
-- ⚠ RETIRED（2026-07-17）: address_master は撤去済み（⑤）。
-- drop policy if exists address_master_hq       on public.address_master;


-- =============================================================
-- profiles：自分の行 ＋ 本部は全行
-- =============================================================
create policy profiles_self on public.profiles for select to authenticated
  using ( user_id = auth.uid() );
create policy profiles_hq on public.profiles for select to authenticated
  using ( public.my_role() = 'hq' );


-- =============================================================
-- 配送データ（荷物）：5ロールのSELECTポリシー
-- =============================================================
-- 本部：全行
create policy deliveries_hq on public.deliveries for select to authenticated
  using ( public.my_role() = 'hq' );

-- 拠点管理：配下営業所の行（既定の1:1では自営業所相当）
create policy deliveries_depot on public.deliveries for select to authenticated
  using ( public.my_role() = 'depot'
          and office_code in (select public.my_depot_offices()) );

-- 営業所：自営業所の行のみ（営業所コード一致）
create policy deliveries_area on public.deliveries for select to authenticated
  using ( public.my_role() = 'area'
          and office_code = public.my_office() );

-- ドライバー：自分の担当荷物のみ（ドライバーID一致）
create policy deliveries_driver on public.deliveries for select to authenticated
  using ( public.my_role() = 'driver'
          and driver_id = public.my_driver() );

-- 荷主：自社の荷物のみ（荷主ID一致）
create policy deliveries_shipper on public.deliveries for select to authenticated
  using ( public.my_role() = 'shipper'
          and shipper_id = public.my_shipper() );


-- =============================================================
-- 問合Index：親である荷物が見えるものだけ見える（荷物RLSを継承）
--   deliveries の SELECT はロール別RLSで絞られるため、その可視集合に
--   含まれる問合番号のみ可視＝荷物と同じ範囲になる。
-- =============================================================
create policy delivery_index_visible on public.delivery_index for select to authenticated
  using ( tracking_number in (select tracking_number from public.deliveries) );


-- =============================================================
-- 荷物・問合Index以外：最低ライン（本部=全行 ＋ 営業所=自営業所 等）
--   詳細範囲は別指示書。ここでは本部全行を基本に、自然に絞れる範囲のみ付与。
-- =============================================================

-- offices：本部=全行 / 営業所=自営業所 / 拠点=配下営業所
create policy offices_hq on public.offices for select to authenticated
  using ( public.my_role() = 'hq' );
create policy offices_area on public.offices for select to authenticated
  using ( public.my_role() = 'area' and office_code = public.my_office() );
create policy offices_depot on public.offices for select to authenticated
  using ( public.my_role() = 'depot' and depot_code = public.my_depot() );

-- drivers（機微：個人情報）：本部=全行 / 営業所=自営業所所属 / ドライバー=自分の行のみ
--   ※他ドライバーの個人情報は0件（v0.2で driver=自分 を追加）。
create policy drivers_hq on public.drivers for select to authenticated
  using ( public.my_role() = 'hq' );
create policy drivers_area on public.drivers for select to authenticated
  using ( public.my_role() = 'area' and office_code = public.my_office() );
create policy drivers_self on public.drivers for select to authenticated
  using ( public.my_role() = 'driver' and driver_id = public.my_driver() );

-- depots：本部=全行 / 拠点・営業所=自分の拠点
create policy depots_hq on public.depots for select to authenticated
  using ( public.my_role() = 'hq' );
create policy depots_own on public.depots for select to authenticated
  using ( public.my_role() in ('depot','area') and depot_code = public.my_depot() );

-- work_schedules（機微：他者の稼働情報）：本部=全行 / 営業所=自営業所所属ドライバー分 / ドライバー=自分のみ
--   ※他ドライバーの稼働予定は0件（check で実証する）。
create policy work_schedules_hq on public.work_schedules for select to authenticated
  using ( public.my_role() = 'hq' );
create policy work_schedules_area on public.work_schedules for select to authenticated
  using ( public.my_role() = 'area' and driver_id in (select public.my_office_drivers()) );
create policy work_schedules_driver on public.work_schedules for select to authenticated
  using ( public.my_role() = 'driver' and driver_id = public.my_driver() );

-- zone_plan / address_master：本部=全行（詳細範囲は別指示書）
create policy zone_plan_hq on public.zone_plan for select to authenticated
  using ( public.my_role() = 'hq' );
-- ⚠ RETIRED（2026-07-17）: address_master は撤去済み（⑤）。policy はテーブルと共に消滅済み。
--   後継 area_master の hq ポリシーは area_master_v0/area_master_schema_v0.sql:53-55 が持つ。
-- create policy address_master_hq on public.address_master for select to authenticated
--   using ( public.my_role() = 'hq' );
