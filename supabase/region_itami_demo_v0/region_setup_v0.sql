-- =============================================================
-- 地域セット（伊丹営業所デモ）v0 — 兵庫/大阪の実データを1営業所で配車まで通す土台
--   対応: ③拠点振分の簡易版（A案：全件を1営業所に割当）＋ ④配車の前提（ドライバー・稼働）。
-- 実行: Supabase SQL Editor。前提=取込＋②付与済み（deliveries に common_id/zone_no・delivery_date=2026-06-29）。
--       ＋ dispatch_v0（shift_hours・dispatch_build）／status_log_v0（記録口）／delivery_order_zone_sort_v0（renumber zone版）適用済み。
-- ★A案：office_assign を使わず、当バッチ（2026-06-29・common_idあり）を全て伊丹営業所(IT01)へ割当。
-- =============================================================

-- 0) 稼働区分→時間（無ければ）------------------------------------------------
insert into public.shift_hours (work_type, hours) values
  ('フル',8),('6時間',6),('6中',6),('2時間',2),('半日',4)
on conflict (work_type) do update set hours = excluded.hours;

-- 1) 拠点・営業所 ------------------------------------------------------------
insert into public.depots (depot_code, depot_name)
values ('D_ITM','伊丹拠点') on conflict (depot_code) do nothing;

insert into public.offices (office_code, depot_code, office_name, basket_cart_limit, basket_code_format)
values ('IT01','D_ITM','伊丹営業所', 50, 'アルファベット')
on conflict (office_code) do update set
  depot_code = excluded.depot_code, office_name = excluded.office_name,
  basket_cart_limit = excluded.basket_cart_limit, basket_code_format = excluded.basket_code_format;

-- 1.5) IT01 の稼働ラベル（shift_mgmt v0.7 適用後のみ）--------------------------
--   ★重要（shift_mgmt v0.7 以降）: 新設営業所 IT01 に shift_labels が無いまま §3 でフル・承認の
--     稼働を作ると、dispatch_build の事前チェック(0)が「IT01／フル未定義」を名指しで raise し、
--     dispatch_build は全営業所を一括処理するため **当日の全営業所の配車が巻き添えで停止**する。
--     → shift_hours（§0）の内容を IT01 ぶん shift_labels に直接複製しておく（§4移行と同じ postgres
--       直接流儀。seed_office_shift_labels() は hq ゲート付きで postgres 実行だと 42501 になるため使わない）。
--     shift_labels テーブルが未作成（＝shift_mgmt 未適用の旧環境）なら何もしない。
do $$
begin
  if exists (select 1 from information_schema.tables
             where table_schema='public' and table_name='shift_labels') then
    insert into public.shift_labels (office_code, work_type, hours)
    select 'IT01', sh.work_type, sh.hours from public.shift_hours sh
    on conflict (office_code, work_type) do nothing;
  end if;
end $$;

-- 2) ドライバー8名（IT01所属・スキル）--------------------------------------
insert into public.drivers (driver_id, driver_name, skill_per_hour, office_code, registration_status) values
  ('ITD001','伊丹ドライバー01',20,'IT01','登録済'),
  ('ITD002','伊丹ドライバー02',18,'IT01','登録済'),
  ('ITD003','伊丹ドライバー03',22,'IT01','登録済'),
  ('ITD004','伊丹ドライバー04',20,'IT01','登録済'),
  ('ITD005','伊丹ドライバー05',19,'IT01','登録済'),
  ('ITD006','伊丹ドライバー06',21,'IT01','登録済'),
  ('ITD007','伊丹ドライバー07',20,'IT01','登録済'),
  ('ITD008','伊丹ドライバー08',18,'IT01','登録済')
on conflict (driver_id) do update set
  skill_per_hour = excluded.skill_per_hour, office_code = excluded.office_code;

-- 3) 稼働予定（2026-06-29・フル・承認）--------------------------------------
delete from public.work_schedules where work_date = date '2026-06-29' and driver_id like 'ITD%';
insert into public.work_schedules (driver_id, work_date, work_type, application_status)
select driver_id, date '2026-06-29', 'フル', '承認' from public.drivers where driver_id like 'ITD%';

-- 4) 当バッチを伊丹営業所へ割当（A案：全件1営業所）--------------------------
--    対象＝2026-06-29・common_id付与済み（②で当たった2,538件）。保留(common_id無)は対象外。
update public.deliveries
set office_code = 'IT01', depot_code = 'D_ITM'
where delivery_date = date '2026-06-29' and common_id is not null;

-- 確認
select
  (select count(*) from public.deliveries where delivery_date=date '2026-06-29' and office_code='IT01') as assigned_office,
  (select count(*) from public.drivers where office_code='IT01')                                        as drivers,
  (select count(*) from public.work_schedules where work_date=date '2026-06-29' and application_status='承認' and driver_id like 'ITD%') as approved_schedules;
