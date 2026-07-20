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
--
--   ⚠⚠ 実行方法（ここを間違えると何も起きない／実証にならない）
--     ・**`begin;` から `rollback;` まで丸ごと**選択して 1回で Run すること。
--       部分実行すると set local が効かず postgres のまま走る（＝RLSバイパスで実証にならない）。
--       ※ verify_rls_scope_v0.sql と同じ注意点。
--     ・下の3行のコメント（`--`）は**外してある**。そのまま実行できる。
--     ・**UIDの手動置換は不要**。set_config() で area ユーザーを自動で拾う
--       （`set local` は値に式を書けないが、set_config(..., true) は等価で式を書ける）。
--
--   判定は結果の「なりすまし確認」行で行う。role=area / office=<営業所コード> が出れば効いている。
--   `(null)` なら効いていない（部分実行 or area ユーザーが未登録）。
-- =============================================================
begin;

-- ① postgres のうちに area ユーザーを1人拾って JWT クレームへ入れる（手動置換の代わり）
select set_config(
         'request.jwt.claims',
         json_build_object(
           'role', 'authenticated',
           'sub',  (select p.user_id::text from public.profiles p
                     where p.role = 'area' and p.office_code is not null
                     order by p.office_code limit 1)
         )::text,
         true) as _claims;

-- ② 非特権ロールへ降格（以降 my_role()/my_office() が area を返す）
select set_config('role', 'authenticated', true) as _role;

-- ③ なりすまし確認（★ここが (null) なら以降の結果は無意味）
select public.my_role() as role, public.my_office() as office;

-- ④ 自営業所・初回（gdrive_folder_url が NULL）なら保存できる
--    ※ 対象営業所が既に「完了」だと、ここが権限エラーになる（それも正しい挙動）。
--      初回の挙動を見たい場合は、事前に対象営業所を NULL に戻しておく。
select public.save_office_init_setup(
         public.my_office(), 'https://drive.google.com/drive/folders/TEST', 'Brother TD-2350') as _saved;

-- ⑤ 2回目（もう完了している）は拒否される＝area は恒久的な編集権を持たない
--    ★ここでエラーになるのが正解。エラーが出た時点でトランザクションは中断され、
--      下の rollback で DB は元に戻る（＝ ④ の書き込みも取り消される）。
select public.save_office_init_setup(
         public.my_office(), 'https://drive.google.com/drive/folders/AGAIN', '汎用サーマル') as _should_fail;

rollback;
-- 期待:
--   ③ role=area / office=<営業所コード>（(null) なら部分実行を疑う）
--   ④ 成功（初回設定として保存できる）
--   ⑤ 「初期設定を保存する権限がありません…管理者設定（§12.13）から hq が」でエラー
--   → rollback するので DB には一切残らない。
--
-- ※ Supabase SQL Editor は最後の結果しか表示しないため、③④⑤ を個別に見たい場合は
--   ⑤ を一時的に外して（begin〜④＋rollback で）実行し、次に⑤込みで実行するとよい。


-- 【実機確認（【人】）】
--   1. gdrive_folder_url = NULL の営業所の area ユーザーでログイン → /home が /setup へ自動遷移する
--   2. 2項目を入力して保存 → /home に戻り、offices.gdrive_folder_url が入る
--   3. 再ログイン（または /home 再訪）→ /setup に飛ばされない
--   4. 管理者設定（/admin/settings・hq）から printer_model を再編集できる
