-- =============================================================
-- 指示書: エリアマスタ文字化け修正 v0.1 — ①-a 破損行の実データ書き出し（fix生成用）
--   目的: 破損行を「原本CSVと intact列で個別突合」して直すため、
--         staging=全列値＋ctid＋壊れた列名、area_master=ctid（DELETE用）を1つの結果表に出す。
--   性質: SELECT のみ（副作用なし）。
-- 実行: Supabase SQL Editor（postgres）。結果を丸ごと（JSON）貼って渡す。
--   ★ Editor は最後の結果しか出さないので union all で1つの表にまとめている。
-- =============================================================
-- 出力列: src（staging/area_master）／ctid／broken_col（壊れた列名）／data（行の全列＝to_jsonb）
--   ・staging  … data の intact 列で原本CSVを一意特定し、broken_col だけ原本値へ UPDATE する。
--   ・area_master … ctid だけ使う（①-c で ctid DELETE→load 再実行。個別修復は不要）。
-- =============================================================

with p as (select '%' || chr(65533) || '%' as m)
select 'staging' as src,
       s.ctid::text as ctid,
       (array_remove(array[
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
        ], null))[1] as broken_col,
       to_jsonb(s) as data
from public.area_master_staging s, p
where s.prefecture   like p.m or s.municipality like p.m or s.town        like p.m
   or s.chome        like p.m or s.zone_no      like p.m or s.common_id   like p.m
   or s.is_valid     like p.m or s.priority     like p.m or s.area        like p.m
   or s.depot        like p.m or s.src_town_key like p.m or s.postal_code like p.m

union all

select 'area_master' as src,
       a.ctid::text as ctid,
       array_to_string(array_remove(array[
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
        ], null), '+') as broken_col,
       jsonb_build_object('common_id', a.common_id, 'prefecture', a.prefecture,
                          'municipality', a.municipality, 'town', a.town, 'chome', a.chome) as data
from public.area_master a, p
where a.town_key     like p.m or a.prefecture   like p.m or a.municipality    like p.m
   or a.town         like p.m or a.chome        like p.m or a.common_id       like p.m
   or a.area         like p.m or a.depot        like p.m or a.source_town_key like p.m
   or a.postal_code  like p.m
order by src, broken_col, ctid;
