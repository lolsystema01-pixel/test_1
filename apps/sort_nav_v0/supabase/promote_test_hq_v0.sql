-- =============================================================
-- 検証用：Googleログイン済みのテストユーザーを hq（本部/管理者）に昇格
--   管理者設定 v0.1（§12.13）の実機確認で、/admin/settings を編集モードで開くために使う。
-- 実行: Supabase SQL Editor。
-- =============================================================
-- 【なぜ必要か】
--   seed_accounts_v0.sql が入れる hq プロフィールは user_id が
--   '00000000-0000-0000-0000-000000000001' のダミーUUIDで、auth.users に実体が無い。
--   → SQLのなりすまし検証には使えるが、Googleログインはできない。
--   実機で hq として画面を触るには、実在のアカウントを hq に昇格する必要がある。
--
-- 【重要な副作用】
--   role は1アカウントに1つ。hq に昇格すると **area ではなくなる**ため、
--   /home・/sort・/sheet・/carry・/godoor・/label は /incomplete に飛ぶ（area 前提のため）。
--   hq が使えるのは /admin/settings（直接URLを開く）。
--   → 検証が終わったら §3 で area に戻すこと。
--   → 2つ目のGoogleアカウントがあるなら、そちらを hq にするのが安全（切り替え不要）。
-- =============================================================

-- ★ 'YOUR_EMAIL' を、ログインに使う Google アカウントのメールに置換すること。


-- =============================================================
-- §0. 現在の状態を確認（昇格前に控えておく）
-- =============================================================
select u.email, p.user_id, p.role, p.office_code, p.depot_code
from auth.users u
join public.profiles p on p.user_id = u.id
where u.email = 'YOUR_EMAIL';
-- 例: role=area / office_code=IT01 → 戻すときにこの値を使う


-- =============================================================
-- §1. hq へ昇格（office_code / depot_code は NULL にする＝本部は特定営業所に属さない）
-- =============================================================
update public.profiles
set role = 'hq', office_code = null, depot_code = null
where user_id = (select id from auth.users where email = 'YOUR_EMAIL');

-- 確認
select u.email, p.role, p.office_code
from auth.users u join public.profiles p on p.user_id = u.id
where u.email = 'YOUR_EMAIL';
-- 期待: role=hq / office_code=(null)


-- =============================================================
-- §2. 実機確認（ブラウザ）
--   1) 一度ログアウトして入り直す（セッションのロールを反映させるため）
--   2) http://localhost:5173/admin/settings を **直接** 開く
--      ※ / や /home は area 専用なので hq では /incomplete に飛ぶ（仕様どおり）
--   3) 全営業所が表示され、4項目を編集・保存できる／「再読込」で保持を確認
-- =============================================================


-- =============================================================
-- §3. 検証後に area へ戻す（★忘れずに）
--   ★ 'IT01' は §0 で控えた元の office_code に置換すること。
-- =============================================================
-- update public.profiles
-- set role = 'area', office_code = 'IT01', depot_code = 'D_ITM'
-- where user_id = (select id from auth.users where email = 'YOUR_EMAIL');
--
-- select u.email, p.role, p.office_code from auth.users u
--   join public.profiles p on p.user_id = u.id where u.email = 'YOUR_EMAIL';
-- -- 期待: role=area / office_code=IT01（元に戻っている）
