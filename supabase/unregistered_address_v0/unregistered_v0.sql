-- =============================================================
-- 指示書: 未登録住所の記録・修正フロー v0
--   判定不能だった住所を記録し、一覧→修正→再判定で解消する。
--   住所確認中（保留）の荷物を取りこぼさず管理する。
--   対応: 要件定義 6.3 前半（未登録住所の一覧・修正・エリア再判定）/ 9.1（未登録住所）/ 6.2（再判定）
-- 実行: SQL Editor。住所判定 v0.2 ＋ 拠点振分 v0.2 の後。
--   ★ §1〜§3（記録・一覧）→【人】§4で住所を修正 → §5 再判定 → §6 件数 の順。
--   各ブロックを選択して Ctrl/Cmd+Enter で個別実行。
-- =============================================================
-- 用語: 未登録住所 / 対応区分(reason) / 対応済み(resolved) / メモ(note) / 保留 / 共通ID
-- 既存IF: public.unregistered_addresses（normalize_v0.sql ②で作成済み）
--   tracking_number(PK,FK) / address / normalized_address / reason / resolved / note / created_at
-- =============================================================


-- =============================================================
-- §1. 未登録住所テーブル（無ければ作成。既にあれば何もしない）
--   要件9.1: 問合番号・住所・対応区分・対応済み・メモ
-- =============================================================
create table if not exists public.unregistered_addresses (
  tracking_number    text primary key references public.deliveries(tracking_number) on delete cascade,
  address            text,
  normalized_address text,
  reason             text,                            -- 対応区分（判定不能の理由）
  resolved           boolean not null default false,  -- 対応済み
  note               text,                            -- メモ
  created_at         timestamptz not null default now()
);


-- =============================================================
-- §2. 記録（再同期）：判定不能で保留の荷物を未登録住所に取り込む
--   住所判定側で既に記録済みのIFに合わせ、漏れがあれば補う（冪等）。
--   ・対象＝共通ID未付与（判定不能）の荷物。荷物は保留（住所確認中）。
-- =============================================================
insert into public.unregistered_addresses (tracking_number, address, normalized_address, reason)
select d.tracking_number, d.address, public.normalize_addr(d.address),
       '住所不明（自治体＋町名がMaster未登録）'
from public.deliveries d
where d.common_id is null
on conflict (tracking_number) do nothing;

-- 念のため、判定不能荷物は保留にしておく（取りこぼさない）
update public.deliveries set status = '保留' where common_id is null and status <> '保留';

-- 記録件数
select count(*) as unregistered_total,
       count(*) filter (where resolved = false) as unresolved
from public.unregistered_addresses;
-- 期待（初回）: unregistered_total=2 / unresolved=2（名古屋市栄・存在しない町）


-- =============================================================
-- §3. 一覧：未対応（対応済み=false）の未登録住所
--   【人】これを見て、正しい住所／対応区分を判断する。
-- =============================================================
select u.tracking_number,
       u.address,
       u.reason,
       u.note,
       d.status
from public.unregistered_addresses u
join public.deliveries d on d.tracking_number = u.tracking_number
where u.resolved = false
order by u.tracking_number;


-- =============================================================
-- §4. 修正【人が編集して実行】：住所を直す＋メモ追記
--   §3の一覧で確認した問合番号を指定し、正しい住所に置き換える。
--   ※下の2つは「例」。実際の問合番号・正しい住所に書き換えて実行する。
-- -------------------------------------------------------------
--   例A）解消するケース: Master未登録の町名を、実在する町（岡崎市箱柳町）へ修正
update public.deliveries
set address = '愛知県岡崎市箱柳町1-1'                       -- ← 正しい住所に書き換え
where tracking_number = '271002558810';        -- ← §3の問合番号

update public.unregistered_addresses
set note = coalesce(note,'') || '[修正] 正しい町名へ訂正（再判定）'
where tracking_number = '271002558810';

--   例B）解消しないケース: 名古屋市栄 はMaster未収録のまま → 修正しても保留に残る（取りこぼさない実証）
--   （対応区分だけ更新して保留を継続する場合の例）
update public.unregistered_addresses
set reason = '住所不備（Master未収録エリア・要マスタ追加）',
    note   = coalesce(note,'') || '[確認] 名古屋市はMaster未収録のため保留継続'
where tracking_number = '279113440026';


-- =============================================================
-- §5. 再判定：保留荷物に 住所→共通ID→拠点→営業所 を再適用
--   ・対象＝共通ID未付与（保留）の荷物のみ（既に解決済みは触らない）。
--   ・住所判定(match_v0)＋拠点振分(assign_office_v0)と同一ロジックを再適用。
-- -------------------------------------------------------------

-- §5-1) 住所→共通ID（正規化して前方一致・最長一致採用。match_v0 と同一規則）
with norm as (
  select tracking_number, public.normalize_addr(address) as na
  from public.deliveries
  where common_id is null
),
cand as (
  select n.tracking_number, m.common_id,
         length(public.normalize_addr(coalesce(m.prefecture,'')||coalesce(m.municipality,'')||coalesce(m.town,''))) as keylen
  from norm n
  join public.address_master m
    on n.na like public.normalize_addr(coalesce(m.prefecture,'')||coalesce(m.municipality,'')||coalesce(m.town,'')) || '%'
),
best as (
  select distinct on (tracking_number) tracking_number, common_id
  from cand order by tracking_number, keylen desc
)
update public.deliveries d
set common_id = b.common_id
from best b
where b.tracking_number = d.tracking_number;

-- §5-2) 共通ID→拠点→営業所（assign_office_v0 と同一経路。新たに共通IDが付いた分だけ）
update public.deliveries d
set depot_code  = z.depot_code,
    office_code = o.office_code
from public.zone_plan z
join public.offices   o on o.depot_code = z.depot_code
where z.common_id = d.common_id
  and d.common_id is not null
  and d.office_code is null;

-- §5-3) 解消した荷物（共通ID＋営業所まで付いた）を 未配車 に戻す
update public.deliveries
set status = '未配車'
where common_id is not null
  and office_code is not null
  and status = '保留';

-- §5-4) 未登録住所の「対応済み」を更新（解消＝共通IDが付いた分）
update public.unregistered_addresses u
set resolved = true
from public.deliveries d
where d.tracking_number = u.tracking_number
  and d.common_id is not null;


-- =============================================================
-- §6. 件数：保留・解消の管理（数で出す）
-- =============================================================
select
  (select count(*) from public.unregistered_addresses)                       as unregistered_total, -- 未登録 累計
  (select count(*) from public.unregistered_addresses where resolved = true)  as resolved_cnt,       -- 解消（対応済み）
  (select count(*) from public.unregistered_addresses where resolved = false) as unresolved,         -- 未対応（残）
  (select count(*) from public.deliveries where status = '保留')              as held_now;           -- 保留中の荷物
-- 期待（例: 1件を実在住所へ修正・1件は未収録のまま）: resolved_cnt=1 / unresolved=1 / held_now=1
