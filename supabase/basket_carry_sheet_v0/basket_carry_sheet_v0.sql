-- =============================================================
-- 指示書: かご持出表PDF v0 — 手順 1/3：持出表データのビュー
--   対応: 要件定義 6.9 帳票出力（かご持出表PDF：ドライバー別／かご記号・担当個数）
-- 実行: Supabase SQL Editor。前提=配車 v0.5／採番一式 v0.5 実機済み
--        （deliveries に driver_id・basket_code・delivery_order）。
-- =============================================================
-- ・area ロールが自営業所のみ見えるよう security_invoker=on（deliveries/drivers のRLSを継承）。
-- ・対象日(delivery_date)の絞り込みはフロント側で `.eq('delivery_date', 対象日)`。
-- ・本体＝ドライバー × かご記号（basket_code）の担当個数。合計はサマリビュー。
-- ・配車表PDF（dispatch_sheet）と同じ土台。読み取りのみ（書き込みRLS不要）。
-- =============================================================

-- ① 明細：ドライバー × かご記号 → 担当個数（PDF本体）-----------------
--    ドライバー名は drivers から（area RLS=自営業所所属のみ。security_invokerで継承）。
create or replace view public.basket_carry_sheet
with (security_invoker = on) as
select
  d.office_code,
  d.delivery_date,
  d.driver_id,
  dr.driver_name,                                   -- ドライバー名（drivers より・RLS継承）
  d.basket_code,                                     -- かご記号
  count(*) as item_count                            -- 担当個数（そのかごの荷物数）
from public.deliveries d
left join public.drivers dr on dr.driver_id = d.driver_id
where d.driver_id is not null                       -- ドライバー確定分のみ（持出対象）
group by d.office_code, d.delivery_date, d.driver_id, dr.driver_name, d.basket_code;

comment on view public.basket_carry_sheet is
  'かご持出表PDF明細：自営業所×対象日を ドライバー×かご記号 で担当個数集計（area RLS）';

grant select on public.basket_carry_sheet to authenticated;


-- ② サマリ：ドライバー別の かご数／合計個数（ヘッダ・合計行）----------
create or replace view public.basket_carry_sheet_summary
with (security_invoker = on) as
select
  d.office_code,
  d.delivery_date,
  d.driver_id,
  dr.driver_name,
  count(distinct d.basket_code) as basket_count,    -- かご記号の種類数
  count(*)                      as total_count      -- 合計個数（持出総数）
from public.deliveries d
left join public.drivers dr on dr.driver_id = d.driver_id
where d.driver_id is not null
group by d.office_code, d.delivery_date, d.driver_id, dr.driver_name;

comment on view public.basket_carry_sheet_summary is
  'かご持出表PDFヘッダ/合計用：ドライバー別 かご数/合計個数（area RLS）';

grant select on public.basket_carry_sheet_summary to authenticated;


-- 確認（当日・営業所別）-----------------------------------------------
select office_code, count(distinct driver_id) as drivers, sum(item_count) as items
from public.basket_carry_sheet
where delivery_date = current_date
group by office_code order by office_code;
