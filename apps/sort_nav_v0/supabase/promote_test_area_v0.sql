-- =============================================================
-- 検証用: テストGoogleユーザーを「営業所(area)」に昇格する
--   仕分けナビ v0 の検証準備。自営業所スコープ（A01＝愛知県1営業所）で確認する。
--   前提: 認証 v0.3（profiles 自動作成）／RLS v0.2 実行済み。
--         配車 v0／採番一式 v0 実行済み（当日 A01 に採番済みデータがある）。
--         テスト用 Google アカウントで仕分けナビに一度ログイン済み（profiles に role=NULL の行）。
-- 実行: Supabase SQL Editor（管理者＝RLS無視で更新）。
-- =============================================================
-- ★ ここを仕分けナビにログインしたテストGoogleアカウントのメールに変える（2か所）。

-- 1) area（営業所A01）へ昇格 ------------------------------------------
update public.profiles p
set role        = 'area',
    depot_code  = 'D01',
    office_code = 'A01',
    driver_id   = null,
    shipper_id  = null
from auth.users u
where u.id = p.user_id
  and u.email = 'lolsystem.a01@gmail.com';   -- ★テスト用メールに

-- 2) 確認 -------------------------------------------------------------
select u.email, p.role, p.office_code
from public.profiles p
join auth.users u on u.id = p.user_id
where u.email = 'lolsystem.a01@gmail.com';    -- ★同じメールに
-- 期待: role=area / office_code=A01

-- 3) 自営業所スコープの想定（RLS確認の答え合わせ）---------------------
--    A01 の当日 index_today 件数（=仕分けナビ起動時に取れる件数）
select count(*) as a01_index_today
from public.index_today where office_code = 'A01';
-- 期待: A01 の当日採番済み件数（配車 v0 のseed基準＝700件前後／DRV001+DRV002+仮1..3）
