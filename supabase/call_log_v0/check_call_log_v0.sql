-- =============================================================
-- 通話・対応ログ v0 確認SQL
-- 実行: call_log_v0.sql → seed_call_log_v0.sql の後。各ブロックを個別に実行（Ctrl+Enter）。
-- ★ なりすましブロックは begin … rollback で包み、request.jwt.claims はブロック内だけ有効（本番値を残さない）。
--   sub のUUIDは rls_v0/seed_accounts_v0.sql のロール別ダミーアカウントと同じ値。
--   （hq=…0001／depot(D01)=…0002／area A01=…00a1／driver DRV001=…00d1／shipper SHIP01=…00f1）
-- =============================================================

-- ⓪ 全体件数・outcome分布 -------------------------------------------------
select count(*) as 総件数 from public.call_logs;
select outcome, count(*) from public.call_logs group by outcome order by outcome;
-- 期待（seed直後）: 総件数7・AI完結2/折り返し要2/転送済1/いたずら1/中断1


-- ① 冪等：call_sidの重複はduplicateで行が増えない ---------------------------
select public.record_call_log(p_call_sid := 'CALL-SEED-0001') as 再実行結果;
-- 期待: {"result":"duplicate","call_id":<既存id>,"call_sid":"CALL-SEED-0001","callback_status":"不要"}
select count(*) as 総件数_再確認 from public.call_logs;
-- 期待: ⓪と同じ件数のまま（増えない）


-- ② callback_queue：優先度→古い順で並ぶ -------------------------------------
--    列は正本準拠（受信時刻=created_at・発信者番号・番号帯・用件=intent・要約=summary・優先度）。
select call_sid, created_at, caller_phone, band_key, intent, summary, priority
from public.callback_queue
order by priority desc, created_at asc;
-- 期待: CALL-SEED-0004（クレーム・priority=9）が先頭、CALL-SEED-0003（priority=0）が2番目。
--        callback_status='不要'（AI完結2/転送済1/いたずら1/中断1）の5件はqueueに出ない。


-- ③ resolve_callback：担当・時刻・メモが記録されqueueから消える -------------
--    ★状態を汚さないため begin … rollback で包む（本番値を残さない）。
begin;
  set local request.jwt.claims = '{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000000a1"}'; -- area A01
  set local role authenticated;

  create temporary table _target on commit drop as
    select id from public.call_logs where call_sid = 'CALL-SEED-0003';

  select public.resolve_callback((select id from _target), '担当者から折り返し完了・条件確認済み') as 解決結果;
  -- 期待: {"result":"resolved","call_id":<id>,"callback_by":"00000000-0000-0000-0000-0000000000a1"}

  select callback_status, callback_by, callback_at, callback_note
    from public.call_logs where call_sid = 'CALL-SEED-0003';
  -- 期待: callback_status='完了'・callback_by=上記sub・callback_at NOT NULL・callback_note=上記文言

  select call_sid from public.callback_queue where call_sid = 'CALL-SEED-0003';
  -- 期待: 0行（queueから消える）

  select public.resolve_callback((select id from _target), '再解決テスト') as 再解決結果;
  -- 期待: {"result":"already", ...}（冪等・callback_noteは上書きされない）
rollback;  -- ★デモの解決は戻す（後続の④の件数に影響しないように）


-- ④ RLSなりすまし：5ロール可視件数（judge列で自動判定） ---------------------
--    call_logs（hq/depot/area=全件可視・driver/shipperは0件）。1ブロック1SELECT・個別実行。
--    sub一覧: hq=…0001／depot(D01)=…0002／area(A01)=…00a1／driver(DRV001)=…00d1／shipper(SHIP01)=…00f1

-- who=hq --------------------------------------------------------------
begin;
  set local request.jwt.claims = '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000001"}';
  set local role authenticated;
  select 'hq' as who, count(*) as 見える件数,
    case when count(*) = (select count(*) from public.call_logs) and count(*) > 0 then 'OK（全件可視）' else 'NG' end as judge
  from public.call_logs;
rollback;

-- who=depot -------------------------------------------------------------
begin;
  set local request.jwt.claims = '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000002"}';
  set local role authenticated;
  select 'depot' as who, count(*) as 見える件数,
    case when count(*) = (select count(*) from public.call_logs) and count(*) > 0 then 'OK（全件可視）' else 'NG' end as judge
  from public.call_logs;
rollback;

-- who=area(A01) -----------------------------------------------------------
begin;
  set local request.jwt.claims = '{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000000a1"}';
  set local role authenticated;
  select 'area' as who, count(*) as 見える件数,
    case when count(*) = (select count(*) from public.call_logs) and count(*) > 0 then 'OK（全件可視）' else 'NG' end as judge
  from public.call_logs;
rollback;

-- ★who=driver(DRV001)：範囲外0件を実証 -------------------------------------
begin;
  set local request.jwt.claims = '{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000000d1"}';
  set local role authenticated;
  select 'driver' as who, count(*) as 見える件数,
    case when count(*) = 0 then 'OK（範囲外0件）' else 'NG' end as judge
  from public.call_logs;
rollback;

-- ★who=shipper(SHIP01)：範囲外0件を実証 -------------------------------------
begin;
  set local request.jwt.claims = '{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000000f1"}';
  set local role authenticated;
  select 'shipper' as who, count(*) as 見える件数,
    case when count(*) = 0 then 'OK（範囲外0件）' else 'NG' end as judge
  from public.call_logs;
rollback;

-- ★who=anon：SELECT自体が権限エラーになることを確認（GRANTなし） -----------
--    ※ エラーになれば合格（judge列は出せない。「permission denied for table call_logs」を確認）。
begin;
  set local role anon;
  select count(*) from public.call_logs;
rollback;


-- =============================================================
-- 合格条件との対応（指示書❷）
--   1. call_sidの再送で二重記録されない（冪等）                         … ①
--   2. outcome='折り返し要' が callback_queue に優先度→古い順で並ぶ      … ②
--   3. resolve_callback で担当・時刻・メモが記録・queueから消える・anon不可 … ③
--   4. RLS：hq/depot/areaは可視、driver/shipperは0件（数値で実証）        … ④
--   5. pglite E2E 全PASS・check/seedがSQL Editorコピペで動く              … pglite_test.mjs
--   6. PII（caller_phone/transcript/recording_url）はCOMMENTで明示        … call_log_v0.sql
-- =============================================================
