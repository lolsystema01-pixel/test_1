-- =============================================================
-- 手順 4/4: RLS 動作確認
-- 実行: SQL Editor に貼り付けて Run（seed_dummy.sql の後）
-- =============================================================
-- SQL Editor は既定で管理者(postgres)権限＝RLS を無視する。
-- 各営業所の見え方は、authenticated ロール＋営業所の JWT クレームに
-- 切り替えて確認する。各ブロックは begin ... rollback で囲っているので、
-- ロール/クレームの変更はブロック内だけに留まり、データは変更されない。
--
-- ★ 期待結果まとめ
--   ① 管理者(RLS無視) : 合計 5 件（A=3, B=2）
--   ② 営業所A の権限   : 3 件（A=3, B=0）
--   ③ 営業所B の権限   : 2 件（B=2, A=0）
-- =============================================================


-- ① 管理者(RLS無視)で全件確認 ---------------------------------
select 'admin (RLS無視)' as mode, count(*) as visible_count
from public.deliveries;

select 'admin (RLS無視)' as mode, office_id, count(*) as cnt
from public.deliveries
group by office_id
order by office_id;


-- ② 営業所A の権限で確認（A=3件だけ / B=0件 のはず）-----------
begin;
  set local request.jwt.claims = '{"role":"authenticated","office_id":"A"}';
  set local role authenticated;

  select '営業所A' as mode, count(*) as visible_count
  from public.deliveries;

  select '営業所A' as mode, office_id, count(*) as cnt
  from public.deliveries
  group by office_id
  order by office_id;
rollback;


-- ③ 営業所B の権限で確認（B=2件だけ / A=0件 のはず）-----------
begin;
  set local request.jwt.claims = '{"role":"authenticated","office_id":"B"}';
  set local role authenticated;

  select '営業所B' as mode, count(*) as visible_count
  from public.deliveries;

  select '営業所B' as mode, office_id, count(*) as cnt
  from public.deliveries
  group by office_id
  order by office_id;
rollback;


-- =============================================================
-- 合格条件（指示書）との対応
--   ・営業所Aの権限で、Aの行だけ見える ……………… ② が A=3, B=0
--   ・営業所Aの権限で、Bの行が1件も見えない ……… ② で B が出ない
--   ・営業所Bでも逆向きに同じ ………………………… ③ が B=2, A=0
--   ・管理者(RLS無視)と営業所権限で件数が変わる … ① =5 と ②=3 / ③=2
-- =============================================================
