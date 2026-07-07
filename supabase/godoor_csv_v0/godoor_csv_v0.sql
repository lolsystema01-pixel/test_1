-- =============================================================
-- 指示書: GoDoor用CSV出力 v0.2 — 手順 1/3：抽出ビュー
--   対応: 要件定義 6.9 帳票出力（GoDoor用CSV：仕分済の荷物）／第10章。
--   現行GAS 27_godoor_csv_export.js（exportGoDoorCSVToDriveWithSmartSort）準拠。
-- 実行: Supabase SQL Editor。前提=配車 v0.5／採番一式 v0.5 実機済み
--        （deliveries に driver_id・delivery_order・basket_code・status・recipient_name・address・time_window）。
-- =============================================================
-- ・対象＝自営業所×対象日×仕分済(status='仕分済')×ドライバー有効（空・『未割当』を除外）。
-- ・area ロールが自営業所のみ見えるよう security_invoker=on（deliveries/drivers のRLSを継承）。
-- ・21列Ver4.0整形・サニタイズ・並び・全体/ドライバー別の生成はフロント側（GAS 27 準拠）。
--   本ビューは「対象行＋必要フィールド」を返すだけ（並びもフロントで確定）。
-- ・対象日(delivery_date)の絞り込みはフロント側で `.eq('delivery_date', 対象日)`。
-- =============================================================

create or replace view public.godoor_csv
with (security_invoker = on) as
select
  d.office_code,
  d.delivery_date,
  d.driver_id,
  dr.driver_name,                       -- 担当ドライバー（driver_id→drivers.driver_name。仮ドライバー等はNULL）
  d.delivery_order,                      -- 配達順（並び＋届け先名2）
  d.basket_code,                         -- かご記号（届け先名2の前半）
  d.tracking_number,                     -- 伝票番号
  d.recipient_name,                      -- 氏名（届け先名1）
  d.address,                             -- 住所
  d.time_window                          -- 時間指定
from public.deliveries d
left join public.drivers dr on dr.driver_id = d.driver_id
where d.status = '仕分済'                 -- 仕分済のみ（未仕分・未配車は出さない）
  and d.driver_id is not null            -- ドライバー有効（空を除外）
  and d.driver_id <> '未割当';            -- 『未割当』を除外

comment on view public.godoor_csv is
  'GoDoor用CSV抽出：自営業所×対象日×仕分済×有効ドライバーの荷物（area RLS）。21列整形はフロント(GAS27準拠)';

grant select on public.godoor_csv to authenticated;


-- 確認（当日・営業所別／仕分済件数）-----------------------------------
select office_code, count(distinct driver_id) as drivers, count(*) as sorted_items
from public.godoor_csv
where delivery_date = current_date
group by office_code order by office_code;
