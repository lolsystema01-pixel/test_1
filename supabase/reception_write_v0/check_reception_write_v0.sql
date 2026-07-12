-- =============================================================
-- 受付テーブル＋書き込み口 v0.2 — 確認
--   ①件数突合 ②二重受付 ③上書き履歴 ④帯設定一覧 ⑤なりすましRLS ⑥write policy ⑦anon実在番号
-- 実行: Supabase SQL Editor。reception_write_v0.sql ＋ seed_reception_write_v0.sql の後。
--   ①〜④・⑥は postgres（RLSバイパス）のまま実行してよい。
--   ⑤・⑦は なりすまし（set local role authenticated/anon）で実際にRLS/権限を効かせて確認する。
--   ★ ⑤・⑦の各ブロックは `begin;` 〜 `rollback;` を**丸ごと**実行すること
--     （`set local` は同一トランザクション内でしか効かない。部分実行すると RLS バイパスのまま走り、
--      範囲外が0にならない＝誤判定になる）。すべて rollback で終わるので DB には一切書き込まれない。
--   複数文は最後の結果しか表示されないため、ブロック（コメント区切り）ごとに Ctrl+Enter で個別実行する。
-- =============================================================


-- =============================================================
-- ① 件数突合（seedの期待値と1件単位で一致・OK/NG判定列）
-- =============================================================

-- ①-a: 検証deliveriesの帰属（RLS検証の前提。office/driver/shipperが正しいこと）------------------
select tracking_number, office_code, driver_id, shipper_id, status,
       case
         when tracking_number = '900000099001' and office_code = 'A01' and driver_id = 'DRV001' and shipper_id = 'SHIP01' then 'OK'
         when tracking_number = '900000099002' and office_code = 'A01' and driver_id = 'DRV001' and shipper_id = 'SHIP02' then 'OK'
         when tracking_number = '900000099999' and office_code = 'A01' then 'OK'
         else 'NG'
       end as judge
from public.deliveries
where tracking_number in ('900000099001', '900000099002', '900000099999')
order by tracking_number;
-- 期待: 全行 judge=OK（900000099002 が driver_id=DRV001・shipper_id=SHIP02＝追加要件の対）


-- ①-b: 受付の件数突合（tracking_number別・1件単位でOK/NG）---------------------------------------
with expect(tracking_number, exp_band, exp_verified, exp_total, exp_active) as (
  values
    ('900000099001',    'demo9000', true,  1, 1),
    ('900000099002',    'demo9000', true,  2, 1),
    ('KAZ900000099099', 'kaz',      false, 1, 1)
),
actual as (
  select tracking_number,
         count(*)                                    as total,
         count(*) filter (where status = '受付済')   as active,
         min(band_key)                                as band_key,
         bool_and(verified) filter (where status = '受付済') as active_verified
  from public.reception_requests
  where tracking_number in (select tracking_number from expect)
  group by tracking_number
)
select e.tracking_number,
       e.exp_total,    coalesce(a.total, 0)  as act_total,
       e.exp_active,   coalesce(a.active, 0) as act_active,
       e.exp_band,     a.band_key,
       e.exp_verified, a.active_verified,
       case when coalesce(a.total, 0) = e.exp_total
             and coalesce(a.active, 0) = e.exp_active
             and a.band_key is not distinct from e.exp_band
             and a.active_verified is not distinct from e.exp_verified
            then 'OK' else 'NG' end as judge
from expect e
left join actual a using (tracking_number)
order by e.tracking_number;
-- 期待: 全行 judge=OK


-- ①-c: 合計（3件のtracking_numberで計4行・アクティブ3行）---------------------------------------
select count(*) as total_rows,
       count(*) filter (where status = '受付済') as active_rows,
       count(*) filter (where status = '取消')   as canceled_rows,
       case when count(*) = 4
             and count(*) filter (where status = '受付済') = 3
             and count(*) filter (where status = '取消') = 1
            then 'OK' else 'NG' end as judge
from public.reception_requests
where tracking_number in ('900000099001', '900000099002', 'KAZ900000099099');
-- 期待: total_rows=4 / active_rows=3 / canceled_rows=1 / judge=OK


-- =============================================================
-- ② 二重受付（register_reception再呼び出し→duplicate）
--   900000099001 は①の時点で受付済（活性1行）。overwrite=falseで再登録を試みると
--   二重受付(N-5)として弾かれ、既存の受付番号を返すだけで行は増えないこと。
--   ★ 万一「created」になっても書込みが残らないよう begin〜rollback で包む。
--   ⑤の流儀に合わせ、読み取り専用の事前SELECTはbeginの外・ブロック内はjudge列付き1本のSELECTに畳む。
-- =============================================================

