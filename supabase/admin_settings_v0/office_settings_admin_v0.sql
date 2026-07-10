-- =============================================================
-- 指示書: 管理者設定（かご台車上限・かご振り順・自動ログアウト・印刷機種）v0.1 — 手順 1/3
--   対応: §12.13 管理者設定 ／ §12.12 かご振り順 ／ §12.1 自動ログアウト ／ §15.3 印刷機種
-- 実行: Supabase SQL Editor（postgres）。
-- =============================================================
-- 【設計判断（指示書との差分。PRで合意済み）】
--  ・指示書は §14 の `office_settings` テーブルを前提にしているが、本基盤では設定は
--    すでに `offices` に載っており、**採番エンジン renumber_build が offices を直接読んでいる**。
--    新テーブルを作ると「管理画面で編集しても採番に効かない」二重管理になるため、
--    `office_settings` は作らず **offices に列を追加**する（採番は無改修）。
--
--    指示書の列名            → 本基盤の実体
--      basket_capacity_max   → offices.basket_cart_limit   （既存）
--      basket_assign_order   → offices.basket_order        （既存）
--      auto_logout_enabled   → offices.auto_logout_enabled （本SQLで追加）
--      auto_logout_minutes   → offices.auto_logout_minutes （本SQLで追加）
--      printer_model         → offices.printer_model       （本SQLで追加）
--
--  ・`basket_cart_limit` に既定値は入れない（既存値 IT01=50 / A01=10 / C01=10 を保持）。
--    列 DEFAULT を 50 にするのは **新規営業所の INSERT のみ**に効く（既存行は変わらない）。
--  ・新設3列は `default null`（＝未設定）。消費側が既定値を適用する（§消費側の既定 参照）。
--
--  ・書き込みは write policy を作らず **SECURITY DEFINER 関数** で行う（本基盤の規約）。
--    編集は hq のみ。area/depot は既存の select ポリシーで参照のみ。
-- =============================================================


-- =============================================================
-- §1. 設定列の追加（新設は default null ＝未設定）
-- =============================================================
alter table public.offices add column if not exists auto_logout_enabled boolean;   -- 自動ログアウト 有効/無効
alter table public.offices add column if not exists auto_logout_minutes integer;   -- タイムアウト（分）
alter table public.offices add column if not exists printer_model       text;      -- 印刷エージェント機種

comment on column public.offices.basket_cart_limit   is 'かご台車上限個数（1台のかご台車に乗せる荷物の数）。NULL=未設定→採番は50を適用';
comment on column public.offices.basket_order        is 'かご振り順。DB値は ドライバー順/配達順順/ゾーン順。※「ドライバー順」の実装は【担当件数の多い順】（画面ラベルもそれに合わせる）';
comment on column public.offices.auto_logout_enabled is '自動ログアウト 有効/無効（共有端末対応）。NULL=未設定→既定 有効';
comment on column public.offices.auto_logout_minutes is '自動ログアウトのタイムアウト（分）。NULL=未設定→既定 30';
comment on column public.offices.printer_model       is '印刷エージェント機種。NULL=未設定→既定 Brother TD-2350';


-- =============================================================
-- §2. 新規営業所の既定値だけ 50 にする（既存行は変更しない）
--   ※ ALTER COLUMN SET DEFAULT は「今後の INSERT」にのみ効く。UPDATE も再書き込みも起きない。
-- =============================================================
alter table public.offices alter column basket_cart_limit set default 50;


-- =============================================================
-- §3. 値の妥当性を DB 側で担保（冪等に追加）
--   ・かご振り順は3択（§12.12）
--   ・かご台車上限は 1..500（採番の clamp `greatest(1, least(500, …))` と整合）
--   ・自動ログアウトは 1..600 分
--   ・印刷機種は既知の機種のみ（機種抽象化・§15.3）
-- =============================================================
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'offices_basket_order_chk') then
    alter table public.offices add constraint offices_basket_order_chk
      check (basket_order in ('ドライバー順', '配達順順', 'ゾーン順'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'offices_basket_cart_limit_chk') then
    alter table public.offices add constraint offices_basket_cart_limit_chk
      check (basket_cart_limit is null or (basket_cart_limit between 1 and 500));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'offices_auto_logout_minutes_chk') then
    alter table public.offices add constraint offices_auto_logout_minutes_chk
      check (auto_logout_minutes is null or (auto_logout_minutes between 1 and 600));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'offices_printer_model_chk') then
    alter table public.offices add constraint offices_printer_model_chk
      check (printer_model is null or printer_model in ('Brother TD-2350', '汎用サーマル'));
  end if;
