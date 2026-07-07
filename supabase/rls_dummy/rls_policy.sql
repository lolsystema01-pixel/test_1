-- =============================================================
-- 手順 2/4: RLS 有効化 ＋ 営業所別 SELECT ポリシー
-- 実行: SQL Editor に貼り付けて Run（create_table.sql の後）
-- =============================================================

-- このテーブルで行レベルセキュリティを有効化する。
-- 有効化すると、ポリシーで許可された行以外は見えなくなる。
alter table public.deliveries enable row level security;

-- 再実行できるよう、同名ポリシーがあれば消してから作り直す。
drop policy if exists "select_own_office" on public.deliveries;

-- 自分の営業所（JWT の office_id クレーム）と一致する行だけ SELECT 可能にする。
--   auth.jwt() ->> 'office_id'  … 現在のリクエストの JWT から office_id を取り出す
-- 今回は INSERT/UPDATE/DELETE は対象外（for select のみ）。
create policy "select_own_office"
  on public.deliveries
  for select
  to authenticated
  using ( office_id = (auth.jwt() ->> 'office_id') );

-- -------------------------------------------------------------
-- 【補足】本番運用での office_id の渡し方について
--   今回は検証なので、確認SQL(手順4)で JWT クレームに office_id を直接注入する。
--   実運用では office_id を JWT に載せる必要があり、一般的には
--   Custom Access Token Hook で app_metadata 等に格納し、ポリシー側は
--     auth.jwt() -> 'app_metadata' ->> 'office_id'
--   のように読む。今回の検証スコープ外なのでトップレベルクレームで簡略化している。
-- -------------------------------------------------------------
