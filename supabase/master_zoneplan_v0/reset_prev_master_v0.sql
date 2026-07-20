-- =============================================================
-- 既存のマスタ・ダミー（zone_plan）を削除（読込の前に1回）
-- 実行: create_master_v0.sql の後、load_master_v0.sql の前に1回 Run
-- =============================================================
-- ⚠ RETIRED部分あり（2026-07-17）: address_master は撤去済み（語彙是正⑤）。
--   旧: address_master.common_id → zone_plan(common_id) の FK があるため
--       子（address_master）→ 親（zone_plan）の順で削除していた。
--   現: その FK ごと address_master が消えたので、zone_plan の削除のみでよい。
--   ★ address_master の delete を復活させないこと（フレッシュ環境では即エラーになる）。
--
-- ⚠ zone_plan には②で新語彙1,653件が入っている。ここで全削除すると語彙是正②〜⑤の結果が消える。
--   フレッシュ環境の初回構築以外では実行しないこと。

-- delete from public.address_master;   -- RETIRED（⑤で撤去）
delete from public.zone_plan;

-- 確認（0なら掃除完了）
select 'zone_plan' as tbl, count(*) from public.zone_plan;
