-- =============================================================
-- 仕分けナビ v0：読み取り補助ビュー deliveries_today
--   対応: 要件定義 6.7。仕分けナビが「保留／対象外／担当者不明」を分類するための当日荷物。
-- 実行: Supabase SQL Editor。前提=配車 v0／採番一式 v0 実行済み。
-- =============================================================
-- ・index_today（採番一式の成果物）は「配車済＋採番済（problemIndexにある）」だけを返す。
--   仕分けナビは加えて「当日・自営業所に存在するが index に無い荷物」や「保留」を判別したい。
--   そのために当日の自営業所荷物（status付き）を読む補助ビュー。新テーブルは作らない。
-- ・security_invoker=on で呼び出し元（area）のRLSを適用＝自営業所のみ。
--   （指示書の「delivery_index ⨝ deliveries を delivery_date で当日絞り」と同じ読み取り範囲）
-- =============================================================

create or replace view public.deliveries_today
with (security_invoker = on) as
select
  d.tracking_number,
  d.office_code,
  d.status,                  -- 未配車/保留/配車済 等（保留判定に使用）
  d.driver_id,
  d.common_id,
  d.delivery_order,
  d.basket_code,
  d.address,
  d.time_window,
  d.delivery_date
from public.deliveries d
where d.delivery_date = current_date;

comment on view public.deliveries_today is '当日の荷物（status付き・自営業所RLS）。仕分けナビの保留/対象外/担当者不明 判定用';

grant select on public.deliveries_today to authenticated;

-- 確認（当日件数）-----------------------------------------------------
select count(*) as today_rows from public.deliveries_today;
