-- =============================================================
-- 手順 4/4: ロール別に見える行を確認（v0.2 / 表示しやすい1行版）
--   ★ 正準ダミーデータ規格 v1 に統一（愛知2拠点 A01/C01・B01廃止・12桁問合番号）。
-- 実行: seed_accounts_v0.sql の後
-- =============================================================
-- ★ SupabaseのSQLエディタは「複数の文を一度に実行すると最後の結果しか表示しない」。
--   → 見たいブロック（begin〜rollback）を選択して Ctrl/Cmd+Enter で個別に実行する。
--   各ブロックは1つのSELECTにしてあるので、選択実行すれば必ず結果が出る。
--
-- ★ 期待（荷物 / 問合Index / 稼働予定 / ドライバーマスタ）
--   admin(RLS無視) : 6 / 5 / 4 / 3
--   本部 hq        : 6 / 5 / 4 / 3
--   拠点 D01       : 3 / 3 / 0 / 0   （C01=D02は見えない）
--   営業所A01      : 3 / 3 / 3 / 2   （A01・DRV001,DRV002）
--   営業所C01      : 3 / 2 / 1 / 1   （C01・DRV003）
--   ドライバDRV001 : 2 / 2 / 2 / 1   （＋他DRV002の稼働・個人情報は 0）
--   荷主 SHIP01    : 4 / 3 / 0 / 0   （SHIP02行は範囲外）
-- =============================================================


-- ① 全テーブルでRLSが有効か（rls_enabled が全て true なら OK）------------
select c.relname as table_name, c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('profiles','depots','offices','zone_plan','address_master',
                    'deliveries','delivery_index','drivers','work_schedules')
order by c.relname;


-- ② 管理者(RLS無視)で全件（期待 6 / 5 / 4 / 3）-------------------------
select 'admin' as role,
  (select count(*) from public.deliveries)     as "荷物",
  (select count(*) from public.delivery_index) as "問合Index",
  (select count(*) from public.work_schedules) as "稼働予定",
  (select count(*) from public.drivers)        as "ドライバー";


-- ③ 本部 hq（期待 6 / 5 / 4 / 3）-- ↓この begin〜rollback を選択して実行 --
begin;
  set local request.jwt.claims = '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000001"}';
  set local role authenticated;
  select 'hq' as role,
    (select count(*) from public.deliveries)     as "荷物",
    (select count(*) from public.delivery_index) as "問合Index",
    (select count(*) from public.work_schedules) as "稼働予定",
    (select count(*) from public.drivers)        as "ドライバー";
rollback;


-- ④ 拠点管理 D01（期待 3 / 3 / 0 / 0。C01=D02は見えない）--------------
begin;
  set local request.jwt.claims = '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000002"}';
  set local role authenticated;
  select 'depot' as role,
    (select count(*) from public.deliveries)     as "荷物",
    (select count(*) from public.delivery_index) as "問合Index",
    (select count(*) from public.work_schedules) as "稼働予定",
    (select count(*) from public.drivers)        as "ドライバー";
rollback;


-- ⑤ 営業所A01（期待 3 / 3 / 3 / 2。自営業所＝A01・DRV001,DRV002）------
begin;
  set local request.jwt.claims = '{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000000a1"}';
  set local role authenticated;
  select 'areaA01' as role,
    (select count(*) from public.deliveries)     as "荷物",
    (select count(*) from public.delivery_index) as "問合Index",
    (select count(*) from public.work_schedules) as "稼働予定",
    (select count(*) from public.drivers)        as "ドライバー";
rollback;


-- ⑥ 営業所C01（期待 3 / 2 / 1 / 1。自営業所＝C01・DRV003）-------------
begin;
  set local request.jwt.claims = '{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000000c1"}';
  set local role authenticated;
  select 'areaC01' as role,
    (select count(*) from public.deliveries)     as "荷物",
    (select count(*) from public.delivery_index) as "問合Index",
    (select count(*) from public.work_schedules) as "稼働予定",
    (select count(*) from public.drivers)        as "ドライバー";
rollback;


-- ⑦ ドライバー DRV001（期待 2 / 2 / 2 / 1）★機微テーブルの分離を実証 ----
--    末尾2列（他DRV002の稼働予定・個人情報）が 0 なら、他ドライバーは見えない。
begin;
  set local request.jwt.claims = '{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000000d1"}';
  set local role authenticated;
  select 'driver' as role,
    (select count(*) from public.deliveries)     as "荷物",
    (select count(*) from public.delivery_index) as "問合Index",
    (select count(*) from public.work_schedules) as "稼働予定",
    (select count(*) from public.drivers)        as "ドライバー",
    (select count(*) from public.work_schedules where driver_id='DRV002') as "他DRV002稼働(0期待)",
    (select count(*) from public.drivers        where driver_id='DRV002') as "他DRV002個人(0期待)";
rollback;


-- ⑧ 荷主 SHIP01（期待 4 / 3 / 0 / 0。自社のみ・SHIP02行は範囲外）-----
begin;
  set local request.jwt.claims = '{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000000f1"}';
  set local role authenticated;
  select 'shipper' as role,
    (select count(*) from public.deliveries)     as "荷物",
    (select count(*) from public.delivery_index) as "問合Index",
    (select count(*) from public.work_schedules) as "稼働予定",
    (select count(*) from public.drivers)        as "ドライバー",
    (select count(*) from public.deliveries where shipper_id='SHIP02') as "他社SHIP02荷物(0期待)";
rollback;

-- =============================================================
-- 合格条件との対応（v0.2 / 正準規格 v1）
--   ・荷物のロール別可視       … ③〜⑧の「荷物」列が期待どおり
--   ・稼働予定 ドライバー分離  … ⑦の「稼働予定」=2 ＆「他DRV002稼働」=0
--   ・ドライバーマスタ 分離    … ⑦の「ドライバー」=1 ＆「他DRV002個人」=0
--   ・荷主の範囲外0件          … ⑧の「他社SHIP02荷物」=0
--   ・全テーブルRLS有効        … ① が全て true
--   ・管理者は全行見える差     … ② と各ロールの差
-- =============================================================
