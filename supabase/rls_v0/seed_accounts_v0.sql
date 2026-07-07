-- =============================================================
-- 手順 3/4: ロール別ダミーアカウント＋帰属、ロール別ダミー荷物
--   ★ 正準ダミーデータ規格 v1（docs/dummy_data_standard_v1.md）に統一。
--     愛知2拠点(D01/D02)・営業所 A01(D01)/C01(D02)・B01廃止・12桁問合番号・SHIP01/02。
-- 実行: SQL Editor に貼り付けて Run（rls_v0.sql の後）
-- =============================================================
-- SQL Editor は管理者(postgres)権限＝RLS無視で動くため、投入が可能。
-- 検証を決定的にするため、荷物・問合Index・profiles を一旦リセットしてから入れる。

delete from public.work_schedules;
delete from public.delivery_index;
delete from public.deliveries;
delete from public.profiles;

-- ---- マスタ補完（schema_v0未投入でも動くよう冪等に）----
--   2拠点(D01,D02) / 2営業所(A01=D01 / C01=D02)。1:1。
insert into public.depots (depot_code, depot_name) values
  ('D01','愛知県第1拠点'), ('D02','愛知県第2拠点')
  on conflict (depot_code) do nothing;

insert into public.offices
  (office_code, depot_code, office_name, dispatch_priority, basket_order, basket_cart_limit, autosave_threshold, request_period_days) values
  ('A01','D01','愛知県1営業所','処理能力優先','ドライバー順',10,50,30),
  ('C01','D02','愛知県2営業所','処理能力優先','ドライバー順',10,50,30)
  on conflict (office_code) do nothing;

-- ドライバー：A01=DRV001,DRV002 / C01=DRV003（ドライバー分離デモのため A01 に2名）。
insert into public.drivers
  (driver_id, driver_name, contact, vehicle, skill_per_hour, contract_start_date, office_code, registration_status) values
  ('DRV001','山田太郎','090-1111-1111','軽バン',20,'2026-04-01','A01','登録済'),
  ('DRV002','佐藤花子','090-2222-2222','軽バン',18,'2026-05-01','A01','登録済'),
  ('DRV003','鈴木一郎','090-3333-3333','軽バン',18,'2026-05-01','C01','登録済')
  on conflict (driver_id) do nothing;

-- =============================================================
-- ロール別ダミーアカウント（profiles）
--   user_id は検証用の固定ダミーUUID（check で同じ値を使う）
-- =============================================================
insert into public.profiles (user_id, role, depot_code, office_code, driver_id, shipper_id) values
  ('00000000-0000-0000-0000-000000000001', 'hq',      NULL,  NULL,  NULL,     NULL),     -- 本部
  ('00000000-0000-0000-0000-000000000002', 'depot',   'D01', NULL,  NULL,     NULL),     -- 拠点管理（D01配下）
  ('00000000-0000-0000-0000-0000000000a1', 'area',    'D01', 'A01', NULL,     NULL),     -- 営業所A01（愛知県1営業所）
  ('00000000-0000-0000-0000-0000000000c1', 'area',    'D02', 'C01', NULL,     NULL),     -- 営業所C01（愛知県2営業所）
  ('00000000-0000-0000-0000-0000000000d1', 'driver',  'D01', 'A01', 'DRV001', NULL),     -- ドライバー(DRV001)
  ('00000000-0000-0000-0000-0000000000f1', 'shipper', NULL,  NULL,  NULL,     'SHIP01'); -- 荷主(SHIP01)

-- =============================================================
-- ロール別ダミー荷物（可視範囲を区別できるよう office/driver/shipper を散らす）
--   tracking_number は12桁数字（実CSV値と衝突しない 9000… 帯のデモ番号）。
--   A01: 001,002,003 / C01: 011,012,013。SHIP02 行(002,012)は荷主SHIP01から範囲外。
-- =============================================================
insert into public.deliveries
  (tracking_number, delivery_date, address, common_id, depot_code, office_code, driver_id, delivery_order, basket_code, status, time_window, shipper_id, import_batch_id) values
  ('900000000001','2026-06-09','愛知県岡崎市箱柳町1-1','OKZ_C_01_08','D01','A01','DRV001',1,'A',  '配車済','午前','SHIP01','BATCH-SEED'),
  ('900000000002','2026-06-09','愛知県岡崎市箱柳町2-2','OKZ_C_01_08','D01','A01','DRV001',2,'A',  '配車済','午後','SHIP02','BATCH-SEED'),
  ('900000000003','2026-06-09','愛知県岡崎市箱柳町3-3','OKZ_C_01_08','D01','A01','DRV002',1,'A',  '配車済','午前','SHIP01','BATCH-SEED'),
  ('900000000011','2026-06-09','愛知県豊田市西町1-1',  'TYT_C_25_36','D02','C01','DRV003',1,'M01','配車済','午前','SHIP01','BATCH-SEED'),
  ('900000000012','2026-06-09','愛知県豊田市西町2-2',  'TYT_C_25_36','D02','C01','DRV003',2,'M01','配車済','夜間','SHIP02','BATCH-SEED'),
  ('900000000013','2026-06-09','愛知県豊田市西町3-3',  'TYT_C_25_36','D02','C01', NULL,  NULL,NULL,'未配車', NULL,  'SHIP01','BATCH-SEED');

-- 問合Index（配車済＝ドライバー確定分のみ。NULLドライバーの 013 は無し）
insert into public.delivery_index (tracking_number, driver_id, delivery_order, basket_code, common_id) values
  ('900000000001','DRV001',1,'A',  'OKZ_C_01_08'),
  ('900000000002','DRV001',2,'A',  'OKZ_C_01_08'),
  ('900000000003','DRV002',1,'A',  'OKZ_C_01_08'),
  ('900000000011','DRV003',1,'M01','TYT_C_25_36'),
  ('900000000012','DRV003',2,'M01','TYT_C_25_36');

-- 稼働予定（機微：他者データ）。DRV001=2件 / DRV002=1件 / DRV003=1件。
--   → ドライバーDRV001 は自分の2件のみ見え、DRV002/DRV003 の分は0件（範囲外0件）を検証する。
insert into public.work_schedules (driver_id, work_date, work_type, application_status) values
  ('DRV001','2026-06-10','フル',  '承認'),
  ('DRV001','2026-06-11','2時間', '申請中'),
  ('DRV002','2026-06-10','フル',  '承認'),
  ('DRV003','2026-06-10','フル',  '承認');