-- 事前確認（読み取り専用。beginの外）: 現在の活性受付番号 --------------------------------------------
select receipt_no as existing_receipt_no_before
from public.reception_requests
where tracking_number = '900000099001' and status = '受付済';

begin;

with regcall as (
  select public.register_reception(
    '900000099001', '再配達', '2026-08-05', '午後', null, 'web', null, false
  ) as r
)
select c.r ->> 'result'               as result,
       c.r ->> 'existing_receipt_no'  as existing_receipt_no,
       e.existing_receipt_no_before,
       case when c.r ->> 'result' = 'duplicate'
             and c.r ->> 'existing_receipt_no' = e.existing_receipt_no_before
            then 'OK' else 'NG' end as judge
from regcall c
cross join (
  select receipt_no as existing_receipt_no_before
  from public.reception_requests
  where tracking_number = '900000099001' and status = '受付済'
) e;
-- 期待: judge=OK（result=duplicate かつ existing_receipt_no が事前確認の受付番号と一致・行は増えない）

rollback;


-- =============================================================
-- ③ 上書き履歴（取消1＋受付済1の2行）
-- =============================================================
select receipt_no, status, reception_type, channel, time_slot, created_at
from public.reception_requests
where tracking_number = '900000099002'
order by created_at;
-- 期待: 2行。古い方 status=取消(reception_type=置き配・channel=line) ／
--        新しい方 status=受付済(reception_type=時間変更・channel=phone・time_slot=18-20)

select tracking_number,
       count(*)                                  as total_rows,
       count(*) filter (where status = '取消')   as canceled_rows,
       count(*) filter (where status = '受付済') as active_rows,
       case when count(*) = 2
             and count(*) filter (where status = '取消') = 1
             and count(*) filter (where status = '受付済') = 1
            then 'OK' else 'NG' end as judge
from public.reception_requests
where tracking_number = '900000099002'
group by tracking_number;
-- 期待: total_rows=2 / canceled_rows=1 / active_rows=1 / judge=OK


-- =============================================================
-- ④ 帯設定の一覧表示（解禁状態が見える。行変更だけで帯追加・照会解禁が完結する設計の確認）
-- =============================================================
select band_key, prefix, digits, lookup_enabled, verify_on_reception, enabled, label
from public.number_bands
order by band_key;
-- 期待: demo9000/req/dsp … lookup_enabled=true・verify_on_reception=true（enabled=true）
--       kaz/a/four        … 仮値のため lookup_enabled=false・verify_on_reception=false


-- =============================================================
-- ⑤ なりすましRLS（area/driver/shipperの範囲内>0・範囲外0件）
--   verify_rls_scope_v0.sql §1 と同型: begin〜rollback丸ごと実行・先頭行がなりすまし確認・
--   1ブロック1SELECT・safe_count（GRANT無し/表無しを -1/-2 として捕捉）。
-- =============================================================

-- §0. 検証に使うユーザー（profiles）を確認して UUID を控える -----------------------------------
select p.user_id, p.role, p.office_code, p.driver_id, p.shipper_id
from public.profiles p
where (p.role = 'area'    and p.office_code = 'A01')
   or (p.role = 'driver'  and p.driver_id   = 'DRV001')
   or (p.role = 'shipper' and p.shipper_id in ('SHIP01', 'SHIP02'))
order by p.role, p.shipper_id nulls last;
-- ★ 以降の各ブロックの '<○○_UID>' を、上の user_id に置換してから実行する。
--   SHIP02 のprofilesが無い場合は apps/shipper_portal_v0/supabase/promote_test_shipper_v0.sql 等で
--   先に昇格しておく（本チェックでは新規に作らない＝機微アカウントの直書き禁止のため）。


-- §1. area（A01）— 自営業所(900000099001/002)は見える・KAZ未照合(hqのみ可視)は0件 --------------
--   ★ '<AREA_A01_UID>' を置換 → begin〜rollback を丸ごと実行
begin;
create function pg_temp.safe_count(q text) returns bigint language plpgsql as $fn$
declare n bigint;
begin
  execute 'select count(*) from (' || q || ') _x' into n;
  return n;
exception
  when insufficient_privilege then return -1;   -- GRANT無し＝アクセス不可
  when undefined_table        then return -2;   -- 表が存在しない
end $fn$;

set local request.jwt.claims = '{"role":"authenticated","sub":"<AREA_A01_UID>"}';
set local role authenticated;

select seq, check_name,
       case cnt when -1 then 'GRANT無し(アクセス不可)' when -2 then 'テーブル無し' else cnt::text end as cnt_disp,
       expect,
       case when (expect = '=0' and cnt <= 0) or (expect = '>0' and cnt > 0) then 'OK' else 'NG' end as judge,
       detail
