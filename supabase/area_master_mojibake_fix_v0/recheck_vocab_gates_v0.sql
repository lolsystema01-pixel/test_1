-- =============================================================
-- 語彙ゲート（工程ゲート・1画面版）v0
--
--   出典: supabase/auth_rls_remaining_v1/audit_address_master_v0.sql（§1〜§5）
--   目的: 上記の9クエリを **1本のSELECT** に畳む。Supabase SQL Editor は
--         最後のSELECTしか結果を表示しないため、原本は上から順にブロック実行が必要だった。
--         本ファイルは「丸ごと貼って1回Run」で全ゲートが1つの表で読める。
--         指示書「語彙是正→address_master 撤去 v0.1」の各工程（①〜⑤）の後に再実行する。
--
--   性質: 全て SELECT のみ。DROP/UPDATE/ALTER/CREATE は一切含まない（副作用なし）。
--         何度実行してよく、**address_master の drop 前後どちらでも動く**
--         （旧マスタへの直接参照を持たない。to_regclass で有無だけを見る）。
--
--   実行: Supabase SQL Editor（postgres）で本ファイルを丸ごと Run。
--
-- 【読み方】
--   prev_0710 … 2026-07-10（①適用前・語彙是正の着手前）の実測。今回値と並べて差分を見る。
--   judge     … ✅=合格 ／ ✗=不合格 ／ ⏸=現時点では正常（後続工程の対象）／ ⚠=要判断
--
-- 【②〜⑤ 完了後の期待値（2026-07-17 到達済み）】
--   seq 1-2   0 / 0        … ①の回帰（U+FFFD の再発なし）
--   seq 3     0            … ④完了＝旧マスタ参照なし
--   seq 4-5   0 / 0
--   seq 6     0            … ③完了＝旧語彙の荷物なし
--   seq 7-8   0 / 0        … ⑤の案a（旧 zone_plan 行と宙ぶらりん隣接の掃除）完了
--   seq 9     3（⚠）      … **本物の複数自治体**（GM2_07_07／HY4_12／KY3_NAK_186_195）。
--                            消えないのが正しく、④の `order by priority asc nulls last, town_key`
--                            で決定化済み。①で 8→3 に減った（差5は文字化け由来だった）。
--   seq 11    1015/1653    … 共通ID＝ゾーン範囲（設計どおり）。②は min(zone_no) で決定化。
--   seq 12    1559/1601    … 範囲の裏取り。From不一致13は診断済（A群=先頭ゾーンに町なし／
--                            B群=そもそも範囲でない命名 KGW_01_02 系）。
--   seq 13    (drop済み)   … ⑤完了
--   → **seq 9 の ⚠ 以外に ✗/⚠ が出たら、それは本物の異常**（想定内の赤は残していない）。
-- =============================================================

with
p as (select '%' || chr(65533) || '%' as m),

-- 新語彙＝area_master の有効行が持つ common_id 集合
new_vocab as (
  select distinct common_id
  from public.area_master
  where is_valid and common_id is not null
),

-- §1-1 address_master を本文で参照する関数（pg_depend には出ない＝prosrc全文検索が唯一の手段）
g1_1 as (
  select count(*)::int as n,
         coalesce(string_agg(pr.proname || case when pr.prosecdef then '(DEFINER)' else '' end,
                             ' / ' order by pr.proname), '(なし)') as detail
  from pg_proc pr
  join pg_namespace ns on ns.oid = pr.pronamespace
  where ns.nspname not in ('pg_catalog','information_schema')
    and pr.prosrc ilike '%address_master%'
),

-- §1-2 ビュー・マテビューからの参照
g1_2 as (
  select count(*)::int as n
  from (
    select viewname as obj from pg_views
    where definition ilike '%address_master%'
      and schemaname not in ('pg_catalog','information_schema')
    union all
    select matviewname from pg_matviews
    where definition ilike '%address_master%'
  ) t
),

-- §1-3 address_master を参照する外部キー
--   ⚠ 'public.address_master'::regclass と書くと、⑤で drop 済みの環境では
--     キャスト自体が落ちる。to_regclass（無ければ NULL → 0件）で drop 前後どちらでも動くようにする。
g1_3 as (
  select count(*)::int as n
  from pg_constraint
  where confrelid = to_regclass('public.address_master') and contype = 'f'
),

