-- =============================================================
-- 配達実績 v0 — ダミーデータ投入（記録口経由で完了/不在化）
--   対応: 要件定義 8.11。DRV001（愛知・A01）の当日仕分済ダミー5件を
--         record_delivery_result 経由で 完了(3)／不在(2) にする。
-- 実行: Supabase SQL Editor。前提=delivery_result_v0.sql・dbschema_v0・rls_v0 適用済み。
-- =============================================================
-- 設計メモ:
--   ・記録口 record_delivery_result は「driver本人ログイン」必須（auth.uid()必須）。
--     SQL Editorは管理者(postgres)実行のため auth.uid()=null → そのままでは呼べない。
--     → rls_v0/seed_accounts_v0.sql が投入済みの検証用ダミーアカウント
--       （'00000000-0000-0000-0000-0000000000d1' = DRV001, role='driver'）を
--       `set local request.jwt.claims` で疑似ログインして呼ぶ（check_status_log_v0.sql④と同じ手法）。
--     ★実機（Expo Go・Google/メールログイン）のDRV001とは別物（Task3で別途確認）。
--   ・deliveries の初期状態（status='仕分済'）は「新規ダミー投入」であり status遷移ではないため
--     直接INSERT（csv_import等の初期投入と同じ扱い）。以降の 仕分済→配送中→完了/不在 は
--     必ず記録口（record_delivery_result → 内部で record_status_transition）を経由する。
--   ・tracking_number は 900000000301〜305（9000帯12桁・他モジュールの割当と非衝突）。
--   ・delivery_date は「当日」= current_date（Task3の実機E2E＝JST当日ルート表示に載せるため）。
-- =============================================================

-- ① クリーンアップ（冪等・自モジュールのダミーのみ／子→親の順）--------
delete from public.delivery_results
  where tracking_number in ('900000000301','900000000302','900000000303','900000000304','900000000305');
delete from public.delivery_status_log
  where tracking_number in ('900000000301','900000000302','900000000303','900000000304','900000000305');
delete from public.deliveries
  where tracking_number in ('900000000301','900000000302','900000000303','900000000304','900000000305');

-- ② ベース：DRV001（A01）の当日仕分済ダミー5件 -------------------------
--    住所・common_id は正準規格 v1（岡崎市＝OKZ_C_01_08）に合わせる。
insert into public.deliveries
  (tracking_number, delivery_date, address, common_id, depot_code, office_code, driver_id,
   delivery_order, basket_code, status, time_window, shipper_id, import_batch_id) values
  ('900000000301', current_date, '愛知県岡崎市箱柳町4-1', 'OKZ_C_01_08', 'D01', 'A01', 'DRV001', 1, 'A', '仕分済', '午前', 'SHIP01', 'BATCH-DELIVERY-RESULT-SEED'),
  ('900000000302', current_date, '愛知県岡崎市箱柳町4-2', 'OKZ_C_01_08', 'D01', 'A01', 'DRV001', 2, 'A', '仕分済', '午前', 'SHIP01', 'BATCH-DELIVERY-RESULT-SEED'),
  ('900000000303', current_date, '愛知県岡崎市高隆寺町6-1','OKZ_C_01_08', 'D01', 'A01', 'DRV001', 3, 'A', '仕分済', '午後', 'SHIP02', 'BATCH-DELIVERY-RESULT-SEED'),
  ('900000000304', current_date, '愛知県岡崎市高隆寺町6-2','OKZ_C_01_08', 'D01', 'A01', 'DRV001', 4, 'A', '仕分済', '午後', 'SHIP01', 'BATCH-DELIVERY-RESULT-SEED'),
  ('900000000305', current_date, '愛知県岡崎市箱柳町4-3', 'OKZ_C_01_08', 'D01', 'A01', 'DRV001', 5, 'A', '仕分済', '夜間', 'SHIP02', 'BATCH-DELIVERY-RESULT-SEED');

-- ③ 記録口経由で完了(3)／不在(2)化（DRV001として疑似ログイン）---------
--    901〜903=完了（GPSあり）／904=不在（GPSあり）／905=不在（GPS取得失敗を模擬=null）。
begin;
  set local request.jwt.claims = '{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000000d1"}';
  set local role authenticated;

  select public.record_delivery_result('900000000301', '完了', 34.9530, 137.1750) as r301;
  select public.record_delivery_result('900000000302', '完了', 34.9540, 137.1760) as r302;
  select public.record_delivery_result('900000000303', '完了', 34.9550, 137.1770) as r303;
  select public.record_delivery_result('900000000304', '不在', 34.9560, 137.1780) as r304;
  select public.record_delivery_result('900000000305', '不在', null,     null)     as r305; -- GPS失敗デモ
commit;

-- ④ 結果サマリ（目視確認用）---------------------------------------------
select tracking_number, status from public.deliveries
  where tracking_number between '900000000301' and '900000000305' order by tracking_number;
-- 期待: 301-303='完了'／304-305='不在'

select tracking_number, driver_id, result, lat, lng from public.delivery_results
  where tracking_number between '900000000301' and '900000000305' order by tracking_number;
-- 期待: 5行・driver_id='DRV001'・305のみ lat/lng=null
