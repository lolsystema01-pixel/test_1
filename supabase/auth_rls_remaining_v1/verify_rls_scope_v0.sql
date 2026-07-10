-- =============================================================
-- 指示書: 認証・権限 残課題 v1.1 — ③ 機微テーブルの「範囲外0件」証明
-- =============================================================
-- 【実行方法：ここを間違えると必ず失敗します】
--   1. §0 を実行して role ごとの user_id を控える。
--   2. 各ブロックは **`begin;` から `rollback;` まで丸ごと** 実行する。
--      ★ 途中の行だけを選択して Run すると `set local` が効かず、postgres のまま
--        （＝RLSバイパス）で走り、範囲外が0にならない。
--        `set local` は「同じトランザクション内」でしか効かないため。
--   3. `<○○_UID>` を §0 の実UUIDに置換してから実行する。
--   4. 各ブロックは **1本のSELECT** にしてある（Supabaseは最後のSELECTしか結果表示しないため）。
--      → 結果の `judge` 列が全部 OK なら合格。
--      → 先頭行「なりすまし確認」が NG なら、RLSが効いていない（UID未置換／部分実行）。
--         結果ペイン右下の Role 表示が postgres でも、ブロック内では authenticated に
--         降格しているので気にしなくてよい。判定は必ず先頭行で行う。
--   5. すべて `rollback;` で終わるので DB には一切書き込まれない。
--
-- 【なぜ SQL Editor で証明できるのか】
--   SQL Editor は既定で postgres（BYPASSRLS）＝RLSが効かない。
--   `set local role authenticated` で非特権ロールに降格し、`set local request.jwt.claims` で
--   auth.uid() を与えると **RLSが実際に適用される**。→ アプリを介さず機械的に証明できる。
--   ※ Storage の実ダウンロードURL経路だけは Storage API を通るため、最終サインオフは実機で
--     （verify_rls_scope_checklist_v0.md）。
--
-- 【証明の原則（主張=検証 1:1）】
--   「範囲外=0件」だけでは不十分（RLSが全部塞いでいても0件になる）。
--   必ず「範囲内 > 0件」と対で確認する。両方を各ブロックに含めている。
-- =============================================================


-- =============================================================
-- §0. 検証に使うユーザー（profiles）を確認して UUID を控える
-- =============================================================
select p.user_id, p.role, p.office_code, p.depot_code, p.driver_id, p.shipper_id, u.email
from public.profiles p
left join auth.users u on u.id = p.user_id
order by p.role, p.office_code nulls last;
-- ★ 以降の各ブロックの '<○○_UID>' を、上の user_id に置換して実行する。


-- =============================================================
-- §1. area（営業所）— 自営業所のみ・他営業所0件
--   ★ '<AREA_UID>' を area ユーザーの user_id に置換 → begin〜rollback を丸ごと実行
-- =============================================================
begin;
set local request.jwt.claims = '{"role":"authenticated","sub":"<AREA_UID>"}';
set local role authenticated;

select seq, check_name, cnt, expect,
       case when (expect = '=0' and cnt = 0) or (expect = '>0' and cnt > 0) then 'OK' else 'NG' end as judge,
       detail