-- §2 語彙ゲートA: deliveries.common_id が新語彙に無い行（③の対象）
g2 as (
  select count(*) filter (where d.common_id is not null and nv.common_id is null)::int as n,
         count(*) filter (where d.common_id is not null)::int as with_cid
  from public.deliveries d
  left join new_vocab nv on nv.common_id = d.common_id
),
g2d as (
  select coalesce(string_agg(t.txt, ' / ' order by t.dt), '(なし)') as detail
  from (
    select d.delivery_date as dt,
           d.delivery_date::text || '=' || count(*)::text || '行' as txt
    from public.deliveries d
    where d.common_id is not null
      and not exists (select 1 from new_vocab nv where nv.common_id = d.common_id)
    group by d.delivery_date
  ) t
),

-- §3-1 語彙ゲートB: zone_plan.common_id が新語彙に無い（②の対象）
g3_1 as (
  select count(*)::int                                     as rows_all,
         count(*) filter (where nv.common_id is null)::int as n
  from public.zone_plan zp
  left join new_vocab nv on nv.common_id = zp.common_id
),

-- §3-2 語彙ゲートB: adjacent_zones 内の未知ID（②の対象・配車の隣接判定が依存）
g3_2 as (
  select count(*)::int as n,
         coalesce(string_agg(t.adjacent_id, ' / ' order by t.adjacent_id), '(なし)') as detail
  from (
    select distinct trim(adj) as adjacent_id
    from public.zone_plan zp,
         unnest(string_to_array(coalesce(zp.adjacent_zones, ''), ',')) as adj
    where trim(adj) <> ''
      and not exists (select 1 from new_vocab nv where nv.common_id = trim(adj))
  ) t
),

-- §4-1 一意性ゲート: common_id → municipality が非一意（④で order by 決定化が必要）
g4_1 as (
  select count(*)::int as n,
         coalesce(string_agg(t.common_id || '（' || t.munis || '）', ' / ' order by t.common_id),
                  '(なし)') as detail
  from (
    select common_id, string_agg(distinct municipality, '・') as munis
    from public.area_master
    where is_valid and common_id is not null
    group by common_id
    having count(distinct municipality) > 1
  ) t
),

-- ①の回帰確認: U+FFFD 残存（走査列は detect_mojibake_v0.sql と同一。
--   数値/真偽列（area_master の zone_no int・is_valid bool・priority）は化けないため対象外）
moji as (
  select
    (select count(*) from public.area_master a, p
      where a.town_key        like p.m or a.prefecture   like p.m or a.municipality    like p.m
         or a.town            like p.m or a.chome        like p.m or a.common_id       like p.m
         or a.area            like p.m or a.depot        like p.m or a.source_town_key like p.m
         or a.postal_code     like p.m)::int as am,
    (select count(*) from public.area_master_staging s, p
      where s.prefecture   like p.m or s.municipality like p.m or s.town        like p.m
         or s.chome        like p.m or s.zone_no      like p.m or s.common_id   like p.m
         or s.is_valid     like p.m or s.priority     like p.m or s.area        like p.m
         or s.depot        like p.m or s.src_town_key like p.m or s.postal_code like p.m)::int as st
),

-- ②の前提ゲート（本SQLでの追加。原本 audit には無い）
--   指示書②は「area_master（is_valid）から distinct common_id, zone_no, depot を導出して upsert」。
--   ところが zone_plan の PK は common_id 単独。同じ common_id の行が複数できると
--   on conflict (common_id) do update は Postgres が
--   「ON CONFLICT DO UPDATE command cannot affect row a second time」で落ちる。
--
--   【2026-07-17 実測でわかったこと】
--     ・(zone_no, depot) の非一意 = 1015件（新語彙1653個の61%）。ただし異常ではなく設計。
--       共通IDが「ゾーン範囲」を名前に持つ（例 ABK_C_29_32 = zone 29〜32・depot は一定）。
--     ・旧実装は master_zoneplan_v0/load_master_v0.sql:55 で
--         z.zone_from as zone_no  -- 単一ゾーン番号＝From（範囲は配車側へ）
--       と、範囲の From を代表値に採用していた。②も同じ慣習なら min(zone_no)。
--     ・なお zone_plan.zone_no は現状どこからも読まれていない
--       （zone_rank は adjacent_zones のみ／dispatch_build は split_threshold のみ／
--         配達順が使うのは deliveries.zone_no という別列）。＝実害は限定的だが、
--         ②のSQL自体が上記エラーで落ちるため決定化は必要。
--
--   → 以下3つで「ばらつくのは zone_no だけ・範囲の From を採れば決定的」を実測で裏取りする。

