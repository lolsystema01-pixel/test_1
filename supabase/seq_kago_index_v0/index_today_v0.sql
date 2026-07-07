-- =============================================================
-- 指示書: 採番＋問合Index同期 v0.5 — 手順 2/3：当日対象の問合Index一括取得
--   対応: 要件定義 6.7 仕分け（仕分けナビ起動時に当日分を一括取得しブラウザ内参照）
-- 実行: Supabase SQL Editor。前提=renumber_v0.sql 本実行（問合Index同期済み）。
-- =============================================================
-- ・仕分けナビ(6.7)が「起動時に一括取得」する対象＝当日(current_date)の問合Index。
-- ・問合Index自体は日付列を持たないため、deliveries.delivery_date で当日に絞る。
-- ・RLSは呼び出し元（営業所/ドライバー）の権限を効かせる＝security_invoker。
--     → 営業所は自営業所、ドライバーは自担当のみ取得（rls_v0 のポリシーが効く）。
-- =============================================================

create or replace view public.index_today
with (security_invoker = on) as
select
  di.tracking_number,         -- 問合番号
  di.driver_id,               -- ドライバー（実/仮）
  di.delivery_order,          -- 配達順
  di.basket_code,             -- かご記号
  di.common_id,               -- 共通ID
  d.office_code,              -- 営業所（絞り込み・表示用）
  d.address,                  -- 配送先住所
  d.time_window,              -- 時間指定
  d.delivery_date             -- 日付（当日）
from public.delivery_index di
join public.deliveries d on d.tracking_number = di.tracking_number
where d.delivery_date = current_date;

comment on view public.index_today is '当日対象の問合Index一括取得（仕分けナビ6.7の起動時取得用）。security_invoker=onで呼び出し元RLSを適用';

grant select on public.index_today to authenticated;

-- 使い方（仕分けナビ起動時の一括取得イメージ）------------------------
--   select * from public.index_today;                       -- 当日分すべて（RLSで自分の範囲のみ）
--   select * from public.index_today where driver_id = '<自分>';   -- 特定ドライバー
-- 確認（当日件数）-----------------------------------------------------
select count(*) as today_index_rows from public.index_today;
