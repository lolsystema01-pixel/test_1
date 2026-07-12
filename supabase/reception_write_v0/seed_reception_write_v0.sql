-- =============================================================
-- 受付テーブル＋書き込み口 v0.2 — 検証用ダミー（冪等）
--   対応: 要件定義 D章相当（受付種別・希望日時・置き配場所）／N-4(受付登録)・N-5(二重受付)・N-6(状態照会)
--   register_reception 経由で「照合済み2件（新規＋上書き履歴）」「KAZ帯の未照合1件」を作る。
-- 実行: Supabase SQL Editor。reception_write_v0.sql の後。
-- 前提: dbschema_v0（offices の A01 等）実行済み。deliveries の検証行は本SQL自身が作るため、
--       csv_import 等の取込データが無い環境でも reception_write_v0 単体で動作確認できる。
-- =============================================================
-- 冪等: 冒頭で対象の受付・検証deliveriesを delete してから作り直す（再実行しても行が増えない）。
--   ・900000099001 / 900000099002 / 900000099999 は reception_write_v0 の検証専用に予約した番号
--     （demo9000帯＝prefix'9'・12桁）。基盤seed（dbschema_v0/rls_v0）が使う
--     900000000001〜13 とは重複させない（他モジュールの検証データを壊さないため）。
--   ・追加要件: driver=DRV001担当・shipper=SHIP02荷主の荷物＋受付を1件（900000099002）含める。
--     なりすましRLS検証で「範囲内>0」の対をドライバー・荷主それぞれのユーザー単位で閉じるため
--     （レビュー指摘: SHIP02側の「範囲内>0」の対がそれまで無かった）。
--   ・既存seed作法（admin_settings_v0 / office_home_v0）に合わせ、子(受付)→親(荷物)の順で
--     delete してから作り直す（office_home_v0 の 'OH-%' 冪等クリーンと同型）。
-- =============================================================


-- 0) 冪等クリーン（受付→荷物の順）--------------------------------
delete from public.reception_requests
  where tracking_number in ('900000099001', '900000099002', '900000099999', 'KAZ900000099099');
delete from public.deliveries
  where tracking_number in ('900000099001', '900000099002', '900000099999');


-- 1) 検証deliveries（demo9000帯・照合あり＝verify_on_reception=true の実在チェック対象）------
--   900000099001: A01・DRV001・SHIP01 … 照合済み・新規登録のみ（1行）
--   900000099002: A01・DRV001・SHIP02 … 照合済み・上書き履歴（取消1＋受付済1＝2行）
--     ★ driver=DRV001／shipper=SHIP02 の対はこの行が担う（追加要件）。
--   900000099999: A01・担当者未定 … ⑦(anon実在番号→created)専用。受付は登録しない状態のまま残す。
insert into public.deliveries (tracking_number, office_code, driver_id, shipper_id, status) values
  ('900000099001', 'A01', 'DRV001', 'SHIP01', '配車済'),
  ('900000099002', 'A01', 'DRV001', 'SHIP02', '配車済'),
  ('900000099999', 'A01', null,     null,     '未配車');


-- 2) 受付登録（register_reception 経由。書込みは記録口関数に一本化＝write policyは置かない）----

-- 2-1) 900000099001: 新規登録のみ（1行・受付済）---------------------------------------------
select public.register_reception(
  '900000099001', '再配達', '2026-08-01', '午前', null, 'web', null, false
) as r_2_1_created;
-- 期待: result=created / verified=true / band_key=demo9000

-- 2-2) 900000099002: 新規登録 → 内容を変えて上書き（旧行=取消・新行=受付済＝計2行）----------
select public.register_reception(
  '900000099002', '置き配', null, null, '玄関前', 'line', null, false
) as r_2_2_created;
-- 期待: result=created / verified=true

select public.register_reception(
  '900000099002', '時間変更', '2026-08-03', '18-20', null, 'phone', '09011112222', true
) as r_2_2_overwritten;
-- 期待: result=overwritten / existing_receipt_no = r_2_2_created の receipt_no

-- 2-3) KAZ帯（照合なし・verify_on_reception=false＝deliveries不要）: 未照合のまま受付できる ---
select public.register_reception(
  'KAZ900000099099', '置き配', null, null, '宅配ボックス', 'ai_phone', null, false
) as r_2_3_created;
-- 期待: result=created / verified=false / band_key=kaz


-- 3) 確認（このSQL実行直後の状態。check_reception_write_v0.sql の①③に対応）--------------------
select tracking_number, receipt_no, band_key, verified, reception_type, channel, status, created_at
from public.reception_requests
where tracking_number in ('900000099001', '900000099002', 'KAZ900000099099')
order by tracking_number, created_at;
-- 期待: 計4行
--   900000099001    … 受付済 1行（再配達）
--   900000099002    … 取消1行（置き配）＋受付済1行（時間変更）＝2行
--   KAZ900000099099 … 受付済 1行（置き配・verified=false）
