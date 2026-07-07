-- =============================================================
-- 指示書: 配車表PDF v0 — 手順 3/4：確認
--   件数・仕分済/未仕分・配達順の並び・（RLS自営業所のみ）を確認する。
-- 実行: Supabase SQL Editor。dispatch_sheet_v0.sql 実行後。
--   ※ RLS自営業所スコープの最終証明はアプリ（area ログイン）の表示で行う
--     （SQL Editor は postgres＝RLSバイパスのため）。
-- =============================================================

-- ① ドライバー別 件数（総数／仕分済／未仕分）。seed後は DRV001 に仕分済が出る --
select office_code, driver_id, total, sorted, unsorted
from public.dispatch_sheet_summary
where delivery_date = current_date
order by office_code, driver_id;
-- 期待(seed後): A01 DRV001 total=160/sorted=30/unsorted=130、他=0仕分済
--   仕分前モード（seed前 or クリーンアップ後）: 全ドライバー sorted=0

-- ② 配達順の並び：各ドライバー 1..N の連番（明細の並び）-------------------
select driver_id,
       min(delivery_order) as mn, max(delivery_order) as mx, count(*) as cnt,
       case when min(delivery_order)=1 and max(delivery_order)=count(*)
                 and count(distinct delivery_order)=count(*)
            then 'OK' else 'NG' end as judge
from public.dispatch_sheet
where delivery_date = current_date
group by driver_id order by driver_id;
-- 期待: 全ドライバー OK（配達順は採番一式の連番のまま）

-- ③ 明細サンプル（DRV001 先頭10件・配達順）------------------------------
select driver_id, delivery_order, basket_code, tracking_number, time_window, status, is_sorted
from public.dispatch_sheet
where delivery_date = current_date and driver_id = 'DRV001'
order by delivery_order
limit 10;
-- 期待: 配達順1..10・かご記号A..・seed後は先頭が is_sorted=true（仕分済）

-- ④ 総量整合：summary の total 合計 = sheet の行数 ----------------------
select
  (select coalesce(sum(total),0) from public.dispatch_sheet_summary where delivery_date=current_date) as summary_total,
  (select count(*) from public.dispatch_sheet where delivery_date=current_date)                       as sheet_rows;
-- 期待: 一致


-- =============================================================
-- v0.3（§12.10.1）仕分後モードの表示定義の検証
--   仕分後＝『仕分済の行だけ＋未仕分残数サマリ』。フロントは下と同じ条件で絞る/集計する。
--   ※ seed_sort_status_v0（一部を status='仕分済'）を流した状態で確認。
-- =============================================================

-- ⑤ 仕分後に「出る行数」＝仕分済件数（未仕分の明細は出ない）--------------
select
  (select count(*) from public.dispatch_sheet
     where delivery_date=current_date and is_sorted)                       as post_rows_shown,      -- 仕分後に表示される明細行
  (select coalesce(sum(sorted),0)   from public.dispatch_sheet_summary
     where delivery_date=current_date)                                     as sorted_total,          -- 仕分済件数
  (select count(*) from public.dispatch_sheet
     where delivery_date=current_date and not is_sorted)                   as unsorted_detail_hidden;-- 仕分後で「出さない」未仕分明細
-- 期待: post_rows_shown = sorted_total（仕分済だけ表示）／ unsorted_detail_hidden は明細に出さず残数のみ。

-- ⑥ 未仕分残数サマリ（ドライバー別＋合計）＝summary.unsorted -------------
select driver_id, unsorted as "未仕分_残"
from public.dispatch_sheet_summary
where delivery_date=current_date and unsorted > 0
order by driver_id;
select coalesce(sum(unsorted),0) as "未仕分_残_合計"
from public.dispatch_sheet_summary where delivery_date=current_date;
-- 期待: 仕分後PDFの残数サマリ（ドライバー別＋合計）と一致。

-- ⑦ 仕分前は全行（差の確認）--------------------------------------------
select
  (select count(*) from public.dispatch_sheet where delivery_date=current_date)                 as pre_rows_all,   -- 仕分前=全行
  (select count(*) from public.dispatch_sheet where delivery_date=current_date and is_sorted)   as post_rows;      -- 仕分後=仕分済のみ
-- 期待: pre_rows_all >= post_rows（未仕分がある分だけ仕分前が多い）。

-- =============================================================
-- 合格条件との対応
--   ・仕分前＝全ドライバー行（配達順）                         … ②⑦
--   ・仕分後＝仕分済の行のみ＋未仕分残数サマリ（別＋合計）      … ⑤⑥
--   ・出力ダイアログ（仕分後推奨）・ファイル名に仕分前/仕分後  … フロント /sheet で確認
-- =============================================================
