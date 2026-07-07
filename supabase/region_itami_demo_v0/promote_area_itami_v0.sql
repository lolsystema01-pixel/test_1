-- =============================================================
-- 伊丹営業所(IT01) の area ログインを用意（配車表PDF/かご持出/GoDoor/ラベル で兵庫デモを表示）
-- 実行: Supabase SQL Editor。★ 'YOUR_EMAIL' を自分のログインメールに置換。
--   前提: region_setup_v0.sql で offices(IT01)・depots(D_ITM) 作成済み。
-- =============================================================

-- 方法A（推奨・速い）: 今のアカウントを一時的に IT01 の area にする（デモ後に元へ戻す）------
update public.profiles
set role = 'area', office_code = 'IT01'
where user_id = (select id from auth.users where email = 'YOUR_EMAIL');

-- 確認
select p.user_id, u.email, p.role, p.office_code
from public.profiles p join auth.users u on u.id = p.user_id
where u.email = 'YOUR_EMAIL';
-- 期待: role=area / office_code=IT01

-- ▼ デモ終了後に元の営業所へ戻す（例: A01）。使うときだけコメント解除。
-- update public.profiles set office_code = 'A01'
--  where user_id = (select id from auth.users where email = 'YOUR_EMAIL');


-- 方法B（別アカウントを用意する場合）------------------------------------------
--   1) Supabase Dashboard → Authentication → Add user（例 itami01@test.local・パスワード・Auto Confirm）
--   2) 下を実行（メールを合わせる）。profiles はトリガで自動作成済み（role=NULL）→ IT01 の area に更新。
-- update public.profiles set role='area', office_code='IT01'
--  where user_id = (select id from auth.users where email = 'itami01@test.local');
