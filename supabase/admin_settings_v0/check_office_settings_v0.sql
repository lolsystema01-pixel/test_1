-- =============================================================
-- 指示書: 管理者設定 v0.1 — 手順 3/3：確認
-- 実行: Supabase SQL Editor。office_settings_admin_v0.sql の後。
--   ※ ①〜④は postgres（RLSバイパス）で実行してよい。
--   ※ ⑤の「hqのみ編集可」は なりすまし（set local role authenticated）で実際にRLS/権限を効かせる。
--     ★ ⑤は `begin;` 〜 `rollback;` を**丸ごと**実行すること（set local は同一トランザクション内のみ有効）。
-- =============================================================


-- =============================================================
-- ① 4項目が保存されているか（営業所別）
-- =============================================================
select office_code, office_name,
       basket_cart_limit                                  as "かご台車上限",
       basket_order                                       as "かご振り順(DB値)",
       case basket_order
         when 'ドライバー順' then '担当件数の多い順'
         when '配達順順'     then '配達順に従う'
         when 'ゾーン順'     then 'ゾーン順に従う'
       end                                                as "かご振り順(画面ラベル)",
       auto_logout_enabled                                as "自動ログアウト",
       auto_logout_minutes                                as "分",
       printer_model                                      as "印刷機種"
from public.offices
order by office_code;
-- 期待: 既存の basket_cart_limit が保持（IT01=50 / A01=10 / C01=10）。
--       未設定の項目は NULL（＝消費側が既定を適用）。


-- =============================================================
-- ② 列の定義（新規営業所のみ既定50・新設3列は default なし）
-- =============================================================
select column_name, data_type, column_default, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'offices'
  and column_name in ('basket_cart_limit','basket_order','auto_logout_enabled','auto_logout_minutes','printer_model')
order by column_name;
-- 期待: basket_cart_limit … column_default = 50 / nullable
--       basket_order      … NOT NULL・default 'ドライバー順'
--       新設3列           … column_default が空・nullable


-- =============================================================
-- ③ CHECK 制約が入っているか（かご振り順の3択など）
-- =============================================================
select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.offices'::regclass and contype = 'c'
order by conname;
-- 期待: offices_basket_order_chk（3択）／offices_basket_cart_limit_chk（1..500）／
--       offices_auto_logout_minutes_chk（1..600）／offices_printer_model_chk（既知機種のみ）


-- =============================================================
-- ④ 書込は DEFINER 関数のみ（offices に write policy が無いこと）
-- =============================================================
select count(*) filter (where cmd <> 'SELECT') as write_policies,
       case when count(*) filter (where cmd <> 'SELECT') = 0 then 'OK' else 'NG' end as judge
from pg_policies
where schemaname = 'public' and tablename = 'offices';
-- 期待: write_policies = 0 / judge = OK

select proname, prosecdef as is_security_definer
from pg_proc where proname = 'update_office_settings';
-- 期待: is_security_definer = true


-- =============================================================
-- ⑤ hq のみ編集可（なりすましで実証）
--   ★ '<HQ_UID>' / '<AREA_UID>' を profiles の user_id に置換し、
--     begin; 〜 rollback; を丸ごと実行すること。
--   ※ rollback するので DB には残らない。
-- =============================================================

-- 5-1) area は編集できない（権限エラーになれば OK）
begin;
set local request.jwt.claims = '{"role":"authenticated","sub":"<AREA_UID>"}';
set local role authenticated;
select public.my_role() as role;  -- 期待: area（(null) ならなりすまし未適用＝部分実行）
select public.update_office_settings('IT01', 40, 'ゾーン順', true, 30, 'Brother TD-2350');
-- 期待: ERROR: 管理者設定を変更する権限がありません (role=area)
rollback;

-- 5-2) hq は編集できる（成功すれば OK。rollback で戻す）
begin;
set local request.jwt.claims = '{"role":"authenticated","sub":"<HQ_UID>"}';
set local role authenticated;
select public.my_role() as role;  -- 期待: hq
select public.update_office_settings('IT01', 40, 'ゾーン順', true, 30, 'Brother TD-2350');
select office_code, basket_cart_limit, basket_order, auto_logout_enabled, auto_logout_minutes, printer_model
from public.offices where office_code = 'IT01';
-- 期待: 40 / ゾーン順 / true / 30 / Brother TD-2350
rollback;

-- 5-3) 不正値は関数側で弾かれる
begin;
set local request.jwt.claims = '{"role":"authenticated","sub":"<HQ_UID>"}';
set local role authenticated;
select public.update_office_settings('IT01', 600, 'ドライバー順', null, null, null);
-- 期待: ERROR: かご台車上限は 1〜500 で指定してください: 600
rollback;


-- =============================================================
-- ⑥ 消費側の結線（本書は器のみ。読む側の実装は各機能）
-- =============================================================
-- 採番一式v0.5 が実際に使う値（NULL は 50 に解決される）
select office_code,
       basket_cart_limit                                        as "設定値(NULL=未設定)",
       greatest(1, least(500, coalesce(basket_cart_limit, 50))) as "採番が使う1かご個数",
       basket_order                                             as "採番が使うかご振り順"
from public.offices
order by office_code;
-- 期待: renumber_build の `greatest(1, least(500, coalesce(o.basket_cart_limit, 50)))` と一致

-- 認証(§12.1)・印刷(§15.3) は未実装。読むときの既定は次のとおり（本SQLは値の確認のみ）
select office_code,
       coalesce(auto_logout_enabled, true) as "自動ログアウト(既定true)",
       coalesce(auto_logout_minutes, 30)   as "分(既定30)",
       coalesce(printer_model, 'Brother TD-2350') as "印刷機種(既定TD-2350)"
from public.offices
order by office_code;
