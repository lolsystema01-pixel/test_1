-- =============================================================
-- 荷主マスタ v0.2 確認SQL
-- 実行: shippers_v0.sql → import_shipper_map_v0.sql →（再）shippers_v0.sql の後。
-- ★ SupabaseのSQLエディタは複数文を一度に実行すると最後の結果しか表示しない。
--   → 見たいブロック（begin〜rollback 含む）を選択して Ctrl/Cmd+Enter で個別実行。
-- =============================================================


-- ① seed：荷主が text PK で登録されている（正準規格 v1: 2社）---------
--    期待 2行：SHIP01 / HACHI EXPRESS、SHIP02 / ニコイチ運輸。
select shipper_id, shipper_name from public.shippers order by shipper_id;       -- SHIP01, SHIP02


-- ② 取込マッピング：名称→コード変換されている（名前は入らない）---------
--    ・SHIP01 の荷物が取込まれている（HACHI EXPRESS 18行→ユニーク16件）。
--    ・shipper_id に名称 'HACHI EXPRESS' が入っている行は 0（＝名前を素通りさせていない）。
select
  (select count(*) from public.deliveries where shipper_id = 'SHIP01')        as "SHIP01件数",       -- 期待 16（取込分。他seed併存時は+α）
  (select count(*) from public.deliveries where shipper_id = 'HACHI EXPRESS') as "名称混入(0期待)";  -- 期待 0


-- ③ 未一致（保留）の可視化：マスタに無い荷主名は件数で分かる ----------
--    staging の荷主名のうち shippers に無いもの（＝取込時に保留＝NULL になる名称）。
--    HACHI EXPRESS は登録済なので期待 0行。未登録荷主を混ぜると件数で出る。
select s.shipper as "未一致荷主名", count(*) as "件数"
from public.import_staging s
left join public.shippers sh on sh.shipper_name = s.shipper
where sh.shipper_id is null
group by s.shipper;                                                            -- 期待 0行

--    ★取込（import_staging）で入れた荷物のうち shipper_id 未確定の件数。全解決なら 0。
--    ※ 配車ダミー DSP-*（import_batch_id='DISP-SEED'）等は荷主を持たない（NULL）のが正常。
--      それらを拾わないよう、取込対象＝staging の問合番号に限定して数える。
select count(*) as "保留deliveries(0期待)"
from public.deliveries d
where d.shipper_id is null
  and d.tracking_number in (select tracking_number from public.import_staging);  -- 期待 0


-- ④ backfill：名称が入っていた行がコード化され、混在が消えている --------
--    deliveries.shipper_id が shippers.shipper_name（名称）と一致する行＝未backfill。
select count(*) as "名称のまま残存(0期待)"
from public.deliveries d
join public.shippers sh on sh.shipper_name = d.shipper_id;                     -- 期待 0


-- ⑤ FK：deliveries.shipper_id → shippers.shipper_id が成立している --------
--    (a) FK制約が存在するか。
select conname as fk_name
from pg_constraint
where conrelid = 'public.deliveries'::regclass
  and contype = 'f'
  and conname = 'deliveries_shipper_id_fkey';                                  -- 期待 1行

--    (b) FK整合性：マスタに無い shipper_id（NULL以外）が残っていないか＝未解決0件。
select count(*) as "未解決shipper_id(0期待)"
from public.deliveries d
where d.shipper_id is not null
  and not exists (select 1 from public.shippers s where s.shipper_id = d.shipper_id);  -- 期待 0


-- ⑥ RLS：shippers にRLSが有効か ----------------------------------------
select c.relrowsecurity as shippers_rls_enabled
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'shippers';                         -- 期待 true


-- ⑦ RLS：本部 hq は全荷主が見える（期待 2）----------------------------
begin;
  set local request.jwt.claims = '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000001"}';
  set local role authenticated;
  select 'hq' as role, count(*) as "見えるshippers" from public.shippers;     -- 期待 2
rollback;


-- ⑧ RLS：荷主 SHIP01 は自社行のみ（範囲外0件を実証）-------------------
--    荷主SHIP01(...0f1) には自社 SHIP01 の1行のみ見え、別荷主 SHIP02 は 0件
--    ＝ shipper_id=my_shipper() で絞れていること（範囲外0件）を実証する。
--    ※ seed_accounts_v0.sql の荷主アカウント(...0f1=SHIP01) と SHIP02 マスタ前提。
begin;
  set local request.jwt.claims = '{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000000f1"}';
  set local role authenticated;
  select 'shipper SHIP01' as role,
    (select count(*) from public.shippers)                           as "見える(自社のみ=1期待)",
    (select count(*) from public.shippers where shipper_id='SHIP02')  as "他社SHIP02(0期待)";
rollback;


-- ⑨ RLS：ドライバーは shippers を読めない（ポリシー無し＝0）-----------
begin;
  set local request.jwt.claims = '{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000000d1"}';
  set local role authenticated;
  select 'driver' as role, count(*) as "見えるshippers(0期待)" from public.shippers;  -- 期待 0
rollback;


-- =============================================================
-- 合格条件との対応
--   ・text PK で SHIP01/HACHI EXPRESS が seed   … ①
--   ・名称→コード変換／名前は入らない           … ②（名称混入=0）
--   ・未一致は保留・件数で分かる                 … ③（未一致荷主名・保留deliveries=0）
--   ・名称→SHIP01 backfill／混在解消             … ④（名称のまま残存=0）
--   ・FK成立（未解決0件）                        … ⑤(a) FK存在 ＆ (b) 未解決=0
--   ・shippers RLS有効                           … ⑥ true
--   ・hq=全 / 荷主=自社のみ（範囲外0件）         … ⑦=1 / ⑧（自社=1・他社=0）
--   ・driver は読めない                          … ⑨=0
-- =============================================================
