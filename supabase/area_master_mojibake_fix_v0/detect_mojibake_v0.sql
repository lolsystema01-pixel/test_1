-- =============================================================
-- 指示書: エリアマスタ文字化け修正（語彙是正① 単独版）v0.1 — ①-a 破損行の特定
--   目的: area_master / area_master_staging を U+FFFD（chr(65533)＝置換文字）で走査し、
--         破損行・破損列(broken_cols)・突合に使える intact 列・ctid を出す。
--   性質: SELECT のみ（副作用なし）。何度実行してもよい。
-- 実行: Supabase SQL Editor（postgres）。
-- =============================================================
-- 【固定の前提】新基盤(Supabase+SvelteKit+Cloud Run)・検証環境のみ・本番/現行GASは触らない・
--   全テーブルRLS・秘密情報は環境変数・SQLは人手コピペ実行（渡す前に検証）。
--
-- 【使い方】この出力（破損行の一覧）を業務Aが確認し、②-b で原本CSVと突合する対象を確定する。
--   ・broken_cols … その行で U+FFFD を含む列名の配列（＝原本値で直す対象）。
--   ・それ以外の列 … 破損していない intact 列（＝原本CSVを一意に特定する突合キー候補）。
--   ・ctid       … 物理行ID（PK town_key が壊れていても行を一意に指せる。DELETE/UPDATE の的）。
--
-- ⚠ source_town_key / src_town_key からの自己修復は禁止（別町に化ける）。
-- ⚠ 単一列JOINでの一括修正は禁止（重複多数で一意に結べない）。intact 列で1行ずつ突合すること。
--
-- 【期待件数（引き継ぎ実測）】staging ≈ 20行 / area_master(town_key) ≈ 13行。
--   大きく違えば止めて原因確認（別種の破損・スキャン漏れ）。
-- =============================================================

-- U+FFFD を含むか判定するパターン（%<U+FFFD>%）
--   ※ chr(65533) を各列 like で使う。数値/真偽列（zone_no int・is_valid bool・priority int）は
--     文字化けし得ないので走査対象外。


-- =============================================================
-- §1. サマリ件数（まず総数を期待値と突き合わせる）
-- =============================================================
with p as (select '%' || chr(65533) || '%' as m)
select 'area_master_staging' as tbl,
       count(*) as broken_rows
from public.area_master_staging s, p
where s.prefecture   like p.m or s.municipality like p.m or s.town        like p.m
   or s.chome        like p.m or s.zone_no      like p.m or s.common_id   like p.m
   or s.is_valid     like p.m or s.priority     like p.m or s.area        like p.m
   or s.depot        like p.m or s.src_town_key like p.m or s.postal_code like p.m
union all
select 'area_master' as tbl,
       count(*) as broken_rows
from public.area_master a, p
where a.town_key        like p.m or a.prefecture   like p.m or a.municipality    like p.m
   or a.town            like p.m or a.chome        like p.m or a.common_id       like p.m
   or a.area            like p.m or a.depot        like p.m or a.source_town_key like p.m
   or a.postal_code     like p.m;
-- 期待: staging ≈ 20 / area_master ≈ 13。大きく違えば止める。


-- =============================================================
-- §2. area_master_staging の破損行（詳細）
--   broken_cols＝直す列。intact 列（common_id/postal_code/壊れていない住所列）で原本を突合する。
-- =============================================================
with p as (select '%' || chr(65533) || '%' as m),
scan as (
  select
    s.ctid,
    array_remove(array[
      case when s.prefecture   like p.m then 'prefecture'   end,
      case when s.municipality like p.m then 'municipality' end,
      case when s.town         like p.m then 'town'         end,
      case when s.chome        like p.m then 'chome'        end,
      case when s.zone_no      like p.m then 'zone_no'      end,
      case when s.common_id    like p.m then 'common_id'    end,
      case when s.is_valid     like p.m then 'is_valid'     end,
      case when s.priority     like p.m then 'priority'     end,
      case when s.area         like p.m then 'area'         end,
      case when s.depot        like p.m then 'depot'        end,
      case when s.src_town_key like p.m then 'src_town_key' end,
      case when s.postal_code  like p.m then 'postal_code'  end
    ], null) as broken_cols,
    s.depot, s.src_town_key, s.prefecture, s.municipality, s.town, s.chome,
    s.area, s.zone_no, s.is_valid, s.priority, s.common_id, s.postal_code
  from public.area_master_staging s, p
)
select ctid, broken_cols,
       depot, src_town_key, prefecture, municipality, town, chome,
       area, zone_no, is_valid, priority, common_id, postal_code
from scan
where cardinality(broken_cols) > 0
order by broken_cols, ctid;


-- =============================================================
-- §3. area_master の破損行（詳細）
--   town_key(PK) が壊れている行は upsert では消えないため、①-c で ctid DELETE→load 再実行する対象。
-- =============================================================
with p as (select '%' || chr(65533) || '%' as m),
scan as (
  select
    a.ctid,
    array_remove(array[
      case when a.town_key        like p.m then 'town_key'        end,
      case when a.prefecture      like p.m then 'prefecture'      end,
      case when a.municipality    like p.m then 'municipality'    end,
      case when a.town            like p.m then 'town'            end,
      case when a.chome           like p.m then 'chome'           end,
      case when a.common_id       like p.m then 'common_id'       end,
      case when a.area            like p.m then 'area'            end,
      case when a.depot           like p.m then 'depot'           end,
      case when a.source_town_key like p.m then 'source_town_key' end,
      case when a.postal_code     like p.m then 'postal_code'     end
    ], null) as broken_cols,
    a.town_key, a.depot, a.source_town_key, a.prefecture, a.municipality, a.town, a.chome,
    a.area, a.zone_no, a.is_valid, a.priority, a.common_id, a.postal_code
  from public.area_master a, p
)
select ctid, broken_cols,
       town_key, depot, source_town_key, prefecture, municipality, town, chome,
       area, zone_no, is_valid, priority, common_id, postal_code
from scan
where cardinality(broken_cols) > 0
order by broken_cols, ctid;
