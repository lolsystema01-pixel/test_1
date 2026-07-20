-- =============================================================
-- 初期設定（§12.14）v0.2 — 確認SQL
--   合格条件（列追加・NULLゲートで初回表示・保存後非表示・権限）を1画面で確認する。
-- 性質: §1〜§3 は SELECT のみ。§4 は権限の実証（なりすまし・rollback で元に戻す）。
-- 実行: Supabase SQL Editor（postgres）。§4 は【begin; 〜 rollback; を丸ごと】実行すること。
-- =============================================================


-- =============================================================
-- §1. 列と制約（合格条件: gdrive_folder_url が null許容で追加／setup_completed は作らない）
-- =============================================================
select
  (select count(*) from information_schema.columns
    where table_schema='public' and table_name='offices' and column_name='gdrive_folder_url')::int as gdrive_列あり,
  (select is_nullable from information_schema.columns
    where table_schema='public' and table_name='offices' and column_name='gdrive_folder_url')       as nullable,
  (select count(*) from information_schema.columns
    where table_schema='public' and table_name='offices' and column_name='printer_model')::int      as printer_列あり,
  (select count(*) from information_schema.columns
    where table_schema='public' and table_name='offices'
      and column_name in ('setup_completed','is_setup_completed'))::int                             as 専用フラグ列,
  (select count(*) from pg_policies where schemaname='public' and tablename='offices'
      and cmd in ('INSERT','UPDATE','DELETE','ALL'))::int                                           as offices書込ポリシー;
-- 期待: gdrive_列あり=1 / nullable=YES / printer_列あり=1 / 専用フラグ列=0 / offices書込ポリシー=0


-- =============================================================
-- §2. 初回ゲートの判定（合格条件: NULL の営業所で初回表示・入力後は出ない）
-- =============================================================
select office_code, office_name, printer_model,
       gdrive_folder_url,
       case when gdrive_folder_url is null then '未完（初期設定画面を表示）'
            else '完了（表示しない）' end as 初回ゲート
from public.offices
order by office_code;
-- 期待: gdrive_folder_url が NULL の営業所だけが「未完」。


-- =============================================================
-- §3. 保存口の存在と実行権限
-- =============================================================
select p.proname,
       case when p.prosecdef then 'SECURITY DEFINER' else '(invoker)' end as definer,
       has_function_privilege('authenticated', p.oid, 'execute')          as authenticated実行可,
       has_function_privilege('anon',          p.oid, 'execute')          as anon実行可
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname='public' and p.proname = 'save_office_init_setup';
-- 期待: SECURITY DEFINER / authenticated実行可=true / anon実行可=false


-- =============================================================
-- §4. 権限の実証（なりすまし・rollback で元に戻す）
--   ⚠ 【begin; から rollback; まで丸ごと】選択して実行すること。
--     部分実行すると set local が効かず postgres のまま走る（＝実証にならない）。
--     ※ verify_rls_scope_v0.sql と同じ注意点。
--   ※ <AREA_UID> は area ロールの profiles.user_id に置き換える。
-- =============================================================
-- begin;
-- set local role authenticated;
-- set local request.jwt.claims = '{"sub":"<AREA_UID>"}';
--
-- select public.my_role() as role, public.my_office() as office;   -- なりすまし確認（area / 自営業所）
--
-- -- ① 自営業所・初回（gdrive_folder_url が NULL）なら保存できる
-- select public.save_office_init_setup(public.my_office(),
--          'https://drive.google.com/drive/folders/TEST', 'Brother TD-2350');
--
-- -- ② 2回目（既に完了）は拒否される＝area は恒久的な編集権を持たない
-- select public.save_office_init_setup(public.my_office(),
--          'https://drive.google.com/drive/folders/AGAIN', '汎用サーマル');   -- ← エラーになるのが正しい
--
-- rollback;
-- 期待: ① 成功 ／ ② 「初期設定を保存する権限がありません…管理者設定（§12.13）から hq が」で拒否。
--       rollback するので DB は元に戻る。


-- 【実機確認（【人】）】
--   1. gdrive_folder_url = NULL の営業所の area ユーザーでログイン → /home が /setup へ自動遷移する
--   2. 2項目を入力して保存 → /home に戻り、offices.gdrive_folder_url が入る
--   3. 再ログイン（または /home 再訪）→ /setup に飛ばされない
--   4. 管理者設定（/admin/settings・hq）から printer_model を再編集できる
