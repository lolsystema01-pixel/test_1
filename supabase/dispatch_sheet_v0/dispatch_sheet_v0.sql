-- =============================================================
-- 指示書: 配車表PDF（仕分前／仕分後）v0 — 手順 1/4：配車表データのビュー
--   対応: 要件定義 6.9 帳票出力（配車表PDF：日付×ドライバー／仕分済・未仕分）
-- 実行: Supabase SQL Editor。前提=配車 v0.5／採番一式 v0.5 実機済み
--        （deliveries に driver_id・delivery_order・basket_code・status）。
-- =============================================================
-- ・area ロールが自営業所のみ見えるよう security_invoker=on（deliveries のRLSを継承）。
-- ・対象日(delivery_date)の絞り込みはフロント側で `.eq('delivery_date', 対象日)`。
-- ・仕分前/仕分後はフロントのモード切替。データは同一（並びは配達順）。
--   仕分済＝status='仕分済' ／ 未仕分＝それ以外（配車済 等）。
-- =============================================================
-- 【v0.3（§12.10.1）表示定義】ビュー土台は v0.2 のまま（is_sorted・unsorted を既に提供）。
--   ・仕分前モード＝全ドライバー行（配車計画）。
--   ・仕分後モード＝dispatch_sheet の `is_sorted=true`（status='仕分済'）の行だけ表示（未仕分の明細は出さない）
--     ＋ dispatch_sheet_summary の `unsorted` を「未仕分 残N件（ドライバー別＋合計）」サマリとして出す。
--   ＝仕分後の絞り込み/残数集計はフロントで本ビュー・サマリを使って行う（本ビュー自体は無改修）。
-- =============================================================

-- 氏名列（CSV取込 csv_import_v0 が追加する列。未ロードでも動くよう冪等に用意）------
alter table public.deliveries add column if not exists recipient_name text;

-- 行データ：ドライバー×配達順（PDF本体の明細）-----------------------
create or replace view public.dispatch_sheet
with (security_invoker = on) as
select
  d.office_code,
  d.delivery_date,
  d.driver_id,
  d.delivery_order,                       -- 配達順（並びの主キー）
  d.basket_code,                          -- かご記号
  d.tracking_number,                      -- 問合番号
  d.address,                              -- 配送先住所
  d.recipient_name,                       -- 氏名（CSV取込で付く。DSPダミーは空）
  d.time_window,                          -- 時間指定
  d.status,                               -- ステータス
  (d.status = '仕分済') as is_sorted      -- 仕分後モードの仕分済フラグ
from public.deliveries d
where d.driver_id is not null;

comment on view public.dispatch_sheet is '配車表PDF明細：自営業所×対象日の荷物をドライバー×配達順で（area RLS）';

grant select on public.dispatch_sheet to authenticated;


-- 集計：ドライバー別の 総数／仕分済／未仕分（ヘッダ件数）-------------
create or replace view public.dispatch_sheet_summary
with (security_invoker = on) as
select
  d.office_code,
  d.delivery_date,
  d.driver_id,
  count(*)                                  as total,
  count(*) filter (where d.status = '仕分済') as sorted,
  count(*) filter (where d.status <> '仕分済') as unsorted
from public.deliveries d
where d.driver_id is not null
group by d.office_code, d.delivery_date, d.driver_id;

comment on view public.dispatch_sheet_summary is '配車表PDFヘッダ用：ドライバー別 総数/仕分済/未仕分（area RLS）';

grant select on public.dispatch_sheet_summary to authenticated;

-- 確認（当日・営業所別）-----------------------------------------------
select office_code, count(distinct driver_id) as drivers, count(*) as rows
from public.dispatch_sheet
where delivery_date = current_date
group by office_code order by office_code;
