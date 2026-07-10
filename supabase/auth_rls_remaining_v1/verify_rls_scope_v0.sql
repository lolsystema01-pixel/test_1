-- =============================================================
-- 指示書: 認証・権限 残課題 v1.1 — ③ 機微テーブルの「範囲外0件」証明
-- 実行: Supabase SQL Editor。ブロック単位（begin〜rollback）で実行すること。
-- =============================================================
-- 【なぜ SQL Editor で証明できるのか】
--   SQL Editor は既定で postgres（BYPASSRLS）＝RLSが効かない。
--   しかし `set local role authenticated` で非特権ロールに降格し、
--   `set local request.jwt.claims` で auth.uid() を与えると **RLSが実際に適用される**。
--   → アプリを介さずに「範囲外0件」を機械的に証明できる（rollback するので副作用なし）。
--   ※ Storage の実ダウンロードURL経路だけは Storage API を通るため、最終サインオフは実機で
--     （verify_rls_scope_checklist_v0.md）。
--
-- 【証明の原則（主張=検証 1:1）】
--   「範囲外=0件」だけでは不十分（RLSが全部を塞いでいても0件になる）。
--   必ず **「範囲内 > 0件」** と対で確認する。両方を各ブロックに含めている。
-- =============================================================


-- =============================================================
-- §0. 検証に使うユーザー（profiles）を確認して UUID を控える
-- =============================================================
select p.user_id, p.role, p.office_code, p.depot_code, p.driver_id, p.shipper_id, u.email
from public.profiles p
left join auth.users u on u.id = p.user_id
order by p.role, p.office_code nulls last;
-- ★ 以降の各ブロックの '<UID>' を、上の user_id に置換して実行する。
--   role ごとに1人ずつ（hq / area / depot / driver / shipper）用意されていること。


-- =============================================================
-- §1. area（営業所）— 自営業所のみ・他営業所0件
--   ★ '<AREA_UID>' を area ユーザーの user_id に置換
-- =============================================================
begin;
set local request.jwt.claims = '{"role":"authenticated","sub":"<AREA_UID>"}';
set local role authenticated;

select 'role/office 確認' as check, public.my_role() as role, public.my_office() as office;
-- 期待: role=area / office=自営業所コード

-- 1-1) deliveries：自営業所>0・他営業所=0
select 'deliveries 範囲内(>0)'  as check, count(*) as cnt from public.deliveries where office_code = public.my_office()
union all
select 'deliveries 範囲外(=0)',        count(*)          from public.deliveries where office_code is distinct from public.my_office();

-- 1-2) drivers：自営業所所属>0・他営業所=0
select 'drivers 範囲内(>0)'    as check, count(*) as cnt from public.drivers where office_code = public.my_office()
union all
select 'drivers 範囲外(=0)',          count(*)          from public.drivers where office_code is distinct from public.my_office();

-- 1-3) work_schedules：自営業所ドライバーのみ（範囲外=0）
select 'work_schedules 範囲外(=0)' as check, count(*) as cnt
from public.work_schedules where driver_id not in (select public.my_office_drivers());

-- 1-4) offices / shippers / print_history / delivery_index / delivery_status_log：範囲外=0
select 'offices 範囲外(=0)'            as check, count(*) as cnt from public.offices        where office_code is distinct from public.my_office()
union all
select 'print_history 範囲外(=0)',            count(*)          from public.print_history  where office_code is distinct from public.my_office()
union all
select 'delivery_index 範囲外(=0)',           count(*)          from public.delivery_index di
  where not exists (select 1 from public.deliveries d where d.tracking_number = di.tracking_number)
union all
select 'delivery_status_log 範囲外(=0)',      count(*)          from public.delivery_status_log l
  where not exists (select 1 from public.deliveries d where d.tracking_number = l.tracking_number);
-- 期待: すべて 0（見える荷物に連動していること＝連動先が見えない行は見えない）

-- 1-5) hq限定テーブル：area からは全部0件
select 'area_master(hq限定)'      as tbl, count(*) as should_be_0 from public.area_master
union all select 'area_master_staging',   count(*) from public.area_master_staging
union all select 'zone_plan',             count(*) from public.zone_plan
union all select 'renumber_plan',         count(*) from public.renumber_plan
union all select 'dispatch_zones',        count(*) from public.dispatch_zones
union all select 'dispatch_drivers',      count(*) from public.dispatch_drivers
union all select 'dispatch_assignments',  count(*) from public.dispatch_assignments
union all select 'shift_hours',           count(*) from public.shift_hours;
-- 期待: すべて 0

-- 1-6) profiles：自分だけ（他人=0）
select 'profiles 自分(=1)' as check, count(*) as cnt from public.profiles where user_id = auth.uid()
union all
select 'profiles 他人(=0)',        count(*)          from public.profiles where user_id <> auth.uid();

-- 1-7) Storage：自営業所パス>0・他営業所パス=0（3バケット）
select 'storage 範囲内(>0)' as check, count(*) as cnt
from storage.objects where bucket_id in ('carry-sheets','dispatch-sheets','godoor-csv')
  and (storage.foldername(name))[1] = public.my_office()
