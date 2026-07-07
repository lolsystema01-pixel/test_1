-- =============================================================
-- 指示書: ドライバー参照＋稼働予定 v0 — 手順 1/4
--   ドライバー（マスタ）に検証用ダミーを直接 seed（非版管理）。
--   所属営業所は拠点/営業所マスタ（A01=愛知県1営業所(D01) / C01=愛知県2営業所(D02)）に整合させる。
--   対応: 要件定義 9.2（ドライバーマスタ）/ 5.3（機微テーブル＝RLS済み）
-- 実行: Supabase SQL Editor。前提: DBスキーマ v0・拠点振分 v0.2（offices=A01/C01）済み。
-- =============================================================
-- 用語: ドライバーID / スキル＝1時間あたり配達個数(skill_per_hour) / 所属営業所コード / 登録状態
-- ※「シフト」は使わない（稼働予定）。
-- ※ドライバーのオンボーディング・自己登録（第8章）は範囲外。ここは seed で用意。
-- =============================================================

insert into public.drivers
  (driver_id, driver_name, contact, vehicle, skill_per_hour, contract_start_date, office_code, registration_status) values
  ('DRV001','山田太郎','090-1111-1111','軽バン',20,'2026-04-01','A01','登録済'),  -- 愛知県1営業所
  ('DRV002','佐藤花子','090-2222-2222','軽バン',18,'2026-05-01','A01','登録済'),  -- 愛知県1営業所
  ('DRV003','鈴木一郎','090-3333-3333','軽バン',22,'2026-04-15','C01','登録済'),  -- 愛知県2営業所
  ('DRV004','田中美咲','090-4444-4444','軽バン',16,'2026-06-01','C01','登録済')   -- 愛知県2営業所
on conflict (driver_id) do update set
  driver_name         = excluded.driver_name,
  contact             = excluded.contact,
  vehicle             = excluded.vehicle,
  skill_per_hour      = excluded.skill_per_hour,
  contract_start_date = excluded.contract_start_date,
  office_code         = excluded.office_code,
  registration_status = excluded.registration_status;


-- 確認：ドライバーと所属営業所がマスタと整合（D01/D02・A01/C01）------
select d.driver_id, d.driver_name, d.skill_per_hour, d.office_code,
       o.office_name, o.depot_code, d.registration_status
from public.drivers d
join public.offices o on o.office_code = d.office_code
order by d.office_code, d.driver_id;
-- 期待: A01(愛知県1営業所)=DRV001,DRV002 / C01(愛知県2営業所)=DRV003,DRV004
