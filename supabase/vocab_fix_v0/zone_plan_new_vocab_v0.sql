-- =============================================================
-- 指示書: エリアマスタ／共通ID語彙の是正 → address_master 撤去 v0.1
--   ② zone_plan に新語彙を追加（追加のみ・旧行は残す）
--
-- 目的: area_master（有効行）の common_id を zone_plan に登録し、
--       deliveries.common_id（非NULL）が全て zone_plan.common_id に存在する状態にする。
--
-- 性質: INSERT のみ（UPDATE / DELETE はしない）。冪等（何度実行してもよい）。
-- 実行: Supabase SQL Editor（postgres）で本ファイルを丸ごと Run。
--       ※ §2 と §3 は結果表示のため、最後の SELECT だけが結果ペインに出る。
--          件数を1つずつ見たい場合はブロック単位で Run すること。
--
-- 【固定の前提】新基盤(Supabase+SvelteKit+Cloud Run)・検証環境のみ・本番/現行GASは触らない・
--   全テーブルRLS・秘密情報は環境変数・SQLは人手でコピペ実行（渡す前に pglite で E2E 検証）。
--
-- 【指示書からの反映（実装メモ 2026-07-17）】
--   指示書の「distinct common_id, zone_no, depot を導出して upsert」は、そのままでは落ちる。
--   同じ common_id が複数 zone_no を持つため（1,015件／全1,653共通ID中・実測）、
--   ON CONFLICT (common_id) DO UPDATE が同一行を2回触り
--   「command cannot affect row a second time」でエラーになる。
--   → common_id ごとに min(zone_no) で畳んで決定化する。
--
--   代表 zone_no を min にする理由: 旧実装の慣習に合わせる。
--     master_zoneplan_v0/load_master_v0.sql:55
--       z.zone_from as zone_no  -- 単一ゾーン番号＝From（範囲は配車側へ）
--     ＝旧 zone_plan は範囲の先頭(From)を代表値に採っていた。min はこれと一致する。
--   ※ zone_plan.zone_no は現状どこからも読まれない
--     （zone_rank は adjacent_zones のみ／dispatch_build は split_threshold のみ／
--       配達順が使うのは deliveries.zone_no という別列）。実害は無いが決定化は必要。
--
--   列と型の対応（取り違えやすい）:
--     area_master.is_valid  = boolean          ← 'PLAIN有効' は area_master_staging 側（text）の値
--     area_master.zone_no   = integer          → zone_plan.zone_no   = text   ＝キャスト必須
--     area_master.depot     = text             → zone_plan.depot_code = text  ＝列名が違う
--
-- 【決定事項（親指示書 C.）】
--   ・adjacent_zones は新語彙分を NULL のままとする
--     （新エリアマスタCSVに隣接列が無い。隣接の再構築＝rank3の復活は別タスク）。
--   ・zone_plan の旧語彙行は削除しない（追加のみ）
--     （address_master.common_id → zone_plan.common_id の FK があり、drop 前に消すと孤児になる）。
--   ・split_threshold は既定 170（dispatch_v0.sql:25 が not null default 170 で付与済み＝明示不要）。
-- =============================================================


-- =============================================================
-- §0. 安全ガード: 投入元が common_id ごとに1行に畳めているか
--   「depot は common_id ごとに一意」を前提に group by common_id, depot で畳んでいる。
--   この前提が崩れると同じ common_id が複数行になり、
--   on conflict do nothing が"黙って片方を捨てる"（非決定）ため、ここで止める。
--   ※ 2026-07-17 実測では 0 件（recheck_vocab_gates_v0.sql seq 10）。
--     ただし area_master は再ロードされ得るので、実行のたびに機械で確かめる。
-- =============================================================
do $$
declare v_dup int;
begin
  select count(*) into v_dup
  from (
    select common_id
    from (
      select common_id, depot
      from public.area_master
      where is_valid and common_id is not null
      group by common_id, depot
    ) s
    group by common_id
    having count(*) > 1
  ) t;

  if v_dup > 0 then
    raise exception
      '中断: 投入元が common_id ごとに1行に畳めていません（% 件）。'
      '「depot は common_id ごとに一意」の前提が崩れています。'
      'recheck_vocab_gates_v0.sql の seq 10（②前提a）を再実行して原因を確認してください。', v_dup;
  end if;
end $$;


