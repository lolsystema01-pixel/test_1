-- =============================================================
-- 指示書: 認証・権限 残課題 v1.1 — ② address_master の整理【調査のみ・読むだけ】
--   指示書の条件は「参照が無いことを確認 → 無ければ policy ごと drop」。
--   本監査の結論（コード監査＝Fable独立監査で確定）: 参照が【有る】ため条件不成立＝今回は drop しない。
--   本SQLは、その参照の実在と「将来 drop するための前提ゲート」をDB上で機械的に確認する。
--   ※ 全クエリ SELECT のみ（DROP・UPDATE・ALTER は一切含まない）。
-- 実行: Supabase SQL Editor。上から順に。
-- =============================================================
-- 【重要な落とし穴（なぜ普通の方法では確認できないか）】
--   PostgreSQL は関数本体（$$…$$ 内）のテーブル参照を pg_depend に記録しない。
--   そのため `drop table address_master` は依存エラー無しで成功してしまい、
--   次に配車実行／公開ステータス照会が走った瞬間に初めて壊れる（時限爆弾）。
--   → 参照確認は pg_proc.prosrc（関数ソース本文）の全文検索で行う（§1）。
-- =============================================================


-- =============================================================
-- §1. 参照検出：address_master を本文中で参照する「生きたDBオブジェクト」
-- =============================================================
-- 1-1) 関数（これが本命。pg_depend では出ない）
select n.nspname as schema, p.proname as function_name,
       case when p.prosecdef then 'SECURITY DEFINER' else '' end as definer,
       pg_get_function_identity_arguments(p.oid) as args
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname not in ('pg_catalog','information_schema')
  and p.prosrc ilike '%address_master%'
order by n.nspname, p.proname;
-- 期待（コード監査と一致すること）:
--   zone_rank(a text, b text)                    … 配車の「同一市」判定
--   dispatch_build(p_date date)                  … 配車エンジン本体
--   delivery_status_public(p_tracking_number)    … 公開ステータスAPI（SECURITY DEFINER・anon公開）
-- → 1件でも出る＝指示書の「参照が無ければ」の条件不成立＝drop しない。

-- 1-2) ビュー・マテビュー（念のため。0件想定）
select schemaname, viewname from pg_views
where definition ilike '%address_master%' and schemaname not in ('pg_catalog','information_schema')
union all
select schemaname, matviewname from pg_matviews
where definition ilike '%address_master%';
-- 期待: 0件

-- 1-3) 外部キー（address_master を参照する側。0件想定＝drop 自体は他テーブルを壊さない）
select conname, conrelid::regclass as referencing_table
from pg_constraint
where confrelid = 'public.address_master'::regclass and contype = 'f';
-- 期待: 0件（address_master→zone_plan の FK は「外向き」なので出ない）


-- =============================================================
-- §2. 語彙ゲートA：deliveries.common_id は新マスタ（area_master）の語彙か
--   新旧で共通IDの番号体系が違う（例: 箱柳町 旧OKZ_C_01_08／新OKZ_C_01_06）。
--   旧語彙の行が残っていると、関数を area_master に書き換えた瞬間
--   「エラー無しで市名NULL・同一市判定不成立」という静かな壊れ方をする。
-- =============================================================
-- 2-1) 総括（合格 = old_vocab_only が 0）
select
  count(*) filter (where d.common_id is not null)                                   as with_common_id,
  count(*) filter (where am.common_id is not null)                                  as in_area_master,   -- 新語彙
  count(*) filter (where d.common_id is not null and am.common_id is null)          as old_vocab_only    -- ★0が合格
from public.deliveries d
left join (select distinct common_id from public.area_master where is_valid) am
       on am.common_id = d.common_id;

-- 2-2) 旧語彙が残っている場合の内訳（どの日付・どのID）
select d.delivery_date, d.common_id, count(*) as cnt
from public.deliveries d
where d.common_id is not null
  and not exists (select 1 from public.area_master am where am.common_id = d.common_id and am.is_valid)