-- ②前提a: common_id → depot が非一意か（★0が合格＝depot は決定的に決まる）
g2_dep as (
  select count(*)::int as n
  from (
    select common_id from public.area_master
    where is_valid and common_id is not null
    group by common_id having count(distinct coalesce(depot,'∅')) > 1
  ) t
),
g2_dep_d as (
  select coalesce(string_agg(t.common_id || '（' || t.deps || '）', ' / ' order by t.common_id),
                  '(なし)') as detail
  from (
    select common_id, string_agg(distinct coalesce(depot,'(null)'), '・') as deps
    from public.area_master
    where is_valid and common_id is not null
    group by common_id having count(distinct coalesce(depot,'∅')) > 1
    limit 10
  ) t
),

-- ②前提b: common_id → zone_no が非一意か（>0 は想定内＝範囲エンコード。min採用で決定化）
g2_zone as (
  select count(*)::int as n,
         (select count(distinct common_id)::int from public.area_master
           where is_valid and common_id is not null) as total
  from (
    select common_id from public.area_master
    where is_valid and common_id is not null
    group by common_id having count(distinct zone_no) > 1
  ) t
),

-- ②前提c: 範囲の裏取り — common_id 名の末尾 _<from>_<to> と min/max(zone_no) が一致するか
--   一致率が高いほど「共通ID＝ゾーン範囲」が推測ではなく実測になり、
--   zone_no := min(zone_no)（＝From）の採用根拠になる。
g2_rng as (
  select count(*)::int                                                as named,
         count(*) filter (where t.mn = t.nfrom and t.mx = t.nto)::int as matched,
         count(*) filter (where t.mn <> t.nfrom)::int                 as from_ng
  from (
    select common_id,
           min(zone_no) as mn, max(zone_no) as mx,
           ((regexp_match(common_id, '_(\d+)_(\d+)$'))[1])::int as nfrom,
           ((regexp_match(common_id, '_(\d+)_(\d+)$'))[2])::int as nto
    from public.area_master
    where is_valid and common_id is not null
      and common_id ~ '_(\d+)_(\d+)$'
      and zone_no is not null
    group by common_id
  ) t
),

-- §5 参考: マスタの規模
--   ⚠ 素の `select ... from public.address_master` は、⑤で drop 済みの環境では
--     パース時点で落ちる（CASE で囲っても回避できない）。→ 旧マスタ側の数値は参照しない。
--   旧マスタの規模と新旧の語彙の重なり（2026-07-17 実測: old_rows=14 / old_vocab=8 /
--   new_vocab=1653 / overlap=1 ＝新旧は別体系という定量的裏付け）は
--   vocab_fix_v0/確認結果メモ.md に記録済み。ここでは有無だけを見る。
s5 as (
  select (to_regclass('public.address_master') is not null)  as old_exists,
         (select count(*) from public.area_master)::int      as new_rows,
         (select count(*) from new_vocab)::int               as new_vocab
)