from (values
  ( 0, 'なりすまし確認（role=area）',
       (case when public.my_role() = 'area' and public.my_office() is not null then 1 else 0 end)::bigint, '>0',
       coalesce(public.my_role(),'(null)') || ' / ' || coalesce(public.my_office(),'(null)') ),

  ( 1, 'deliveries 範囲内',    (select count(*) from public.deliveries where office_code = public.my_office()), '>0', null),
  ( 2, 'deliveries 範囲外',    (select count(*) from public.deliveries where office_code is distinct from public.my_office()), '=0', null),
  ( 3, 'drivers 範囲内',       (select count(*) from public.drivers    where office_code = public.my_office()), '>0', null),
  ( 4, 'drivers 範囲外',       (select count(*) from public.drivers    where office_code is distinct from public.my_office()), '=0', null),
  ( 5, 'work_schedules 範囲外',(select count(*) from public.work_schedules where driver_id not in (select public.my_office_drivers())), '=0', null),
  ( 6, 'offices 範囲外',       (select count(*) from public.offices    where office_code is distinct from public.my_office()), '=0', null),
  ( 7, 'print_history 範囲外', (select count(*) from public.print_history where office_code is distinct from public.my_office()), '=0', null),
  ( 8, 'delivery_index 範囲外',
       (select count(*) from public.delivery_index di
         where not exists (select 1 from public.deliveries d where d.tracking_number = di.tracking_number)), '=0', null),
  ( 9, 'delivery_status_log 範囲外',
       (select count(*) from public.delivery_status_log l
         where not exists (select 1 from public.deliveries d where d.tracking_number = l.tracking_number)), '=0', null),

  (10, 'profiles 自分',        (select count(*) from public.profiles where user_id = auth.uid()),  '>0', null),
  (11, 'profiles 他人',        (select count(*) from public.profiles where user_id <> auth.uid()), '=0', null),

  -- hq限定テーブル：area からは全部0件
  (20, 'hq限定 area_master',          (select count(*) from public.area_master),          '=0', null),
  (21, 'hq限定 area_master_staging',  (select count(*) from public.area_master_staging),  '=0', null),
  (22, 'hq限定 address_master',       (select count(*) from public.address_master),       '=0', null),
  (23, 'hq限定 zone_plan',            (select count(*) from public.zone_plan),            '=0', null),
  (24, 'hq限定 renumber_plan',        (select count(*) from public.renumber_plan),        '=0', null),
  (25, 'hq限定 dispatch_zones',       (select count(*) from public.dispatch_zones),       '=0', null),
  (26, 'hq限定 dispatch_drivers',     (select count(*) from public.dispatch_drivers),     '=0', null),
  (27, 'hq限定 dispatch_assignments', (select count(*) from public.dispatch_assignments), '=0', null),
  (28, 'hq限定 shift_hours',          (select count(*) from public.shift_hours),          '=0', null),

  -- Storage（3バケット）
  (30, 'storage 範囲内',
       (select count(*) from storage.objects
         where bucket_id in ('carry-sheets','dispatch-sheets','godoor-csv')
           and (storage.foldername(name))[1] = public.my_office()), '>0', null),
  (31, 'storage 範囲外',
       (select count(*) from storage.objects
         where bucket_id in ('carry-sheets','dispatch-sheets','godoor-csv')
           and (storage.foldername(name))[1] is distinct from public.my_office()), '=0', null)
) as t(seq, check_name, cnt, expect, detail)
order by seq;

rollback;
-- 合格: seq=0 が OK（detail に「area / <自営業所>」が出る）かつ 全行 judge=OK
-- 参考: seq=30 が 0 なら、まだ自営業所のPDF/CSVを保存していないだけ。
--       /sheet /carry /godoor で一度保存してから再実行する（RLSの不備ではない）。


-- =============================================================
-- §2. driver（ドライバー）— 自分の担当のみ
--   ★ '<DRIVER_UID>' を置換 → begin〜rollback を丸ごと実行
-- =============================================================
begin;
set local request.jwt.claims = '{"role":"authenticated","sub":"<DRIVER_UID>"}';
set local role authenticated;

select seq, check_name, cnt, expect,
       case when (expect = '=0' and cnt = 0) or (expect = '>0' and cnt > 0) then 'OK' else 'NG' end as judge,
       detail
from (values
  (0, 'なりすまし確認（role=driver）',
      (case when public.my_role() = 'driver' and public.my_driver() is not null then 1 else 0 end)::bigint, '>0',
      coalesce(public.my_role(),'(null)') || ' / ' || coalesce(public.my_driver(),'(null)')),
  (1, 'deliveries 範囲内（自分の担当）',  (select count(*) from public.deliveries where driver_id = public.my_driver()), '>0', null),
  (2, 'deliveries 範囲外（他人の担当）',  (select count(*) from public.deliveries where driver_id is distinct from public.my_driver()), '=0', null),
  (3, 'work_schedules 範囲外',            (select count(*) from public.work_schedules where driver_id is distinct from public.my_driver()), '=0', null),
  (4, 'drivers 範囲外（自分以外）',       (select count(*) from public.drivers where driver_id is distinct from public.my_driver()), '=0', null),
  (5, 'storage 範囲外（帳票は一切不可）', (select count(*) from storage.objects where bucket_id in ('carry-sheets','dispatch-sheets','godoor-csv')), '=0', null)
) as t(seq, check_name, cnt, expect, detail)
order by seq;

rollback;


-- =============================================================
-- §3. shipper（荷主）— 自分の荷主分のみ
--   ★ '<SHIPPER_UID>' を置換 → begin〜rollback を丸ごと実行
-- =============================================================
begin;
set local request.jwt.claims = '{"role":"authenticated","sub":"<SHIPPER_UID>"}';
set local role authenticated;

select seq, check_name, cnt, expect,
       case when (expect = '=0' and cnt = 0) or (expect = '>0' and cnt > 0) then 'OK' else 'NG' end as judge,
       detail
