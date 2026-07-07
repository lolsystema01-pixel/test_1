-- =============================================================
-- 手順 2/3: 少量のダミーデータ投入（FK成立の確認用）
-- 実行: SQL Editor に貼り付けて Run（create_schema_v0.sql の後）
-- =============================================================
-- 参照される側から投入する。何度実行しても良いよう、子側から delete してから入れる。

delete from public.work_schedules;
delete from public.delivery_index;
delete from public.drivers;
delete from public.deliveries;
delete from public.address_master;
delete from public.offices;
delete from public.zone_plan;
delete from public.depots;

-- ① マスタ：拠点 / 営業所（正準規格 v1: 愛知2拠点・英コード）-----
insert into public.depots (depot_code, depot_name) values
  ('D01', '愛知県第1拠点'),
  ('D02', '愛知県第2拠点');

insert into public.offices
  (office_code, depot_code, office_name, dispatch_priority, basket_order, basket_cart_limit, autosave_threshold, request_period_days) values
  ('A01', 'D01', '愛知県1営業所', '処理能力優先', 'ドライバー順', 10, 50, 30),
  ('C01', 'D02', '愛知県2営業所', '処理能力優先', 'ドライバー順', 10, 50, 30);

-- ① マスタ：ゾーン / 住所（common_id は OKZ_* 系）---------------
insert into public.zone_plan (common_id, zone_no, adjacent_zones) values
  ('OKZ_C_01_08', 'Z1', 'TYT_C_25_36'),
  ('TYT_C_25_36', 'Z2', 'OKZ_C_01_08');

insert into public.address_master (town_key, municipality, town, common_id) values
  ('愛知県|岡崎市|箱柳町', '愛知県岡崎市', '箱柳町', 'OKZ_C_01_08'),
  ('愛知県|豊田市|西町',   '愛知県豊田市', '西町',   'TYT_C_25_36');

-- ② 配送データ（荷物）--------------------------------------
--    office_code は A01/C01（営業所マスタに存在）→ FK成立を確認できる。
--    tracking_number は12桁数字（実CSV値と衝突しない 9000… 帯のデモ番号）。
insert into public.deliveries
  (tracking_number, delivery_date, address, common_id, depot_code, office_code, driver_id, delivery_order, basket_code, status, time_window, shipper_id, import_batch_id) values
  ('900000000001', '2026-06-08', '愛知県岡崎市箱柳町12-3', 'OKZ_C_01_08', 'D01', 'A01', 'DRV001', 1, 'A',   '配車済', '午前', 'SHIP01', 'BATCH-SEED'),
  ('900000000002', '2026-06-08', '愛知県岡崎市高隆寺町5-1', 'OKZ_C_01_08', 'D01', 'A01', NULL,     NULL, NULL, '未配車', NULL,   'SHIP01', 'BATCH-SEED'),
  ('900000000003', '2026-06-08', '愛知県豊田市西町2-15',   'TYT_C_25_36', 'D02', 'C01', 'DRV003', 1, 'M01', '配車済', '夜間', 'SHIP02', 'BATCH-SEED');

-- ③ 問合Index（荷物に存在する問合番号のみ）-----------------
insert into public.delivery_index
  (tracking_number, driver_id, delivery_order, basket_code, common_id) values
  ('900000000001', 'DRV001', 1, 'A',   'OKZ_C_01_08'),
  ('900000000003', 'DRV003', 1, 'M01', 'TYT_C_25_36');

-- ④ ドライバー（所属営業所コードは A01/C01）----------------
insert into public.drivers
  (driver_id, driver_name, contact, vehicle, skill_per_hour, contract_start_date, contract_end_date, office_code, registration_status) values
  ('DRV001', '山田太郎', '090-1111-1111', '軽バン', 20, '2026-04-01', NULL, 'A01', '登録済'),
  ('DRV003', '鈴木一郎', '090-3333-3333', '軽バン', 18, '2026-05-01', NULL, 'C01', '登録済');

-- ⑤ 稼働予定（ドライバーIDは drivers に存在）---------------
insert into public.work_schedules
  (driver_id, work_date, work_type, application_status) values
  ('DRV001', '2026-06-09', 'フル',   '承認'),
  ('DRV003', '2026-06-09', '2時間',  '申請中');