from (values
  (0, 'なりすまし確認（role=area）',
      (case when public.my_role() = 'area' and public.my_office() = 'A01' then 1 else 0 end)::bigint, '>0',
      coalesce(public.my_role(), '(null)') || ' / ' || coalesce(public.my_office(), '(null)')),
  (1, '範囲内（自営業所A01: 900000099001/002）',
      pg_temp.safe_count($q$select 1 from public.reception_requests where tracking_number in ('900000099001','900000099002')$q$), '>0', null),
  (2, '範囲外（KAZ未照合＝deliveriesに親なし・hqのみ可視）',
      pg_temp.safe_count($q$select 1 from public.reception_requests where tracking_number = 'KAZ900000099099'$q$), '=0', null)
) as t(seq, check_name, cnt, expect, detail)
order by seq;

rollback;
-- 合格: seq=0 が OK（detail に「area / A01」）かつ 全行 judge=OK


-- §2. driver（DRV001）— 自担当(900000099001/002)は見える・KAZ未照合は0件 ------------------------
--   ★ '<DRIVER_DRV001_UID>' を置換 → begin〜rollback を丸ごと実行
begin;
create function pg_temp.safe_count(q text) returns bigint language plpgsql as $fn$
declare n bigint;
begin
  execute 'select count(*) from (' || q || ') _x' into n; return n;
exception when insufficient_privilege then return -1; when undefined_table then return -2;
end $fn$;

set local request.jwt.claims = '{"role":"authenticated","sub":"<DRIVER_DRV001_UID>"}';
set local role authenticated;

select seq, check_name,
       case cnt when -1 then 'GRANT無し(アクセス不可)' when -2 then 'テーブル無し' else cnt::text end as cnt_disp,
       expect,
       case when (expect = '=0' and cnt <= 0) or (expect = '>0' and cnt > 0) then 'OK' else 'NG' end as judge,
       detail
from (values
  (0, 'なりすまし確認（role=driver）',
      (case when public.my_role() = 'driver' and public.my_driver() = 'DRV001' then 1 else 0 end)::bigint, '>0',
      coalesce(public.my_role(), '(null)') || ' / ' || coalesce(public.my_driver(), '(null)')),
  (1, '範囲内（自担当DRV001: 900000099001/002）',
      pg_temp.safe_count($q$select 1 from public.reception_requests where tracking_number in ('900000099001','900000099002')$q$), '>0', null),
  (2, '範囲外（KAZ未照合＝deliveriesに親なし・hqのみ可視）',
      pg_temp.safe_count($q$select 1 from public.reception_requests where tracking_number = 'KAZ900000099099'$q$), '=0', null)
) as t(seq, check_name, cnt, expect, detail)
order by seq;

rollback;


-- §3. shipper（SHIP01）— 自荷主(900000099001)は見える・他荷主(SHIP02)/KAZ未照合は0件 -----------
--   ★ '<SHIPPER_SHIP01_UID>' を置換 → begin〜rollback を丸ごと実行
begin;
create function pg_temp.safe_count(q text) returns bigint language plpgsql as $fn$
declare n bigint;
begin
  execute 'select count(*) from (' || q || ') _x' into n; return n;
exception when insufficient_privilege then return -1; when undefined_table then return -2;
end $fn$;

set local request.jwt.claims = '{"role":"authenticated","sub":"<SHIPPER_SHIP01_UID>"}';
set local role authenticated;

select seq, check_name,
       case cnt when -1 then 'GRANT無し(アクセス不可)' when -2 then 'テーブル無し' else cnt::text end as cnt_disp,
       expect,
       case when (expect = '=0' and cnt <= 0) or (expect = '>0' and cnt > 0) then 'OK' else 'NG' end as judge,
       detail
from (values
  (0, 'なりすまし確認（role=shipper）',
      (case when public.my_role() = 'shipper' and public.my_shipper() = 'SHIP01' then 1 else 0 end)::bigint, '>0',
      coalesce(public.my_role(), '(null)') || ' / ' || coalesce(public.my_shipper(), '(null)')),
  (1, '範囲内（自荷主SHIP01: 900000099001）',
      pg_temp.safe_count($q$select 1 from public.reception_requests where tracking_number = '900000099001'$q$), '>0', null),
  (2, '範囲外（他荷主SHIP02: 900000099002）',
      pg_temp.safe_count($q$select 1 from public.reception_requests where tracking_number = '900000099002'$q$), '=0', null),
  (3, '範囲外（KAZ未照合）',
      pg_temp.safe_count($q$select 1 from public.reception_requests where tracking_number = 'KAZ900000099099'$q$), '=0', null)
) as t(seq, check_name, cnt, expect, detail)
order by seq;

