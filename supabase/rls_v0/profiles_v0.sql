-- =============================================================
-- 指示書: RLS v0（拠点／営業所／ドライバー／荷主の範囲）
--   対応: 要件定義 5.3 権限制御(RLS) / 11.3 セキュリティ
-- 手順 1/4: 帰属の仕組み（profiles＋判定ヘルパー）
-- 実行: Supabase SQL Editor に貼り付けて Run
-- 前提: 「DBスキーマ v0（骨格）」のテーブルが作成済みであること。
-- =============================================================
-- profiles = ログイン中アカウント(auth.uid())↔ロール・帰属 の対応表。
--   検証用なのでダミーUUIDで可（認証基盤の実構築は範囲外）。

drop table if exists public.profiles cascade;

create table public.profiles (
  user_id     uuid primary key,                                  -- 認証ユーザーID（検証ではダミーUUID）
  role        text not null
              check (role in ('hq','depot','area','driver','shipper')), -- ロール（5.1）
  depot_code  text,                                              -- 拠点コード（拠点管理の帰属）
  office_code text,                                              -- 営業所コード（営業所の帰属）
  driver_id   text,                                              -- ドライバーID（ドライバーの帰属）
  shipper_id  text                                               -- 荷主ID（荷主の帰属）
);
comment on table public.profiles is 'アカウント↔帰属（ロール・拠点/営業所/ドライバー/荷主）。RLS判定の起点';


-- =============================================================
-- 判定ヘルパー（SECURITY DEFINER）
--   ・auth.uid() から自分のロール・帰属を解決する。
--   ・SECURITY DEFINER にして profiles 等のRLSを跨いで自分の行を読む
--     （ポリシー内で安全に使え、RLSの再帰も避けられる標準パターン）。
-- =============================================================

create or replace function public.my_role() returns text
  language sql stable security definer set search_path = public as $$
  select role from public.profiles where user_id = auth.uid()
$$;

create or replace function public.my_office() returns text
  language sql stable security definer set search_path = public as $$
  select office_code from public.profiles where user_id = auth.uid()
$$;

create or replace function public.my_depot() returns text
  language sql stable security definer set search_path = public as $$
  select depot_code from public.profiles where user_id = auth.uid()
$$;

create or replace function public.my_driver() returns text
  language sql stable security definer set search_path = public as $$
  select driver_id from public.profiles where user_id = auth.uid()
$$;

create or replace function public.my_shipper() returns text
  language sql stable security definer set search_path = public as $$
  select shipper_id from public.profiles where user_id = auth.uid()
$$;

-- 拠点管理の「配下営業所」の営業所コード一覧（offices のRLSを跨ぐ）
create or replace function public.my_depot_offices() returns setof text
  language sql stable security definer set search_path = public as $$
  select office_code from public.offices where depot_code = public.my_depot()
$$;

-- 営業所の「自営業所所属ドライバー」のID一覧（drivers のRLSを跨ぐ）
create or replace function public.my_office_drivers() returns setof text
  language sql stable security definer set search_path = public as $$
  select driver_id from public.drivers where office_code = public.my_office()
$$;