end $$;


-- =============================================================
-- §4. 保存口（SECURITY DEFINER。編集は hq のみ・営業所別）
--   ・offices に write policy は作らない（本基盤の規約：書込は DEFINER 関数のみ）。
--   ・画面は4項目すべてを毎回送る前提。NULL は「未設定に戻す」を意味する
--     （ただし basket_order は NOT NULL のため、NULL のときは現在値を維持）。
-- =============================================================
create or replace function public.update_office_settings(
  p_office_code         text,
  p_basket_cart_limit   integer,
  p_basket_order        text,
  p_auto_logout_enabled boolean,
  p_auto_logout_minutes integer,
  p_printer_model       text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- 権限：管理者/HQ のみ編集可（§12.13）
  if public.my_role() is distinct from 'hq' then
    raise exception '管理者設定を変更する権限がありません (role=%)', coalesce(public.my_role(), '(未設定)')
      using errcode = '42501';
  end if;

  if not exists (select 1 from public.offices o where o.office_code = p_office_code) then
    raise exception '営業所が存在しません: %', p_office_code using errcode = 'P0002';
  end if;

  -- 値の検証（CHECK制約と二重だが、画面に分かりやすいエラーを返すため）
  if p_basket_order is not null and p_basket_order not in ('ドライバー順', '配達順順', 'ゾーン順') then
    raise exception 'かご振り順が不正です: %', p_basket_order using errcode = '22023';
  end if;
  if p_basket_cart_limit is not null and (p_basket_cart_limit < 1 or p_basket_cart_limit > 500) then
    raise exception 'かご台車上限は 1〜500 で指定してください: %', p_basket_cart_limit using errcode = '22023';
  end if;
  if p_auto_logout_minutes is not null and (p_auto_logout_minutes < 1 or p_auto_logout_minutes > 600) then
    raise exception '自動ログアウトの分は 1〜600 で指定してください: %', p_auto_logout_minutes using errcode = '22023';
  end if;
  if p_printer_model is not null and p_printer_model not in ('Brother TD-2350', '汎用サーマル') then
    raise exception '印刷機種が不正です: %', p_printer_model using errcode = '22023';
  end if;

  update public.offices set
    basket_cart_limit   = p_basket_cart_limit,                      -- NULL=未設定（採番は50を適用）
    basket_order        = coalesce(p_basket_order, basket_order),   -- NOT NULL 列のため現在値を維持
    auto_logout_enabled = p_auto_logout_enabled,
    auto_logout_minutes = p_auto_logout_minutes,
    printer_model       = p_printer_model
  where office_code = p_office_code;
end $$;

comment on function public.update_office_settings(text, integer, text, boolean, integer, text) is
  '管理者設定の保存（§12.13）。hq のみ。offices を直接更新（write policy を作らない規約に従い SECURITY DEFINER）';

revoke execute on function public.update_office_settings(text, integer, text, boolean, integer, text) from public;
grant  execute on function public.update_office_settings(text, integer, text, boolean, integer, text) to authenticated;


-- =============================================================
-- §消費側の既定（本書は器のみ。読む側は各機能）
--   basket_cart_limit   NULL → 採番一式v0.5 が coalesce(...,50) で 50 を適用（実装済み）
--   basket_order        NOT NULL（既定 'ドライバー順'）→ 採番一式v0.5 が参照（実装済み）
--   auto_logout_enabled NULL → 認証(§12.1) が既定 true を適用（消費側は別書・未実装）
--   auto_logout_minutes NULL → 認証(§12.1) が既定 30 を適用（消費側は別書・未実装）
--   printer_model       NULL → 印刷ブリッジ(§15.3) が既定 'Brother TD-2350' を適用（消費側は別書・未実装）
-- =============================================================


-- =============================================================
-- §5. 確認（postgres 実行＝RLSバイパス。hq限定の証明は check_office_settings_v0.sql で）
-- =============================================================
select office_code, office_name,
       basket_cart_limit, basket_order,
       auto_logout_enabled, auto_logout_minutes, printer_model
from public.offices
order by office_code;
-- 期待: 既存の basket_cart_limit が保持されている（IT01=50 / A01=10 / C01=10）。
--       新設3列はすべて NULL（未設定）。

select column_name, column_default, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'offices'
  and column_name in ('basket_cart_limit','auto_logout_enabled','auto_logout_minutes','printer_model')
order by column_name;
-- 期待: basket_cart_limit の column_default = 50（新規営業所のみに効く）／新設3列は default なし・nullable