select seq, gate, item, prev_0710, actual, expected, judge, detail
from (
  -- ① の回帰確認 ------------------------------------------------
  select 1 as seq, '①-d' as gate, 'U+FFFD 残存: area_master' as item,
         '37' as prev_0710,
         (select am::text from moji) as actual,
         '0' as expected,
         case when (select am from moji) = 0 then '✅ 0件を維持'
              else '✗ 再発（①の再確認が必要）' end as judge,
         '' as detail

  union all
  select 2, '①-d', 'U+FFFD 残存: area_master_staging',
         '43', (select st::text from moji), '0',
         case when (select st from moji) = 0 then '✅ 0件を維持'
              else '✗ 再発（①の再確認が必要）' end, ''

  -- §1 参照検出 -------------------------------------------------
  union all
  select 3, '§1-1', 'address_master を参照する関数',
         '3関数', (select n::text from g1_1), '④完了後に 0',
         case when (select n from g1_1) = 0 then '✅ 参照なし＝⑤drop可'
              else '⏸ ④の書換対象（現時点では正常）' end,
         (select detail from g1_1)

  union all
  select 4, '§1-2', 'ビュー/マテビューからの参照',
         '0', (select n::text from g1_2), '0',
         case when (select n from g1_2) = 0 then '✅ 合格' else '✗ 要調査' end, ''

  union all
  select 5, '§1-3', 'address_master を参照するFK（drop後は自動的に0）',
         '0', (select n::text from g1_3), '0',
         case when (select n from g1_3) = 0 then '✅ 合格' else '✗ 要調査' end, ''

  -- §2 語彙ゲートA（③の対象） ----------------------------------
  union all
  select 6, '§2', '③ deliveries の旧語彙残置',
         '804', (select n::text from g2), '0',
         case when (select n from g2) = 0 then '✅ 合格'
              else '✗ 不合格＝③が必要' end,
         (select detail from g2d)

  -- §3 語彙ゲートB（②の対象） ----------------------------------
  union all
  select 7, '§3-1', '② zone_plan.common_id が新語彙にない',
         '(未記録)',
         (select n::text from g3_1) || ' / ' || (select rows_all::text from g3_1) || '行中',
         '0',
         case when (select n from g3_1) = 0 then '✅ 合格'
              else '✗ 不合格＝②が必要' end, ''

  union all
  select 8, '§3-2', '② zone_plan.adjacent_zones の未知ID',
         '13', (select n::text from g3_2), '0',
         case when (select n from g3_2) = 0 then '✅ 合格'
              else '✗ 不合格＝②が必要（配車の隣接判定が依存）' end,
         (select detail from g3_2)

  -- §4 一意性ゲート（④の対象） ----------------------------------
  union all
  select 9, '§4-1', '④ common_id→municipality の非一意',
         '8', (select n::text from g4_1), '0 または本物の複数自治体のみ',
         case when (select n from g4_1) = 0 then '✅ 合格'
              when (select n from g4_1) <= 3 then '⚠ 本物の複数自治体のみ＝④で order by 必須'
              else '✗ 想定超（文字化けの残存を疑う）' end,
         (select detail from g4_1)

  -- ②の前提ゲート（追加） ---------------------------------------
  union all
  select 10, '②前提a', '② common_id→depot の非一意（★これが本命）',
         '(未測定)', (select n::text from g2_dep), '0',
         case when (select n from g2_dep) = 0
              then '✅ depot は一意＝ばらつくのは zone_no だけ'
              else '✗ depot もばらつく＝②に depot の決定化ルールも必要' end,
         (select detail from g2_dep_d)

  union all
  select 11, '②前提b', '② common_id→zone_no の非一意（範囲エンコード）',
         '(未測定)',
         (select n::text from g2_zone) || ' / ' || (select total::text from g2_zone) || '共通ID中',
         '>0 は想定内',
         case when (select n from g2_zone) = 0
              then 'ℹ️ 非一意なし＝distinct のままでも可'
              else 'ℹ️ 想定内（共通ID＝ゾーン範囲）→ min(zone_no)＝From で決定化' end, ''

  union all
  select 12, '②前提c', '② 範囲の裏取り: 共通ID名の _from_to と min/max(zone_no) の一致',
         '(未測定)',
         (select matched::text from g2_rng) || ' / ' || (select named::text from g2_rng) || '一致',
         'ほぼ全件一致なら「共通ID＝範囲」が実測で確定',
         case when (select named from g2_rng) = 0 then '⚠ 範囲名の共通IDが無い（仮説の再検討）'
              when (select from_ng from g2_rng) = 0
              then '✅ min(zone_no) = 名前の From が全件一致＝min採用の根拠が取れた'
              else '⚠ From 不一致が ' || (select from_ng::text from g2_rng)
                   || '件＝min単独では不十分（要確認）' end,
         (select 'max側まで一致=' || matched::text || ' / From不一致=' || from_ng::text
                 || ' → From不一致が0なら zone_no := min(zone_no) が正当化される'
          from g2_rng)

  -- §5 参考 ------------------------------------------------------
  union all
  select 13, '§5', 'address_master の有無 / 新マスタ規模',
         '有り（⑤前）',
         case when (select old_exists from s5) then '有り' else '(drop済み)' end
           || ' / ' || (select new_rows::text from s5) || '行',
         '⑤完了後は「(drop済み)」',
         case when (select old_exists from s5) then 'ℹ️ ⑤未実施（address_master が残っている）'
              else '✅ ⑤完了（address_master は撤去済み）' end,
         (select 'new_vocab=' || new_vocab::text
                 || '  ※旧マスタの規模と新旧の重なり（old_rows=14 / old_vocab=8 / overlap=1）は'
                 || ' vocab_fix_v0/確認結果メモ.md に記録済み' from s5)
) t
order by seq;