union all
select 'storage 範囲外(=0)',       count(*)
from storage.objects where bucket_id in ('carry-sheets','dispatch-sheets','godoor-csv')
  and (storage.foldername(name))[1] is distinct from public.my_office();

rollback;


-- =============================================================
-- §2. driver（ドライバー）— 自分の担当のみ
--   ★ '<DRIVER_UID>' を driver ユーザーの user_id に置換
-- =============================================================
begin;
set local request.jwt.claims = '{"role":"authenticated","sub":"<DRIVER_UID>"}';
set local role authenticated;

select 'role/driver 確認' as check, public.my_role() as role, public.my_driver() as driver_id;

select 'deliveries 範囲内(>0)' as check, count(*) as cnt from public.deliveries where driver_id = public.my_driver()
union all
select 'deliveries 範囲外(=0)',        count(*)          from public.deliveries where driver_id is distinct from public.my_driver()
union all
select 'work_schedules 範囲外(=0)',    count(*)          from public.work_schedules where driver_id is distinct from public.my_driver()
union all
select 'drivers 範囲外(=0)',           count(*)          from public.drivers where driver_id is distinct from public.my_driver()
union all
select 'storage 範囲外(=0)',           count(*)          from storage.objects where bucket_id in ('carry-sheets','dispatch-sheets','godoor-csv');
-- 期待: 範囲内>0／範囲外はすべて 0（ドライバーは帳票Storageを一切見られない）

rollback;


-- =============================================================
-- §3. shipper（荷主）— 自分の荷主分のみ
--   ★ '<SHIPPER_UID>' を shipper ユーザーの user_id に置換
-- =============================================================
begin;
set local request.jwt.claims = '{"role":"authenticated","sub":"<SHIPPER_UID>"}';
set local role authenticated;

select 'deliveries 範囲内(>0)' as check, count(*) as cnt from public.deliveries where shipper_id = public.my_shipper()
union all
select 'deliveries 範囲外(=0)',        count(*)          from public.deliveries where shipper_id is distinct from public.my_shipper()
union all
select 'shippers 範囲外(=0)',          count(*)          from public.shippers   where shipper_id is distinct from public.my_shipper()
union all
select 'drivers 範囲外(=0)',           count(*)          from public.drivers
union all
select 'storage 範囲外(=0)',           count(*)          from storage.objects where bucket_id in ('carry-sheets','dispatch-sheets','godoor-csv');
-- 期待: 範囲内>0／範囲外はすべて 0（荷主はドライバー・帳票を一切見られない）

rollback;


-- =============================================================
-- §4. depot（拠点）— 配下営業所のみ
--   ★ '<DEPOT_UID>' を depot ユーザーの user_id に置換
-- =============================================================
begin;
set local request.jwt.claims = '{"role":"authenticated","sub":"<DEPOT_UID>"}';
set local role authenticated;

select 'depot/配下office 確認' as check, public.my_depot() as depot,
       (select string_agg(o, ',') from public.my_depot_offices() o) as offices;

select 'deliveries 範囲内(>0)' as check, count(*) as cnt from public.deliveries where office_code in (select public.my_depot_offices())
union all
select 'deliveries 範囲外(=0)',        count(*)          from public.deliveries where office_code not in (select public.my_depot_offices())
union all
select 'offices 範囲外(=0)',           count(*)          from public.offices    where office_code not in (select public.my_depot_offices())
union all
select 'storage 範囲外(=0)',           count(*)          from storage.objects
  where bucket_id in ('carry-sheets','dispatch-sheets','godoor-csv')
    and (storage.foldername(name))[1] not in (select public.my_depot_offices());
-- 期待: 範囲内>0／範囲外はすべて 0

rollback;


-- =============================================================
-- §5. hq（本部）— 全件見える（塞ぎすぎていないことの確認）
--   ★ '<HQ_UID>' を hq ユーザーの user_id に置換
-- =============================================================
begin;
set local request.jwt.claims = '{"role":"authenticated","sub":"<HQ_UID>"}';
set local role authenticated;

select 'deliveries(>0)' as tbl, count(*) as cnt from public.deliveries
union all select 'area_master(>0)',  count(*) from public.area_master
union all select 'drivers(>0)',      count(*) from public.drivers
union all select 'storage(全office)', count(*) from storage.objects
  where bucket_id in ('carry-sheets','dispatch-sheets','godoor-csv');
-- 期待: すべて >0（hqは全office）

rollback;


-- =============================================================
-- §6. 書込は DEFINER 関数のみ（業務テーブルへの直接書込は全ロール拒否）
--   ★ '<AREA_UID>' を area ユーザーの user_id に置換
-- =============================================================
begin;
set local request.jwt.claims = '{"role":"authenticated","sub":"<AREA_UID>"}';
set local role authenticated;

-- 以下は必ず失敗する（write policy を作らない設計）。エラーになることを確認したらブロックごとrollback。
-- update public.deliveries set status = '完了' where tracking_number = (select tracking_number from public.deliveries limit 1);
-- 期待: ERROR: new row violates row-level security policy （または 0 rows updated）

select 'deliveries への write policy 数(=0)' as check, count(*) as cnt
from pg_policies where schemaname='public' and tablename='deliveries' and cmd <> 'SELECT';
-- 期待: 0（書込は SECURITY DEFINER 関数のみ）

rollback;