group by d.delivery_date, d.common_id
order by d.delivery_date desc, cnt desc
limit 30;
-- 出た場合の対処: common_id_rematch_v0（area_master 直lookupの再付与）を該当日付に実行してから再確認。


-- =============================================================
-- §3. 語彙ゲートB：zone_plan（隣接・分割閾値）は新語彙か
--   zone_rank の隣接判定（rank3）と dispatch_build の分割閾値は zone_plan を引くため、
--   zone_plan.common_id／adjacent_zones が旧語彙のままだと配車品質が静かに劣化する。
-- =============================================================
-- 3-1) zone_plan.common_id が area_master に存在するか（合格 = not_in_new が 0）
select count(*)                                                        as zone_plan_rows,
       count(*) filter (where am.common_id is null)                    as not_in_new       -- ★0が合格
from public.zone_plan zp
left join (select distinct common_id from public.area_master where is_valid) am
       on am.common_id = zp.common_id;

-- 3-2) adjacent_zones（カンマ区切り）内のIDが area_master に存在するか（合格 = 0行）
select zp.common_id, trim(adj) as adjacent_id
from public.zone_plan zp,
     unnest(string_to_array(coalesce(zp.adjacent_zones, ''), ',')) as adj
where trim(adj) <> ''
  and not exists (select 1 from public.area_master am where am.common_id = trim(adj) and am.is_valid)
limit 30;
-- 期待: 0行（出た分は旧語彙の隣接定義＝ZonePlan の更新が必要）


-- =============================================================
-- §4. 一意性ゲート：common_id → municipality は一意か
--   3関数は `where common_id = X limit 1`（order by 無し）で市名を引くため、
--   1つの共通IDが複数の自治体を持つと結果が非決定になる。
--   area_master は全国実データで行数が桁違いに増えるためここの確認が必須。
-- =============================================================
-- 4-1) 新マスタ（合格 = 0行）
select common_id, count(distinct municipality) as municipalities,
       string_agg(distinct municipality, ' / ') as examples
from public.area_master
where is_valid and common_id is not null
group by common_id
having count(distinct municipality) > 1
order by municipalities desc
limit 30;
-- 期待: 0行。出た場合＝将来の移行SQLは limit 1 に
--   `order by priority asc nulls last, town_key` を付けて決定的にする必要がある。

-- 4-2) 参考：旧マスタ側の同チェック
select common_id, count(distinct municipality) as municipalities
from public.address_master
where common_id is not null
group by common_id
having count(distinct municipality) > 1
limit 10;


-- =============================================================
-- §5. 参考情報：新旧マスタの規模と語彙の重なり
-- =============================================================
select
  (select count(*) from public.address_master)                                   as old_rows,
  (select count(*) from public.area_master)                                      as new_rows,
  (select count(*) from public.area_master where not is_valid)                   as new_invalid_rows,
  (select count(distinct common_id) from public.address_master where common_id is not null) as old_vocab,
  (select count(distinct common_id) from public.area_master where common_id is not null and is_valid) as new_vocab,
  (select count(*) from (
     select distinct common_id from public.address_master where common_id is not null
     intersect
     select distinct common_id from public.area_master where common_id is not null and is_valid
   ) t)                                                                          as vocab_overlap;
-- 見方: vocab_overlap が old_vocab に比べて小さい＝新旧の番号体系が別物（単純置換は不可）という定量的裏付け。


-- =============================================================
-- 判定（この監査の結論の読み方）
-- =============================================================
-- ・§1-1 に関数が1件でも出る            → 指示書の「参照が無ければ drop」の条件不成立。【今回は drop しない】（確定）
-- ・§2 old_vocab_only = 0
--   かつ §3 not_in_new = 0・隣接0行
--   かつ §4-1 が0行                     → データ側の前提は整っている。
--       次のステップ（別指示書）: 3関数を area_master 参照へ書き換え（is_valid フィルタ＋決定的 order by 付き）
--       → pglite回帰＋実機確認 → その後に初めて drop_address_master。
-- ・どれかのゲートが不合格               → 先にデータ統一（common_id_rematch／ZonePlan更新）。関数書き換えも drop も保留。
-- =============================================================
