-- =============================================================
-- 認証/RLS検証で作った「以前のダミー荷物」を削除（CSV取込の前に1回だけ実行）
-- 実行: import_v0.sql の前に、SQL Editor で1回 Run
-- =============================================================
-- ・対象は配送データ（荷物）と問合Index のダミーのみ。
--   マスタ(depots/offices/zone_plan/area_master)・profiles・drivers・
--   work_schedules は残す（他検証で使用）。
-- ・delivery_index は deliveries を参照するので先に削除する。

delete from public.delivery_index;
delete from public.deliveries;

-- 確認（0件になっていれば掃除完了）
select 'deliveries' as tbl, count(*) from public.deliveries
union all
select 'delivery_index', count(*) from public.delivery_index;
