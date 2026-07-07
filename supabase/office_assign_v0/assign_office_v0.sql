-- =============================================================
-- 指示書: 拠点振分 v0.2 — 手順 2/3
--   共通IDが付いた荷物に「共通ID→拠点→営業所」の経路で拠点コード・営業所コードを付与。
--   対応: 要件定義 6.2 全国配分（拠点・営業所付与 / dry-run→本実行 / 判定不能は保留）/ 4.5 配布
-- 実行: SQL Editor。seed_office_master_v0.sql の後。
--   ★ まず【A. dry-run】で件数を確認 → 問題なければ【B. 本実行】。
--   各まとまりを選択して Ctrl/Cmd+Enter で個別実行（複数文は最後の結果しか出ないため）。
-- =============================================================
-- 経路:
--   荷物.common_id ─→ zone_plan.common_id（→ depot_code＝拠点） ─→ offices.depot_code（→ office_code＝営業所）
--   ・既定 1:1 なので 拠点が決まれば営業所が一意に決まる。
--   ・共通IDはあるが拠点／営業所が引けない荷物は「保留」（取りこぼさない。6.2）。
--   ・共通ID未付与（前段の住所判定で未登録・保留）の荷物は対象外（そのまま）。
-- =============================================================


-- =====================  A. dry-run（書き込まない）  ==========
-- 拠点・営業所が「引けた／引けない」件数を出す。
with resolved as (
  select d.tracking_number,
         d.common_id,
         z.depot_code,                       -- 共通ID→拠点
         o.office_code                       -- 拠点→営業所（1:1）
  from public.deliveries d
  left join public.zone_plan z on z.common_id = d.common_id
  left join public.offices   o on o.depot_code = z.depot_code
  where d.common_id is not null              -- 共通IDのある荷物だけが対象
)
select
  count(*)                                                       as target_total,    -- 対象（共通IDあり）
  count(*) filter (where office_code is not null)                as resolvable,       -- 引けた（拠点・営業所とも解決）
  count(*) filter (where office_code is null)                    as unresolvable,     -- 引けない（→保留対象）
  count(*) filter (where depot_code is null)                     as depot_missing,    --   うち拠点が引けない
  count(*) filter (where depot_code is not null
                     and office_code is null)                    as office_missing    --   うち営業所が引けない
from resolved;
-- 期待: target_total=14 / resolvable=14 / unresolvable=0（depot_missing=0・office_missing=0）

-- 対象外（共通ID未付与＝前段で保留済み）の件数
select count(*) as out_of_scope_no_common_id
from public.deliveries
where common_id is null;
-- 期待: 2（住所判定で未登録・保留になった荷物）


-- =====================  B. 本実行（書き込み）  ===============
-- （任意）再実行時に前回の本振分保留を再評価したい場合のみ次行を有効化:
--   共通IDはあるのに保留になっている荷物を未配車へ戻す（共通ID未付与の保留=対象外は触らない）。
-- update public.deliveries set status = '未配車'
--  where common_id is not null and status = '保留';

-- B-1) 共通IDのある荷物に 拠点コード・営業所コード を付与（1:1経路）
update public.deliveries d
set depot_code  = z.depot_code,
    office_code = o.office_code
from public.zone_plan z
join public.offices   o on o.depot_code = z.depot_code
where z.common_id = d.common_id
  and d.common_id is not null;

-- B-2) 拠点／営業所が引けなかった荷物を保留にする（取りこぼさない。6.2）
--   共通IDはあるのに office_code が付かなかった＝経路が解決しなかった荷物。
update public.deliveries
set status = '保留'
where common_id is not null
  and office_code is null;

-- B-3) 本実行の件数
select
  (select count(*) from public.deliveries
     where common_id is not null and office_code is not null)            as assigned,          -- 付与できた
  (select count(*) from public.deliveries
     where common_id is not null and office_code is null)                as held_this_step,    -- 今回保留（拠点/営業所引けず）
  (select count(*) from public.deliveries where common_id is null)       as out_of_scope,      -- 対象外（共通ID未付与）
  (select count(*) from public.deliveries where status = '保留')          as held_total;        -- 保留 合計
-- 期待: assigned=14 / held_this_step=0 / out_of_scope=2 / held_total=2（=前段の保留2件のみ）
