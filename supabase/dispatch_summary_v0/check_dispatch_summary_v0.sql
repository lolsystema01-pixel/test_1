-- =============================================================
-- 配車サマリ v0.2 — 確認（judge付き）。dispatch_summary_v0.sql → seed_dispatch_summary_v0.sql の後。
-- =============================================================
-- 運用ルール: 各ブロックをコメント区切りで個別 Run。④のなりすましは begin;〜rollback; を丸ごと実行する
--   （set local role は同一トランザクション内でのみ有効・部分実行はRLSバイパスで誤判定）。
-- =============================================================

-- =============================================================
-- ① 3指標が出る（seed 直後の A01/当日：仮割当5・保留2・希望外3）
-- =============================================================
select seq, item, actual, judge from (
  select 1 as seq, '3指標が出る（仮割当5・保留2・希望外3）' as item,
         (select virtual_items||'/'||hold_items||'/'||off_preference_items
            from public.dispatch_summary where office_code='A01' and delivery_date=current_date) as actual,
         case when (select virtual_items=5 and hold_items=2 and off_preference_items=3
                      from public.dispatch_summary where office_code='A01' and delivery_date=current_date)
              then '✅ 仮5/保留2/希望外3' else '✗ seed未適用？' end as judge
  union all
  -- ② 仮割当（件数・人数）が概況カード office_home_summary の仮配車と一致
  select 2, '仮割当が概況カード（office_home_summary 仮配車）と一致（件数・人数）',
         (select ds.virtual_items||'/'||ds.virtual_drivers||' vs '||oh.virt_items||'/'||oh.virt_drivers
            from public.dispatch_summary ds join public.office_home_summary oh
              on oh.office_code=ds.office_code and oh.delivery_date=ds.delivery_date
            where ds.office_code='A01' and ds.delivery_date=current_date),
         case when (select ds.virtual_items=oh.virt_items and ds.virtual_drivers=oh.virt_drivers
                      from public.dispatch_summary ds join public.office_home_summary oh
                        on oh.office_code=ds.office_code and oh.delivery_date=ds.delivery_date
                      where ds.office_code='A01' and ds.delivery_date=current_date)
              then '✅ 一致' else '✗ 概況カードと不一致' end
  union all
  -- ③ 保留が「common_id 未付与かつ status=保留」で拾われる（②共通ID付与の保留分と一致）
  select 3, '保留が common_id NULL かつ status=保留 で拾われる',
         (select hold_items::text from public.dispatch_summary where office_code='A01' and delivery_date=current_date),
         case when (select ds.hold_items from public.dispatch_summary ds where ds.office_code='A01' and ds.delivery_date=current_date)
                 = (select count(*) from public.deliveries d where d.office_code='A01' and d.delivery_date=current_date
                      and d.common_id is null and d.status='保留')
              then '✅ 定義一致' else '✗' end
  union all
  -- ④ 希望外がドライバー別内訳で出る（DSD2=3・DSD1=0）
  select 4, 'ドライバー別 希望外内訳（DSD2=3 / DSD1=0）',
         (select string_agg(driver_id||':'||off_preference_items, ' ' order by driver_id)
            from public.dispatch_summary_by_driver where office_code='A01' and delivery_date=current_date and driver_id like 'DSD%'),
         case when (select off_preference_items from public.dispatch_summary_by_driver where driver_id='DSD2' and delivery_date=current_date)=3
               and (select off_preference_items from public.dispatch_summary_by_driver where driver_id='DSD1' and delivery_date=current_date)=0
              then '✅' else '✗' end
) t order by seq;
-- 【読み方】希望外は preferred_areas が入っている前提（seed が投入）。実運用で #28/シフトv0.7 前は 0。


-- =============================================================
-- ④ RLS なりすまし（area 自営業所のみ・範囲外0件）
--   ★ begin;〜rollback; を丸ごと実行。<AREA_A01_UUID> は rls_v0/seed_accounts_v0.sql の A01 area ユーザーの user_id に置換。
-- =============================================================
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"role":"authenticated","sub":"<AREA_A01_UUID>"}';
  select
    (select count(*) from public.dispatch_summary where office_code='A01') as a01_visible,   -- 期待 >0（範囲内）
    (select count(*) from public.dispatch_summary where office_code<>'A01') as other_visible; -- 期待 0（範囲外0件）
rollback;
-- 期待: a01_visible>0 / other_visible=0（security_invoker が deliveries RLS を継承）。
