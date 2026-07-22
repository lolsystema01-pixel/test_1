-- =============================================================
-- 指示書: エリアマスタ／共通ID語彙の是正 → address_master 撤去 v0.1
--   ③ deliveries の旧語彙 804行を解消（旧DSPダミーの削除）
--
-- 目的: audit §2 の old_vocab_only を 0 にする。
--       ＝④で3関数を area_master 参照へ書き換えたとき、
--         旧語彙の行が「エラー無しで市名NULL・同一市判定不成立」を起こさないようにする。
--
-- 対象: delivery_date in (2026-06-16, 2026-06-17) かつ common_id が area_master(有効) に無い行。
--       2026-07-17 実測 804行（06-16=4行 / 06-17=800行）。
--
-- 性質: DELETE を含む（破壊的）。冪等（対象が無ければ0件削除）。
-- 実行: Supabase SQL Editor（postgres）で本ファイルを丸ごと Run。
--
-- 【固定の前提】新基盤(Supabase+SvelteKit+Cloud Run)・検証環境のみ・本番/現行GASは触らない・
--   全テーブルRLS・秘密情報は環境変数・SQLは人手でコピペ実行（渡す前に pglite で E2E 検証）。
--
-- 【⚠ 指示書からの訂正（重要）】
--   指示書は「delivery_status_log（cascade無し）→ deliveries
--             （delivery_index は on delete cascade で自動削除）」としているが、
--   **delivery_index に on delete cascade は付いていない**。
--     dbschema_v0/create_schema_v0.sql:100-102
--       create table public.delivery_index (
--         tracking_number text primary key
--                         references public.deliveries(tracking_number),   ← cascade 無し
--   → そのまま deliveries を削除すると FK違反で落ちる。
--     しかも 06-17 の800行は seq_kago_index_v0 の実機800件が delivery_index に入っており、必ず踏む。
--   → 本ファイルでは delivery_index も明示的に削除する（§2-2）。
--
--   deliveries を参照する FK の全数調査（2026-07-17）:
--     ・delivery_status_log.tracking_number  … cascade 無し → 明示削除が必要（§2-1）
--     ・delivery_index.tracking_number       … cascade 無し → 明示削除が必要（§2-2）★指示書の記述と異なる
--     ・unregistered_addresses.tracking_number … on delete cascade → 自動削除
--         （address_match_v0/normalize_v0.sql:32 と unregistered_address_v0/unregistered_v0.sql:21 が
--           同じ表を定義。どちらも cascade 付き）
--     ・delivery_index を参照する表は無い（連鎖なし）
--     ・print_history.tracking_number は FK ではない（ただの text）＝削除の影響を受けない
--
-- 【この削除で失われるもの（承知のうえで実行する）】
--   06-17 の800行は dispatch_v0 / seq_kago_index_v0 / dispatch_sheet_v0 の
--   検証ベースライン（800件）そのもの。削除後は各モジュールの確認結果メモに記録された
--   件数を再現できなくなる（過去の検証記録として残るのみ。実害なしと判断・業務A確認済み 2026-07-17）。
--   06-16 の4行は common_id が C0001/C0002 ＝ 正準規格v1 で廃止された規格の残骸で、
--   これを作る seed はリポジトリに存在しない（＝再seedで蘇らない・調査済み）。
-- =============================================================


-- =============================================================
-- §0. 削除前の確認（何を消すのか・記録用）
--   ※ ここだけ先に単独で Run して、件数が想定（804行）と合うことを確認してから先へ進むとよい。
-- =============================================================
select 'before' as phase,
       count(*)                                                        as target_rows,
       count(*) filter (where d.delivery_date = date '2026-06-16')     as d0616,
       count(*) filter (where d.delivery_date = date '2026-06-17')     as d0617,
       count(distinct d.common_id)                                     as distinct_common_ids,
       string_agg(distinct d.common_id, ' / ' order by d.common_id)    as common_ids
from public.deliveries d
where d.delivery_date in (date '2026-06-16', date '2026-06-17')
  and d.common_id is not null
  and not exists (select 1 from public.area_master am
                   where am.common_id = d.common_id and am.is_valid);


-- =============================================================
-- §1. 安全ガード: 対象が「旧語彙かつ指定日」だけであることを機械で確かめる
--   実データ（07-04 / 07-10 等）を巻き込まないことを、削除の前に自分で証明する。
-- =============================================================
do $$
declare v_out_of_scope int;
begin
  -- 指定日の外に、旧語彙（area_master に無い）の行が居ないか
  select count(*) into v_out_of_scope
  from public.deliveries d
  where d.common_id is not null
    and d.delivery_date not in (date '2026-06-16', date '2026-06-17')
    and not exists (select 1 from public.area_master am
                     where am.common_id = d.common_id and am.is_valid);

  if v_out_of_scope > 0 then
    raise exception
      '中断: 指定日(06-16/06-17)の外に旧語彙の行が % 件あります。'
      '削除条件（日付）だけでは old_vocab_only=0 になりません。'
      'diagnose_unresolved_deliveries_v0.sql と audit §2-2 で内訳を確認してください。', v_out_of_scope;
  end if;
end $$;


-- =============================================================
-- §2. FK順に削除（子 → 親）
-- =============================================================

-- §2-1. delivery_status_log（cascade 無し）------------------------------
delete from public.delivery_status_log l
where exists (
  select 1 from public.deliveries d
  where d.tracking_number = l.tracking_number
    and d.delivery_date in (date '2026-06-16', date '2026-06-17')
    and d.common_id is not null
    and not exists (select 1 from public.area_master am
                     where am.common_id = d.common_id and am.is_valid)
);

-- §2-2. delivery_index（cascade 無し）★指示書は「cascadeで自動」としているが実際は無い ----
delete from public.delivery_index i
where exists (
  select 1 from public.deliveries d
  where d.tracking_number = i.tracking_number
    and d.delivery_date in (date '2026-06-16', date '2026-06-17')
    and d.common_id is not null
    and not exists (select 1 from public.area_master am
                     where am.common_id = d.common_id and am.is_valid)
);

-- §2-3. deliveries（親）--------------------------------------------------
--   unregistered_addresses は on delete cascade で自動削除される。
delete from public.deliveries d
where d.delivery_date in (date '2026-06-16', date '2026-06-17')
  and d.common_id is not null
  and not exists (select 1 from public.area_master am
                   where am.common_id = d.common_id and am.is_valid);


-- =============================================================
-- §3. 検証（指示書③の合格条件）
--   合格条件: audit §2 の old_vocab_only = 0
-- =============================================================
select
  'after' as phase,
  -- ★合格条件: 0 であること（audit §2 と同じ式）
  (select count(*) from public.deliveries d
    where d.common_id is not null
      and not exists (select 1 from public.area_master am
                       where am.common_id = d.common_id and am.is_valid))   as old_vocab_only,
  -- ②の合格条件もここで満たされる（4行の孤児が消えるため）
  (select count(*) from public.deliveries d
    where d.common_id is not null
      and not exists (select 1 from public.zone_plan zp
                       where zp.common_id = d.common_id))                   as deliveries_unresolved,
  -- 対象日の残り（0 が合格）
  (select count(*) from public.deliveries
    where delivery_date in (date '2026-06-16', date '2026-06-17'))          as rows_on_target_dates,
  -- 子テーブルに孤児が残っていないこと（0 が合格）
  (select count(*) from public.delivery_index i
    where not exists (select 1 from public.deliveries d
                       where d.tracking_number = i.tracking_number))        as orphan_index,
  (select count(*) from public.delivery_status_log l
    where not exists (select 1 from public.deliveries d
                       where d.tracking_number = l.tracking_number))        as orphan_status_log,
  -- 実データが巻き込まれていないこと（>0 であること）
  (select count(*) from public.deliveries
    where delivery_date not in (date '2026-06-16', date '2026-06-17'))      as rows_kept;

-- 【読み方】
--   ・old_vocab_only        = 0 … ★指示書③の合格条件。
--   ・deliveries_unresolved = 0 … ②の合格条件もここで満たされる
--       （②実行時に4行残っていたのは C0001/C0002 の孤児。③で消えるため 0 になる）。
--   ・rows_on_target_dates … 0 とは限らない（2026-07-17 実測: 4行残った）。
--       対象日には計808行あり、うち804行が旧語彙＝削除対象。
--       残る4行は common_id が NULL か有効な新語彙を持つため、削除条件に入らない＝残るのが正しい。
--       合格条件は old_vocab_only = 0 であって「対象日が空になること」ではない。
--   ・orphan_index / orphan_status_log = 0 … 子テーブルに孤児が残っていない。
--   ・rows_kept > 0 … 実データ（07-04/07-10 等）を巻き込んでいない。
--   ・冪等: 再実行しても対象0件で、件数は変わらない。
--
-- 【次のステップ】
--   recheck_vocab_gates_v0.sql を再実行し、seq 6（§2 旧語彙残置）が
--   804 → 0 に変わることを確認してから ④ へ進む。
