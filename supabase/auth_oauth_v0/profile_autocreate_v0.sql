-- =============================================================
-- 指示書: 認証 v0.3（Google OAuth土台）
--   【AI】担当: 新規 auth ユーザー作成時に profiles 行を自動作成する仕組み
--   対応: 要件定義 5.2 認証（役割別・内部=Google OAuth）
-- 実行: Supabase SQL Editor に貼り付けて Run
-- 前提: rls_v0/profiles_v0.sql 実行済み（profiles テーブルと判定ヘルパーがある）
-- =============================================================
-- 設計:
--  ・auth.users に行が増えたら、public.profiles に同じ user_id の行を自動作成。
--  ・初期は「ロール未設定」= role を NULL にする（付与は本部＝別作業）。
--    role=NULL のユーザーは my_role() が NULL を返し、RLSで何も見えない（fail-closed）。
--  ・関数は SECURITY DEFINER（auth トリガ文脈から public.profiles へ安全に書く）。
-- =============================================================

-- 1) role を「未設定(NULL)」可能にする ------------------------
--    rls_v0 では role NOT NULL だった。未設定状態を許すため NOT NULL を外す。
--    CHECK(role in (...)) は NULL では成立扱いなので、そのまま残してよい。
alter table public.profiles alter column role drop not null;

comment on column public.profiles.role is 'ロール。NULL=未設定（新規作成直後）。付与は本部が行う';


-- 2) 新規ユーザー時に profiles を自動作成する関数 ---------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- ロール・帰属は未設定（NULL）で作成。重複時は何もしない。
  insert into public.profiles (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

comment on function public.handle_new_user() is 'auth.users 追加時に profiles 行を自動作成（role未設定）';


-- 3) auth.users への INSERT トリガ ----------------------------
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();
