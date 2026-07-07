-- =============================================================
-- 認証 v0.3 確認SQL（profiles自動作成・auth.uid()→ロール取得）
-- 実行: profile_autocreate_v0.sql の後、かつ
--       【人】がSupabaseで認証ユーザーを1人追加した後に Run
-- =============================================================
-- ★ SQLエディタは複数文だと最後の結果しか出ない。各ブロックを選択して実行。

-- ① トリガ・関数が入っているか --------------------------------
--    on_auth_user_created（auth.users）と handle_new_user が出れば OK。
select tgname as trigger_name, tgrelid::regclass as on_table
from pg_trigger
where tgname = 'on_auth_user_created';

select proname as function_name, prosecdef as security_definer
from pg_proc
where proname = 'handle_new_user';


-- ② 自動作成の確認：authユーザーに対し profiles 行ができているか ----
--    profile_created = true、role_未設定 = NULL（空欄）なら期待どおり。
select
  u.id            as user_id,
  u.email,
  (p.user_id is not null) as profile_created,
  p.role          as role_未設定はNULL
from auth.users u
left join public.profiles p on p.user_id = u.id
order by u.created_at desc
limit 5;


-- ③ 全authユーザーに profiles が存在するか（取りこぼし0なら OK）----
--    missing_profiles = 0 が期待値。
select count(*) as missing_profiles
from auth.users u
left join public.profiles p on p.user_id = u.id
where p.user_id is null;


-- ④ auth.uid() から profiles のロール・帰属が引けるか --------------
--    ②で得た user_id を <USER_UUID> に貼り替えて、ブロックごと選択して実行。
--    そのユーザーになりきって my_role()/my_office() が引けることを確認する。
--    付与前は role=NULL（未設定）が返るのが正しい。
begin;
  set local request.jwt.claims = '{"role":"authenticated","sub":""}';
  set local role authenticated;
  select
    public.my_role()    as role,        -- 未設定なら NULL
    public.my_office()  as office_code,
    public.my_driver()  as driver_id,
    public.my_shipper() as shipper_id;
rollback;


-- ⑤ （任意）ロール付与後の再確認イメージ -------------------------
--    本部が帰属を付与する作業のイメージ（このSQL自体は付与の例。範囲外）。
--    付与後に④を再実行すると my_role() が設定値を返す。
-- update public.profiles
--   set role = 'area', office_code = 'A01', depot_code = 'D01'
--   where user_id = '<USER_UUID>';

-- =============================================================
-- 合格条件との対応
--   ・新規authユーザーで profiles 自動作成 … ②③（profile_created=true / missing=0）
--   ・auth.uid()→ロール・帰属が引ける       … ④（my_role() 等が返る。未設定はNULL）
--   ・トリガ/関数が導入されている           … ①
-- =============================================================
