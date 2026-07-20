-- =============================================================
-- セキュリティ修正: pipeline_demo_v0 の demo_* 関数を全面停止（実行権の剥奪）
--
-- 【背景】独立した2回のセキュリティ監査が Critical 判定。
--   demo_functions_v0.sql の8関数が SECURITY DEFINER（RLSバイパス）かつ
--   `grant execute … to anon`（同ファイル153行目）になっていた。
--   anonキーは全クライアント同梱＝実質公開のため、未認証で
--     ・demo_reset … 任意日付の deliveries 初期化＋dispatch_*/renumber_plan/delivery_status_log を DELETE
--       （営業所スコープ判定なし＝全営業所を巻き込む）
--     ・demo_summary / demo_delivery_order / demo_drivers … 全営業所の住所・driver を無認証で読取（PII漏洩）
--   が可能だった。実DBで anon 実行可を確認済み（2026-07-17・8関数とも true）。
--
-- 【本ファイルの対応】デモは今後実施しないため、**全ロールから実行権を剥奪**して完全停止する。
--   ・owner/postgres 以外は一切呼べなくなる（anon・authenticated・public とも不可）。
--   ・関数の本体は残す（将来 area スコープ版〔案B〕を作る際の参照）。
--   ・恒久化：demo_functions_v0.sql の grant を RETIRED 表明済み（再実行しても anon は付かない）。
--
-- 性質: 権限操作のみ（DROP/DML/DDL なし）。冪等。
-- 実行: Supabase SQL Editor（postgres）で丸ごと Run。
-- =============================================================


-- =============================================================
-- §1. 全ロールから実行権を剥奪
-- =============================================================
revoke execute on function
  public.demo_dispatch_preview(date),
  public.demo_renumber_preview(date),
  public.demo_dispatch(date),
  public.demo_renumber(date),
  public.demo_reset(date),
  public.demo_summary(date),
  public.demo_delivery_order(date, text, int),
  public.demo_drivers(date)
from anon, authenticated, public;


-- =============================================================
-- §2. 検証: anon も authenticated も、どの demo_* も実行できないこと（0件が合格）
-- =============================================================
select
  count(*)                                                                as demo_functions,
  count(*) filter (where has_function_privilege('anon', p.oid, 'execute'))          as anon_can_exec,
  count(*) filter (where has_function_privilege('authenticated', p.oid, 'execute')) as authenticated_can_exec
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like 'demo\_%';
-- 期待: demo_functions = 8 ／ anon_can_exec = 0 ／ authenticated_can_exec = 0
--   ＝ 8関数は存在するが、誰も呼べない（完全停止）。

-- 【この後】
--   ・フロント `/demo`（apps/sort_nav_v0/src/routes/demo/）は権限エラーで動かなくなる。
--     デモ不要のため許容（リンクは home/+page.svelte:221・sort/+page.svelte:206。除去は任意）。
--   ・将来「配車・採番の画面」が必要になったら、案B（area 専用・関数内 my_office() スコープ認可・
--     読取は security_invoker ビュー＋area RLS）で proper なモジュールとして作り直す。
--     ＝ record_status_transition / office_home_summary と同じ規約に合わせる。
-- =============================================================
