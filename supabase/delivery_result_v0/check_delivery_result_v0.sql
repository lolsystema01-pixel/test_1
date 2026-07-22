-- =============================================================
-- 配達実績 v0 確認SQL — 主張=検証 1:1 ／ 範囲外0件の実証
-- 実行: delivery_result_v0.sql → seed_delivery_result_v0.sql の後。各ブロックを個別に実行。
-- 前提: rls_v0/seed_accounts_v0.sql 適用済み（下記ダミーUUIDが profiles に存在）。
--   hq='00000000-0000-0000-0000-000000000001'
--   area A01='00000000-0000-0000-0000-0000000000a1' ／ area C01='00000000-0000-0000-0000-0000000000c1'
--   driver DRV001='00000000-0000-0000-0000-0000000000d1'
--   shipper SHIP01='00000000-0000-0000-0000-0000000000f1'
-- =============================================================

-- ⓪ 現状（このモジュールの5件のstatus分布）------------------------------
select status, count(*) from public.deliveries
  where tracking_number between '900000000301' and '900000000305'
  group by status order by status;
-- 期待: 完了=3・不在=2


-- ① 主張=検証1:1：完了/不在の内訳・delivery_results件数・遷移ログ件数 ----
select
  (select count(*) from public.deliveries
    where tracking_number between '900000000301' and '900000000305' and status='完了')     as 完了件数,
  (select count(*) from public.deliveries
    where tracking_number between '900000000301' and '900000000305' and status='不在')     as 不在件数,
  (select count(*) from public.delivery_results
    where tracking_number between '900000000301' and '900000000305')                        as delivery_results件数,
  (select count(*) from public.delivery_results
    where tracking_number between '900000000301' and '900000000305' and driver_id='DRV001') as driver_id一致件数,
  (select count(*) from public.delivery_status_log
    where tracking_number between '900000000301' and '900000000305')                        as 遷移ログ件数;
-- 期待: 完了件数=3・不在件数=2・delivery_results件数=5・driver_id一致件数=5・遷移ログ件数=10（5件×仕分済→配送中→結果の2遷移）

-- ①b GPS null許容の実証（305はGPS取得失敗を模擬）------------------------
select tracking_number, result, lat, lng from public.delivery_results
  where tracking_number = '900000000305';
-- 期待: result='不在'・lat=null・lng=null（GPS失敗でも記録が止まらない）


-- ② 範囲外0件の実証 -------------------------------------------------------
-- ②a shipper（自社荷物でも delivery_results は0件＝ポリシーにshipper分岐なし＝構造的に不可視）
begin;
  set local request.jwt.claims = '{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000000f1"}';
  set local role authenticated;
  select count(*) as "shipperから見えるdelivery_results行数(0期待)"
  from public.delivery_results
  where tracking_number between '900000000301' and '900000000305';
rollback;
-- 期待: 0（★shipperは自社荷物の配達実績も見えない。状況照会は delivery_status_public 経由に限定する設計）

-- ②b 他営業所（area C01）から見た本モジュール分＝0件 ----------------------
begin;
  set local request.jwt.claims = '{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000000c1"}';
  set local role authenticated;
  select count(*) as "area(C01)から見える本モジュール分(0期待)"
  from public.delivery_results
  where tracking_number between '900000000301' and '900000000305';
rollback;
-- 期待: 0（A01のDRV001分はC01からは見えない）

-- ②c anon はテーブルにアクセスできない（GRANT無し）------------------------
begin;
  set local role anon;
  select count(*) from public.delivery_results;
rollback;
-- 期待: ERROR  permission denied for table delivery_results（errcode 42501）


-- ③ 正当な可視性（対比：見えるべき人には見える）----------------------------
-- ③a hq＝全件の中に本モジュール5件が含まれる
begin;
  set local request.jwt.claims = '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000001"}';
  set local role authenticated;
  select count(*) as "hqから見える本モジュール分(5期待)"
  from public.delivery_results
  where tracking_number between '900000000301' and '900000000305';
rollback;
-- 期待: 5

-- ③b area A01＝自営業所所属ドライバー(DRV001)分が見える
begin;
  set local request.jwt.claims = '{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000000a1"}';
  set local role authenticated;
  select count(*) as "area(A01)から見える本モジュール分(5期待)"
  from public.delivery_results
  where tracking_number between '900000000301' and '900000000305';
rollback;
-- 期待: 5

-- ③c driver DRV001＝自分の実績5件が見える
begin;
  set local request.jwt.claims = '{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000000d1"}';
  set local role authenticated;
  select count(*) as "driver(DRV001)本人から見える件数(5期待)"
  from public.delivery_results
  where tracking_number between '900000000301' and '900000000305';
rollback;
-- 期待: 5

-- =============================================================
-- 合格条件との対応
--   ・完了/不在の内訳が主張どおり（3/2）                         … ⓪①
--   ・delivery_results が record_delivery_result 経由で1行/件     … ①
--   ・delivery_status_log が2行/件（仕分済→配送中→結果）不可分   … ①
--   ・GPS取得失敗でも記録が止まらない（lat/lng=null許容）        … ①b
--   ・範囲外0件（shipper構造的0件／他営業所0件／anon権限エラー） … ②a②b②c
--   ・可視範囲内は正しく見える（hq/area/driver）                 … ③a③b③c
-- =============================================================
