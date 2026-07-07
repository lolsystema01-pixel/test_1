-- =============================================================
-- 共通ID付与 v0.4 — ②住所判定＝area_master 直lookup（common_id/zone_no 付与）
--   対応: 第4章 全国配分。取込②『住所判定[common_id付与]』。付与タイミングは変更しない（取込直後・配車前）。
-- 実行: Supabase SQL Editor。前提=normalize_v0.sql・エリアマスタ取込 v0.1（area_master）・荷物取込済み。
--   ★まず【A. dry-run】→ 問題なければ【B. 本実行】。決定的・冪等。
-- =============================================================
-- v0.4 変更点:
--   ・②を area_master 直lookup（town_key→common_id/zone_no）に簡素化（集約masterが共通IDを直持ち）。
--   ・zone_no も deliveries に保存（⑤配達順 v0.3 が使う）。unit_no は保存しない（ユニット廃止）。
-- 突合方式（現実解＋高速化）:
--   deliveries は生住所のみ（構造化されない）ため、正規化住所を area_master.town_key へ
--   「前方一致・最長一致」で突合＝単一表 area_master からの直lookup。丁目粒度は本データでは町名どまり。
--   ★高速化：`na LIKE town_key||'%'`（インデックス不可・全スキャン）をやめ、
--     「住所naの接頭辞を各長さで生成 → town_key(主キー)と等値結合 → 最長一致を採用」に。
--     town_key は PK＝ハッシュ/インデックス結合が効き、81k×荷物件数のフルスキャンを回避。
--   ※ 住所に都道府県が無いデータが多い場合は town_key を自治体+町名側にも用意する調整が要る（要データ確認）。
-- =============================================================

-- 0) deliveries に zone_no 列を追加（common_id は既存）------------------------
alter table public.deliveries add column if not exists zone_no integer;
comment on column public.deliveries.zone_no is 'ゾーン番号（②付与・area_master由来）。⑤配達順の並びに使用';


-- =====================  A. dry-run（書き込まない）  ==========
-- 突合できる／できない件数のプレビュー（接頭辞生成＋town_key等値結合＝高速）。
with mx as (select max(length(town_key)) as m from public.area_master),
norm as (
  select d.tracking_number, public.normalize_addr(d.address) as na
  from public.deliveries d
),
prefixes as (
  select n.tracking_number, left(n.na, gs) as p, gs as plen
  from norm n, mx, generate_series(1, least(length(n.na), mx.m)) gs
),
cand as (
  select pr.tracking_number, a.common_id, a.zone_no, pr.plen
  from prefixes pr
  join public.area_master a on a.town_key = pr.p        -- ★PK等値結合（高速）
),
best as (
  select distinct on (n.tracking_number) n.tracking_number, c.common_id, c.zone_no
  from norm n
  left join cand c on c.tracking_number = n.tracking_number
  order by n.tracking_number, c.plen desc nulls last     -- 最長一致を採用
)
select
  count(*)                                     as deliveries,
  count(*) filter (where common_id is not null) as matched,
  count(*) filter (where common_id is null)     as unmatched,
  count(*) filter (where common_id is not null and zone_no is null) as matched_zone_missing
from best;
-- 期待: matched＝付与予定、unmatched＝保留予定、matched_zone_missing は把握用。


-- =====================  B. 本実行（付与＋保存＋保留）  =======
-- B-1) common_id / zone_no を付与（接頭辞生成＋town_key等値結合・最長一致）
with mx as (select max(length(town_key)) as m from public.area_master),
norm as (
  select d.tracking_number, public.normalize_addr(d.address) as na
  from public.deliveries d
),
prefixes as (
  select n.tracking_number, left(n.na, gs) as p, gs as plen
  from norm n, mx, generate_series(1, least(length(n.na), mx.m)) gs
),
cand as (
  select pr.tracking_number, a.common_id, a.zone_no, pr.plen
  from prefixes pr
  join public.area_master a on a.town_key = pr.p        -- ★PK等値結合（高速）
),
best as (
  select distinct on (tracking_number) tracking_number, common_id, zone_no
  from cand
  order by tracking_number, plen desc                   -- 最長一致を採用
)
update public.deliveries d
set common_id = b.common_id,
    zone_no   = b.zone_no
from best b
where b.tracking_number = d.tracking_number
  and b.common_id is not null;   -- 突合できた行だけ更新（未突合は下で保留）

-- B-2) 未突合を未登録住所に記録
insert into public.unregistered_addresses (tracking_number, address, normalized_address, reason)
select d.tracking_number, d.address, public.normalize_addr(d.address),
       '共通ID判定不能（town_key が area_master 未登録）'
from public.deliveries d
where d.common_id is null
on conflict (tracking_number) do nothing;

-- B-3) 未突合を保留（未配車/保留のみ対象＝進行中の状態は触らない）
update public.deliveries
set status = '保留'
where common_id is null and status in ('未配車','保留');

-- B-4) 件数
select
  (select count(*) from public.deliveries where common_id is not null) as assigned_common_id,
  (select count(*) from public.deliveries where zone_no  is not null)   as assigned_zone_no,
  (select count(*) from public.deliveries where common_id is null)      as unmatched,
  (select count(*) from public.deliveries where status = '保留')         as held;
