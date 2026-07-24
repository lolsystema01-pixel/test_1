-- =============================================================
-- 配車サマリ v0.2 — 検証用ダミー（冪等）。要員不足で仮割当／common_id未付与で保留／希望エリア外で希望外 を作る。
-- 実行: Supabase SQL Editor。dispatch_summary_v0.sql の後。前提: dbschema_v0（offices の A01）・shift_mgmt v0.7（work_schedules.preferred_areas・1日1稼働UNIQUE）実機済み。
-- =============================================================
-- ・#29 は配車結果を「読むだけ」なので、本 seed は dispatch_build を呼ばず deliveries を配車後の実体
--   （driver_id 書戻し済み）に直接する（office_home_v0 の seed と同型）。対象日=current_date・営業所=A01。
-- ・冪等: 冒頭で 'DS-%'／'DSD%' を子→親の順に delete してから作り直す（再実行で増えない）。
-- =============================================================

-- 0) 冪等クリーン（子(work_schedules)→親(drivers)・deliveries）
delete from public.work_schedules where driver_id like 'DSD%';
delete from public.deliveries       where tracking_number like 'DS-%';
delete from public.drivers          where driver_id like 'DSD%';

-- 1) 実ドライバー2名（A01・要員不足を演出＝捌けない分は仮に回る）
insert into public.drivers (driver_id, driver_name, skill_per_hour, office_code, registration_status) values
  ('DSD1','配車サマリ実1',20,'A01','登録済'),
  ('DSD2','配車サマリ実2',20,'A01','登録済')
on conflict (driver_id) do nothing;

-- 2) 承認稼働＋希望エリア（DSD1=希望{DS_ZA}→希望内 ／ DSD2=希望{DS_ZA}だが DS_ZB 担当＝希望外）
--    ※ 0) の DELETE(DSD%) で冪等は担保済みなので ON CONFLICT は付けない
--      （UNIQUE(driver_id, work_date)=shift_mgmt の 1日1稼働 が実DB未適用でも本 seed が通るように）。
insert into public.work_schedules (driver_id, work_date, work_type, application_status, preferred_areas) values
  ('DSD1', current_date, 'フル', '承認', array['DS_ZA']),
  ('DSD2', current_date, 'フル', '承認', array['DS_ZA']);

-- 3) deliveries（配車後の実体を模す：driver_id 書戻し済み・対象日=current_date・A01）
--    実: DS_ZA×4(DSD1・希望内) ／ DS_ZB×3(DSD2・希望外)
insert into public.deliveries (tracking_number, delivery_date, common_id, office_code, driver_id, status)
  select 'DS-A-'||g, current_date, 'DS_ZA','A01','DSD1','配車済' from generate_series(1,4) g;
insert into public.deliveries (tracking_number, delivery_date, common_id, office_code, driver_id, status)
  select 'DS-B-'||g, current_date, 'DS_ZB','A01','DSD2','配車済' from generate_series(1,3) g;
--    仮割当: DS_ZC×5（仮ドライバー '仮DS1'＝実で捌けない要員不足）
insert into public.deliveries (tracking_number, delivery_date, common_id, office_code, driver_id, status)
  select 'DS-C-'||g, current_date, 'DS_ZC','A01','仮DS1','配車済' from generate_series(1,5) g;
--    保留: common_id 未付与×2（status='保留'＝マスタ不備で配車の土俵に乗らない）
insert into public.deliveries (tracking_number, delivery_date, common_id, office_code, driver_id, status)
  select 'DS-H-'||g, current_date, null, 'A01', null, '保留' from generate_series(1,2) g;


-- 4) 確認（このseed直後の期待：仮割当5・保留2・希望外3）
select office_code, delivery_date, received, virtual_items, virtual_drivers, hold_items, off_preference_items
from public.dispatch_summary
where office_code='A01' and delivery_date=current_date;
-- 期待: received=14 / virtual_items=5・virtual_drivers=1 / hold_items=2 / off_preference_items=3
