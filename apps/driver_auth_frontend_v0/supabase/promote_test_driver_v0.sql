-- =============================================================
-- 検証用: テストGoogleユーザーを「ドライバー」に昇格する
--   指示書「ドライバーアプリ認証フロント v0」の検証準備。
--   前提:
--     ・認証 v0.3（profiles 自動作成トリガ）実行済み。
--     ・RLS v0.2（rls_v0/）実行済み。
--     ・テスト用 Google アカウントで一度ログイン済み
--       → auth.users と profiles(role=NULL) が出来ている状態。
--   実行: Supabase SQL Editor（管理者＝RLS無視で更新できる）。
-- =============================================================
-- 設計メモ:
--   ・Google ログイン直後は role=NULL（＝何も見えない/「登録未完了」へ）。
--   ・本部のオンボーディング相当として、ここで role='driver' と driver_id を付与する。
--   ・検証を決定的にするため、対象ドライバー(DRV001)と「別ドライバー」(DRV002)を seed し、
--     別ドライバーの担当荷物が「自分では0件」になることを後で確認する。
-- =============================================================
-- ★ テストGoogleアカウントのメール: 下の §1 と §2 の 'gsvvav226@gmail.com' を
--   自分のテスト用メールに置き換えてください（2か所）。
--   ※ Supabase SQL Editor は psql ではないため \set 変数は使えません。直接埋め込みます。
-- =============================================================

-- 0) ドライバー/営業所/荷物の seed（冪等）-----------------------------
--    正準ダミーデータ規格 v1 と整合（愛知・D01/A01・DRV001,DRV002∈A01・12桁問合番号）。
--    DRV002 は「別ドライバー」（同営業所A01。担当荷物が自分では0件になることを確認する用）。
insert into public.depots (depot_code, depot_name) values
  ('D01','愛知県第1拠点')
  on conflict (depot_code) do nothing;

insert into public.offices
  (office_code, depot_code, office_name, dispatch_priority, basket_order, basket_cart_limit, autosave_threshold, request_period_days) values
  ('A01','D01','愛知県1営業所','処理能力優先','ドライバー順',10,50,30)
  on conflict (office_code) do nothing;

insert into public.drivers
  (driver_id, driver_name, contact, vehicle, skill_per_hour, contract_start_date, office_code, registration_status) values
  ('DRV001','山田太郎','090-1111-1111','軽バン',20,'2026-04-01','A01','登録済'),
  ('DRV002','佐藤花子','090-2222-2222','軽バン',18,'2026-05-01','A01','登録済')
  on conflict (driver_id) do nothing;

-- 担当荷物（DRV001=2件 / DRV002=2件・別ドライバー分）------------------
insert into public.deliveries
  (tracking_number, delivery_date, address, common_id, depot_code, office_code, driver_id, delivery_order, basket_code, status, time_window, shipper_id, import_batch_id) values
  ('900000000021','2026-06-16','愛知県岡崎市箱柳町A-1','OKZ_C_01_08','D01','A01','DRV001',1,'A','配車済','午前','SHIP01','BATCH-SEED'),
  ('900000000022','2026-06-16','愛知県岡崎市箱柳町A-2','OKZ_C_01_08','D01','A01','DRV001',2,'A','配車済','午後','SHIP02','BATCH-SEED'),
  ('900000000023','2026-06-16','愛知県岡崎市高隆寺町B-1','OKZ_C_01_08','D01','A01','DRV002',1,'A','配車済','午前','SHIP01','BATCH-SEED'),
  ('900000000024','2026-06-16','愛知県岡崎市高隆寺町B-2','OKZ_C_01_08','D01','A01','DRV002',2,'A','配車済','夜間','SHIP02','BATCH-SEED')
  on conflict (tracking_number) do nothing;

-- 1) テストユーザーを driver に昇格（role / 帰属を付与）----------------
update public.profiles p
set role        = 'driver',
    depot_code  = 'D01',
    office_code = 'A01',
    driver_id   = 'DRV001'
from auth.users u
where u.id = p.user_id
  and u.email = 'gsvvav226@gmail.com';   -- ★ ここを自分のテスト用メールに

-- 2) 確認：昇格できたか --------------------------------------------------
select u.email, p.role, p.office_code, p.driver_id
from public.profiles p
join auth.users u on u.id = p.user_id
where u.email = 'gsvvav226@gmail.com';   -- ★ ここも同じメールに
-- 期待: role=driver / office_code=A01 / driver_id=DRV001

-- 3) 期待される可視件数（アプリ上での確認の答え合わせ用）----------------
--    ・自分(DRV001)の担当荷物 = 2件（900000000021, 900000000022）
--    ・別ドライバー(DRV002)の担当荷物(900000000023,24) = アプリ上では0件で見えない
--      （deliveries_driver の RLS により driver_id=自分 のみ）