from (values
  (0, 'なりすまし確認（role=shipper）',
      (case when public.my_role() = 'shipper' and public.my_shipper() is not null then 1 else 0 end)::bigint, '>0',
      coalesce(public.my_role(),'(null)') || ' / ' || coalesce(public.my_shipper(),'(null)')),
  (1, 'deliveries 範囲内（自荷主）', (select count(*) from public.deliveries where shipper_id = public.my_shipper()), '>0', null),
  (2, 'deliveries 範囲外（他荷主）', (select count(*) from public.deliveries where shipper_id is distinct from public.my_shipper()), '=0', null),
  (3, 'shippers 範囲外',             (select count(*) from public.shippers   where shipper_id is distinct from public.my_shipper()), '=0', null),
  (4, 'drivers 範囲外（全件不可）',  (select count(*) from public.drivers), '=0', null),
  (5, 'storage 範囲外（全件不可）',  (select count(*) from storage.objects where bucket_id in ('carry-sheets','dispatch-sheets','godoor-csv')), '=0', null)
) as t(seq, check_name, cnt, expect, detail)
order by seq;

rollback;


-- =============================================================
-- §4. depot（拠点）— 配下営業所のみ
--   ★ '<DEPOT_UID>' を置換 → begin〜rollback を丸ごと実行
-- =============================================================
begin;
set local request.jwt.claims = '{"role":"authenticated","sub":"<DEPOT_UID>"}';
set local role authenticated;

select seq, check_name, cnt, expect,
       case when (expect = '=0' and cnt = 0) or (expect = '>0' and cnt > 0) then 'OK' else 'NG' end as judge,
       detail
from (values
  (0, 'なりすまし確認（role=depot）',
      (case when public.my_role() = 'depot' and public.my_depot() is not null then 1 else 0 end)::bigint, '>0',
      coalesce(public.my_role(),'(null)') || ' / ' || coalesce(public.my_depot(),'(null)') || ' → 配下: ' ||
      coalesce((select string_agg(o, ',') from public.my_depot_offices() o), '(なし)')),
  (1, 'deliveries 範囲内（配下）',   (select count(*) from public.deliveries where office_code in (select public.my_depot_offices())), '>0', null),
  (2, 'deliveries 範囲外（配下外）', (select count(*) from public.deliveries where office_code not in (select public.my_depot_offices())), '=0', null),
  (3, 'offices 範囲外（配下外）',    (select count(*) from public.offices    where office_code not in (select public.my_depot_offices())), '=0', null),
  (4, 'storage 範囲外（配下外）',
      (select count(*) from storage.objects
        where bucket_id in ('carry-sheets','dispatch-sheets','godoor-csv')
          and (storage.foldername(name))[1] not in (select public.my_depot_offices())), '=0', null)
) as t(seq, check_name, cnt, expect, detail)
order by seq;

rollback;


-- =============================================================
-- §5. hq（本部）— 全件見える（塞ぎすぎていないことの確認）
--   ★ '<HQ_UID>' を置換 → begin〜rollback を丸ごと実行
-- =============================================================
begin;
set local request.jwt.claims = '{"role":"authenticated","sub":"<HQ_UID>"}';
set local role authenticated;

select seq, check_name, cnt, expect,
       case when (expect = '=0' and cnt = 0) or (expect = '>0' and cnt > 0) then 'OK' else 'NG' end as judge,
       detail
from (values
  (0, 'なりすまし確認（role=hq）',
      (case when public.my_role() = 'hq' then 1 else 0 end)::bigint, '>0', coalesce(public.my_role(),'(null)')),
  (1, 'deliveries（全件）',    (select count(*) from public.deliveries),  '>0', null),
  (2, 'drivers（全件）',       (select count(*) from public.drivers),     '>0', null),
  (3, 'area_master（hq限定）', (select count(*) from public.area_master), '>0', null),
  (4, 'storage（全office）',
      (select count(*) from storage.objects where bucket_id in ('carry-sheets','dispatch-sheets','godoor-csv')), '>0', null)
) as t(seq, check_name, cnt, expect, detail)
order by seq;

rollback;


-- =============================================================
-- §6. 書込は DEFINER 関数のみ（業務テーブルに write policy が存在しないこと）
--   なりすまし不要（カタログ参照）。そのまま実行してよい。
-- =============================================================
select tablename,
       count(*) filter (where cmd <> 'SELECT') as write_policies,
       case when count(*) filter (where cmd <> 'SELECT') = 0 then 'OK' else 'NG' end as judge
from pg_policies
where schemaname = 'public'
  and tablename in ('deliveries','drivers','offices','shippers','work_schedules',
                    'delivery_index','delivery_status_log','print_history','profiles')
group by tablename
order by tablename;
-- 期待: 全行 write_policies=0 / judge=OK（書込は SECURITY DEFINER 関数のみ）
--
-- 参考（任意）: 直接書込が拒否されることの実演。なりすましブロック内で実行するとエラーになる。
--   begin;
--   set local request.jwt.claims = '{"role":"authenticated","sub":"<AREA_UID>"}';
--   set local role authenticated;
--   update public.deliveries set status = '完了' where tracking_number = (select tracking_number from public.deliveries limit 1);
--   -- 期待: ERROR: permission denied / new row violates row-level security policy（または 0 rows）
--   rollback;