rollback;


-- §4. shipper（SHIP02）— 自荷主(900000099002)は見える・他荷主(SHIP01)/KAZ未照合は0件 -----------
--   ★ 追加要件の対（レビュー指摘）: SHIP02側の「範囲内>0」をここで閉じる。
--   ★ '<SHIPPER_SHIP02_UID>' を置換 → begin〜rollback を丸ごと実行
begin;
create function pg_temp.safe_count(q text) returns bigint language plpgsql as $fn$
declare n bigint;
begin
  execute 'select count(*) from (' || q || ') _x' into n; return n;
exception when insufficient_privilege then return -1; when undefined_table then return -2;
end $fn$;

set local request.jwt.claims = '{"role":"authenticated","sub":"<SHIPPER_SHIP02_UID>"}';
set local role authenticated;

select seq, check_name,
       case cnt when -1 then 'GRANT無し(アクセス不可)' when -2 then 'テーブル無し' else cnt::text end as cnt_disp,
       expect,
       case when (expect = '=0' and cnt <= 0) or (expect = '>0' and cnt > 0) then 'OK' else 'NG' end as judge,
       detail
from (values
  (0, 'なりすまし確認（role=shipper）',
      (case when public.my_role() = 'shipper' and public.my_shipper() = 'SHIP02' then 1 else 0 end)::bigint, '>0',
      coalesce(public.my_role(), '(null)') || ' / ' || coalesce(public.my_shipper(), '(null)')),
  (1, '範囲内（自荷主SHIP02: 900000099002）',
      pg_temp.safe_count($q$select 1 from public.reception_requests where tracking_number = '900000099002'$q$), '>0', null),
  (2, '範囲外（他荷主SHIP01: 900000099001）',
      pg_temp.safe_count($q$select 1 from public.reception_requests where tracking_number = '900000099001'$q$), '=0', null),
  (3, '範囲外（KAZ未照合）',
      pg_temp.safe_count($q$select 1 from public.reception_requests where tracking_number = 'KAZ900000099099'$q$), '=0', null)
) as t(seq, check_name, cnt, expect, detail)
order by seq;

rollback;


-- =============================================================
-- ⑥ write policy 0本（書込は register_reception 等 SECURITY DEFINER 関数のみ）
--   なりすまし不要（カタログ参照）。そのまま実行してよい。
-- =============================================================
select tablename,
       count(*) filter (where cmd <> 'SELECT') as write_policies,
       case when count(*) filter (where cmd <> 'SELECT') = 0 then 'OK' else 'NG' end as judge
from pg_policies
where schemaname = 'public' and tablename in ('reception_requests', 'number_bands')
group by tablename
order by tablename;
-- 期待: 両テーブルとも write_policies=0 / judge=OK


-- =============================================================
-- ⑦ anon実在番号 → register_reception が created になる
--   DEFINER（SECURITY DEFINER）の実在チェック（deliveries exists）はRLS非適用であること、
--   すなわち anon が deliveries への直接SELECT権限を持たなくても、関数内の実在チェックは
--   定義者権限で走るため成功する仕様を実機で確認する。
--   ★ begin〜rollback を丸ごと実行（rollbackするので検証行・受付とも残らない＝再実行可）。
--   ⑤の流儀に合わせ、読み取り専用の事前SELECTはbeginの外・ブロック内はjudge列付き1本のSELECTに畳む。
-- =============================================================

-- 実在チェック対象（読み取り専用。beginの外）: seedが用意した900000099999。受付は未登録の状態のまま ----
select tracking_number, office_code, status from public.deliveries
where tracking_number = '900000099999';
-- 期待: 1行（seed_reception_write_v0.sql が用意済み。0行ならseed未実行）

begin;

set local request.jwt.claims = '{"role":"anon"}';
set local role anon;

with regcall as (
  select public.register_reception(
    '900000099999', '置き配', null, null, '宅配ボックス', 'web', null, false
  ) as r
),
priv as (
  select has_table_privilege('anon', 'public.deliveries', 'select') as anon_deliveries_select
)
select p.anon_deliveries_select,
       c.r ->> 'result'   as result,
       c.r ->> 'verified' as verified,
       c.r ->> 'band_key' as band_key,
       case when p.anon_deliveries_select = false
             and c.r ->> 'result' = 'created'
             and (c.r ->> 'verified')::boolean = true
             and c.r ->> 'band_key' = 'demo9000'
            then 'OK' else 'NG' end as judge
from regcall c, priv p;
-- 期待: judge=OK（anon_deliveries_select=false でも result=created/verified=true/band_key=demo9000）
--   （anonにdeliveriesのSELECT権限が無くても、DEFINER内部の実在チェックはRLSを介さず成功する）

rollback;
