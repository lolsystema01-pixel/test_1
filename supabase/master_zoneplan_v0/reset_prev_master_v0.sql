-- =============================================================
-- 既存のマスタ・ダミー（address_master / zone_plan）を削除（読込の前に1回）
-- 実行: create_master_v0.sql の後、load_master_v0.sql の前に1回 Run
-- =============================================================
-- address_master.common_id → zone_plan(common_id) のFKがあるので、
-- 子（address_master）→ 親（zone_plan）の順で削除する。

delete from public.address_master;
delete from public.zone_plan;

-- 確認（両方0なら掃除完了）
select 'address_master' as tbl, count(*) from public.address_master
union all
select 'zone_plan', count(*) from public.zone_plan;