-- =============================================================
-- §1. 投入前の状態（記録用）
-- =============================================================
select 'before' as phase,
       (select count(*) from public.zone_plan)                                as zone_plan_rows,
       (select count(distinct common_id) from public.area_master
         where is_valid and common_id is not null)                            as new_vocab,
       (select count(*) from public.deliveries d
         where d.common_id is not null
           and not exists (select 1 from public.zone_plan zp
                            where zp.common_id = d.common_id))                as deliveries_unresolved;


-- =============================================================
-- §2. 新語彙を追加（追加のみ・既存行は一切触らない）
--   on conflict do nothing の理由:
--     親指示書 C.「旧語彙行は削除しない（追加のみ）」＝非破壊。
--     既存行を do update で上書きすると、その行の adjacent_zones（旧語彙の隣接定義）が
--     NULL で潰れる。隣接の扱いは別タスクと決まっているため、ここでは触らない。
--   ※ §0 のガードで投入元の一意性を保証済みなので、
--     do nothing が"黙って捨てる"ことはない（捨てる対象が存在しない）。
-- =============================================================
insert into public.zone_plan
  (common_id, zone_no, depot_code, adjacent_zones, version, is_valid)
select
  am.common_id,
  min(am.zone_no)::text,   -- integer → text（範囲の先頭＝From・旧実装の慣習）
  am.depot,                -- → depot_code
  null,                    -- adjacent_zones は新語彙分 NULL（親指示書 C.）
  1,                       -- version（旧 load_master_v0.sql と同じ）
  true                     -- is_valid
from public.area_master am
where am.is_valid                    -- boolean。無効行は登録しない
  and am.common_id is not null
group by am.common_id, am.depot      -- depot は common_id ごとに一意（§0 で機械確認済み）
on conflict (common_id) do nothing;  -- 既存行（旧語彙・重複実行分）は保持


-- =============================================================
-- §3. 検証（指示書②の合格条件）
--   合格条件: deliveries.common_id（非NULL）が全て zone_plan.common_id に存在する
-- =============================================================
select
  'after' as phase,
  (select count(*) from public.zone_plan)                                     as zone_plan_rows,
  (select count(distinct common_id) from public.area_master
    where is_valid and common_id is not null)                                 as new_vocab,
  -- ★合格条件: 0 であること
  (select count(*) from public.deliveries d
    where d.common_id is not null
      and not exists (select 1 from public.zone_plan zp
                       where zp.common_id = d.common_id))                     as deliveries_unresolved,
  -- 新語彙が全て入ったか（0 が合格）
  (select count(*) from (
     select common_id from public.area_master where is_valid and common_id is not null
     except
     select common_id from public.zone_plan
   ) t)                                                                       as new_vocab_missing,
  -- 追加のみ＝common_id ごとに1行（PKなので常に真だが、件数の裏取りとして表示）
  (select count(*) from public.zone_plan where adjacent_zones is null)        as rows_adjacent_null,
  (select count(*) from public.zone_plan where split_threshold = 170)         as rows_threshold_170;

-- 【読み方】
--   ・deliveries_unresolved … ★指示書②の合格条件（0 が合格）。
--       ※【2026-07-17 実測】②単独では 0 にならず 4 が残った。③の完了をもって 0 になる。
--         旧語彙 deliveries の大半（06-17 の800行）は旧 zone_plan 行が残っている（＝追加のみ）ため
--         解決できるが、06-16 の4行は common_id が C0001/C0002＝正準規格v1 以前の廃止規格で、
--         zone_plan にも area_master にも address_master にも存在しない孤児のため解決できない。
--         この4行は③（旧DSPダミー削除）で消えるため、②→③の順で 0 に到達する。
--         → ②の完了判定は new_vocab_missing = 0 と zone_plan_rows で行い、
--           deliveries_unresolved は③の後に確認する。
--   ・new_vocab_missing    = 0  … 新語彙が全て zone_plan に入った。
--   ・zone_plan_rows は「投入前の行数 + 新語彙のうち未登録だった分」になる。
--       2026-07-17 実測の見込み: 8（旧） + 1653（新） − 1（重複＝新旧に共通する1件） = 1660。
--       ※ 重複1件は recheck_vocab_gates_v0.sql seq 13 の overlap=1 に対応。
--   ・冪等: 再実行しても on conflict do nothing のため件数は変わらない。
