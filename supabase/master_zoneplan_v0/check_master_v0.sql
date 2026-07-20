-- =============================================================
-- 全国Master／ZonePlan 読込 v0.4 確認SQL
-- 実行: load_master_v0.sql（1回目・2回目）の後。各ブロックを選択して実行。
-- ★ SQLエディタは複数文だと最後の結果しか出ない → 見たいSELECTを選択して Ctrl/Cmd+Enter。
-- =============================================================

-- ⚠ RETIRED部分あり（2026-07-17）: address_master は撤去済み（語彙是正⑤）。
--   本ファイルの ①②③⑤⑥⑦ にあった address_master 参照は無効化した（フレッシュ環境で即エラーになるため）。
--   後継は area_master（area_master_v0/check_area_master_v0.sql で同等の確認ができる）。
--   ★ 復活させないこと。zone_plan 側の確認は現役。

-- ① 件数（zone_plan）-------------------
--   ※ address_master の件数は撤去済みのため集計から外した。
select 'zone_plan' as tbl, count(*) from public.zone_plan;


-- ② 重複排除（同一キーが2件以上ない＝0行）--------------------
select common_id, count(*) from public.zone_plan      group by common_id having count(*) > 1;  -- 0行
-- select town_key,  count(*) from public.address_master group by town_key  having count(*) > 1;  -- RETIRED（⑤で撤去）


-- ③ 判定経路：共通IDで Master × ZonePlan を結合 ---------------  ← RETIRED（⑤で撤去・実行不可）
--    共通ID→ゾーン番号・隣接、Master→拠点 が引ける。
-- select
--   m.town_key,
--   m.common_id,
--   z.zone_no,
--   z.depot_code      as zone_depot,
--   m.depot_code      as master_depot,
--   z.adjacent_zones
-- from public.address_master m
-- join public.zone_plan z on z.common_id = m.common_id
-- order by m.town_key;


-- ④ 隣接が共通IDとして解決できるか（自己結合）----------------
--    隣接の各共通IDが zone_plan に実在する（内部結合で全件解決）。
select
  z.common_id,
  btrim(nb.name) as adjacent_common_id,
  z2.zone_no     as adjacent_zone_no
from public.zone_plan z
cross join lateral unnest(string_to_array(z.adjacent_zones, ',')) as nb(name)
join public.zone_plan z2 on z2.common_id = btrim(nb.name)
order by z.common_id, adjacent_common_id;


-- ⑤ 丁目は属性列・通常空（NULLでない行数＝0が期待）----------  ← RETIRED（⑤で撤去・実行不可）
-- select count(*) as chome_not_empty from public.address_master where chome is not null;


-- ⑥ 版列が存在するか（version / is_valid）-------------------
select table_name, column_name
from information_schema.columns
where table_schema = 'public'
  and table_name in ('zone_plan')      -- address_master は撤去済み（⑤）＝一覧から外した
  and column_name in ('version','is_valid')
order by table_name, column_name;


-- ⑦ 住所→ゾーンの土台（例：TownKeyからゾーン・隣接・拠点）----  ← RETIRED（⑤で撤去・実行不可）
--   後継: area_master を使う。例）
--     select am.town_key, am.common_id, zp.zone_no, zp.depot_code, zp.adjacent_zones
--     from public.area_master am join public.zone_plan zp on zp.common_id = am.common_id
--     where am.town_key = '愛知県|岡崎市|箱柳町' and am.is_valid;
-- select m.town_key, m.common_id, z.zone_no, z.depot_code, z.adjacent_zones
-- from public.address_master m
-- join public.zone_plan z on z.common_id = m.common_id
-- where m.town_key = '愛知県|岡崎市|箱柳町';   -- → OKZ_C_01_08 / zone 1 / 隣接 OKZ_E,W,S / 拠点 D01


-- =============================================================
-- 合格条件との対応
--   ・Master(PK=TownKey)/ZonePlan(PK=共通ID,列=共通ID/ゾーン番号/拠点/隣接) 作成 … ①⑥
--   ・重複排除（2回目全件スキップ）         … load の counts ＋ ②
--   ・丁目は属性列・通常空                  … ⑤（0行）
--   ・共通IDで結合し判定経路が引ける        … ③④⑦
--   ・読込件数・除外件数が数で分かる        … load_master_v0.sql の counts
--   ・版列が存在                           … ⑥
-- =============================================================
