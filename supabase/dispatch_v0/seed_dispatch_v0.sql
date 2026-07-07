-- =============================================================
-- 指示書: 配車 v0.5 — 手順 0/3：検証用ダミー seed
--   対応: 要件定義 6.5 配車（ドライバー予測）
-- 実行: Supabase SQL Editor（管理者＝RLS無視で投入）。前提=DBスキーマ v0／RLS v0.2。
-- =============================================================
-- 目的: dispatch_v0.sql を決定的に検証できるダミーを用意する。
--   ・ゾーン（共通ID）に隣接・分割閾値を持たせる（rank2=同一市/rank3=隣接）。
--   ・荷量を generate_series で量産（分割閾値超→分割／cap超→仮ドライバー を再現）。
--   ・承認/申請中 を混ぜ、承認外が cap に入らないことを検証可能にする。
-- 冪等: 自分のダミー（tracking_number 'DSP-%'・当日の対象稼働予定）だけ消して入れ直す。
-- =============================================================

-- ① 拠点／営業所（愛知県系：office_assign / work_schedule と整合）------
insert into public.depots (depot_code, depot_name) values
  ('D01','愛知県第1拠点'), ('D02','愛知県第2拠点')
  on conflict (depot_code) do nothing;

insert into public.offices
  (office_code, depot_code, office_name, dispatch_priority, basket_order, basket_cart_limit, autosave_threshold, request_period_days) values
  ('A01','D01','愛知県1営業所','処理能力優先','ドライバー順',10,50,30),
  ('C01','D02','愛知県2営業所','処理能力優先','ドライバー順',10,50,30)
  on conflict (office_code) do update set
    depot_code        = excluded.depot_code,
    dispatch_priority = excluded.dispatch_priority;

-- ② ドライバー（スキル＝1時間あたり配達個数）------------------------
insert into public.drivers
  (driver_id, driver_name, contact, vehicle, skill_per_hour, contract_start_date, office_code, registration_status) values
  ('DRV001','山田太郎','090-1111-1111','軽バン',20,'2026-04-01','A01','登録済'),
  ('DRV002','佐藤花子','090-2222-2222','軽バン',18,'2026-05-01','A01','登録済'),
  ('DRV003','鈴木一郎','090-3333-3333','軽バン',22,'2026-04-15','C01','登録済'),
  ('DRV004','田中美咲','090-4444-4444','軽バン',16,'2026-06-01','C01','登録済')
  on conflict (driver_id) do update set
    skill_per_hour = excluded.skill_per_hour,
    office_code    = excluded.office_code;

-- ③ ZonePlan（共通ID→ゾーン番号・隣接(共通ID)・分割閾値）-----------
--    分割閾値・拠点の列をここで用意（dispatch_v0 §0 と同じ。冪等）。
alter table public.zone_plan add column if not exists split_threshold integer not null default 170;
alter table public.zone_plan add column if not exists depot_code      text;
--    隣接は「共通IDのカンマ区切り・スペース無し」で持つ（zone_rank が string_to_array で解釈）。
--    split_threshold の値は全国ZonePlan CSV「分割閾値(個)」と一致（174/191/206/153）。
--    ＝master_zoneplan_v0 未ロードでも検証が自己完結するためのフォールバック投入。
--      master_zoneplan_v0 読込済みなら dispatch_v0 §0 が staging から同値を上書き同期する。
insert into public.zone_plan (common_id, zone_no, adjacent_zones, depot_code, split_threshold) values
  ('OKZ_C_01_08','1','OKZ_E_05_12,OKZ_W_13_18,OKZ_S_14_24','D01',174),  -- 岡崎-中央
  ('OKZ_E_05_12','5','OKZ_C_01_08,OKZ_W_13_18,OKZ_S_14_24','D01',174),  -- 岡崎-東
  ('TYT_C_25_36','25','TYT_W_32_40','D01',191),                          -- 豊田-中央
  ('TKI_C_03_07','3','CTA_C_06_13','D02',206),                           -- 東海
  ('CTA_C_06_13','6','TKI_C_03_07','D02',153)                            -- 知多（東海に隣接）
  on conflict (common_id) do update set
    adjacent_zones  = excluded.adjacent_zones,
    depot_code      = excluded.depot_code,
    split_threshold = excluded.split_threshold;

-- ④ 全国Master（共通ID→自治体：rank2=同一市 判定に使用）------------
insert into public.address_master (town_key, municipality, town, common_id) values
  ('愛知県|岡崎市|箱柳町','岡崎市','箱柳町','OKZ_C_01_08'),
  ('愛知県|岡崎市|小美町','岡崎市','小美町','OKZ_E_05_12'),
  ('愛知県|豊田市|西町','豊田市','西町','TYT_C_25_36'),
  ('愛知県|東海市|南柴田町','東海市','南柴田町','TKI_C_03_07'),
  ('愛知県|知多市|八幡','知多市','八幡','CTA_C_06_13')
  on conflict (town_key) do nothing;

-- ⑤ 当日の稼働予定（承認のみ cap に入る。申請中は除外される）--------
delete from public.work_schedules
 where work_date = current_date and driver_id in ('DRV001','DRV002','DRV003','DRV004');
insert into public.work_schedules (driver_id, work_date, work_type, application_status) values
  ('DRV001', current_date, 'フル',  '承認'),   -- cap=20×8=160
  ('DRV002', current_date, '6時間', '承認'),   -- cap=18×6=108
  ('DRV003', current_date, 'フル',  '承認'),   -- cap=22×8=176
  ('DRV004', current_date, 'フル',  '申請中'); -- ★承認外＝配車に入らない（除外を検証）

-- ⑥ 未配車の荷物を量産（共通ID別の荷量）----------------------------
--    A01（岡崎/豊田）=大量→分割＋仮ドライバー / C01（東海/知多）=少量→隣接束ね
delete from public.deliveries where tracking_number like 'DSP-%';
insert into public.deliveries
  (tracking_number, delivery_date, address, common_id, depot_code, office_code, status, import_batch_id)
select
  'DSP-' || z.common_id || '-' || lpad(g.n::text, 4, '0'),
  current_date,
  z.common_id || ' ダミー住所 ' || g.n,
  z.common_id,
  z.depot_code,
  z.office_code,
  '未配車',
  'DISP-SEED'
from (values
  ('OKZ_C_01_08','D01','A01',300),   -- 閾値174 → 300≤1.8×174=313.2 → 分割2
  ('OKZ_E_05_12','D01','A01',150),   -- 閾値174 → 分割1
  ('TYT_C_25_36','D01','A01',250),   -- 閾値191 → 250≤1.8×191=343.8 → 分割2
  ('TKI_C_03_07','D02','C01',60),    -- 閾値206 → 分割1
  ('CTA_C_06_13','D02','C01',40)     -- 閾値153 → 分割1（東海に隣接）
) as z(common_id, depot_code, office_code, qty)
cross join lateral generate_series(1, z.qty) as g(n);

-- 確認（投入直後）-----------------------------------------------------
select office_code, common_id, count(*) as qty
from public.deliveries
where tracking_number like 'DSP-%'
group by office_code, common_id
order by office_code, common_id;
-- 期待: A01: OKZ_C=300 / OKZ_E=150 / TYT_C=250（計700） ／ C01: TKI_C=60 / CTA_C=40（計100）
