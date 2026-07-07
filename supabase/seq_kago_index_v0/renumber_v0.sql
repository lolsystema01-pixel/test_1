-- =============================================================
-- 指示書: 配達順・かご記号 採番＋問合Index同期 v0.5 — 手順 1/3：採番エンジン
--   対応: 要件定義 6.5（本実行の後段：配達順→かご記号→問合Index同期）
--   準拠: 現行GAS 25_delivery_order.js（候補C）/ 26_basket_management.js（営業所内通し番号方式）
-- 実行: Supabase SQL Editor。前提=配車 v0 本実行済み（deliveries に driver_id・status=配車済）。
-- =============================================================
-- ・配達順: ドライバー×当日でパーティションし ROW_NUMBER（決定的・冪等）。
--     並び＝① 共通ID(自然順) → ② 時間指定ランク → ③ 住所 → ④ 問合番号（タイブレーク）。
-- ・かご記号: 営業所内通し番号方式。各ドライバーの担当を配達順で「1かご個数」(=かご台車上限)
--     ごとに区切り（basketIndex=ceil(配達順/1かご個数)）、ドライバーを「かご振り順」で並べ、
--     営業所内で通し番号を1ずつ加算→記号化（連続A,B,C…／数字 等。設定）。
-- ・問合Index同期: 問合番号→ドライバー・配達順・かご記号・共通ID を上書き（冪等）。
-- ・二段階: 【A】dry-run（書き込まずプレビュー）→【B】本実行（deliveries更新＋Index同期）。
-- まとめ単位はかご記号に一本化（バッグ番号・親バッグは使わない）。セットベースSQL。
-- =============================================================


-- =============================================================
-- §0. 前提オブジェクト（営業所のかご記号設定・関数・作業テーブル）
-- =============================================================

-- 0-1) 営業所のかご記号形式の設定列（無ければ追加。アルファベット既定）-----------
alter table public.offices add column if not exists basket_code_format text not null default 'アルファベット'; -- アルファベット/数字
alter table public.offices add column if not exists basket_code_prefix text;                                  -- 例: 'M'
alter table public.offices add column if not exists basket_code_digits integer;                               -- 数字形式のゼロ埋め桁
comment on column public.offices.basket_code_format is 'かご記号形式（アルファベット既定／数字）';

-- 0-2) 通し番号→かご記号（アルファベット：1→A…26→Z→27→AA…の bijective base26）----
create or replace function public.to_basket_alpha(n integer)
returns text language plpgsql immutable as $$
declare s text := ''; x integer := n;
begin
  if x is null or x < 1 then return null; end if;
  while x > 0 loop
    x := x - 1;
    s := chr(65 + (x % 26)) || s;
    x := x / 26;
  end loop;
  return s;
end $$;

-- 0-3) 記号化（形式・接頭辞・桁数の設定に従う）--------------------------------
create or replace function public.basket_symbol(n integer, fmt text, prefix text, digits integer)
returns text language sql immutable as $$
  select case
    when fmt = '数字' then
      coalesce(prefix, '') ||
      case when coalesce(digits, 0) > 0 then lpad(n::text, digits, '0') else n::text end
    else
      coalesce(prefix, '') || public.to_basket_alpha(n)
  end;
$$;

-- 0-4) 時間指定→ランク（早い順。例 9:00-12:00→900／午前→800／午後→1300／無→9999）--
create or replace function public.time_window_rank(tw text)
returns integer language sql immutable as $$
  select case
    when tw is null or btrim(tw) = '' then 9999
    when tw ~ '^\s*\d{1,2}:'         then (substring(tw from '^\s*(\d{1,2}):'))::int * 100
    when tw like '%午前%'            then 800
    when tw like '%午後%'            then 1300
    when tw like '%夜間%'            then 1800
    else 9999
  end;
$$;

-- 0-5) 採番プラン（dry-run/本実行 共通。run_date 単位で作り直す）-----------------
create table if not exists public.renumber_plan (
  run_date        date    not null,
  tracking_number text    not null,
  office_code     text,
  driver_id       text,
  driver_kind     text,                 -- 実/仮
  common_id       text,
  delivery_order  integer,
  basket_index    integer,              -- ドライバー内のかご番号(1..)
  office_seq      integer,              -- 営業所内のかご通し番号(1..)
  basket_code     text,
  primary key (run_date, tracking_number)
);
alter table public.renumber_plan enable row level security;   -- 前提A：全テーブルRLS
grant select on public.renumber_plan to authenticated;
drop policy if exists renumber_plan_hq on public.renumber_plan;
create policy renumber_plan_hq on public.renumber_plan for select to authenticated using ( public.my_role() = 'hq' );

-- 0-6) 採番計算本体（deliveries は更新しない。作業表 renumber_plan を作る）--------
create or replace function public.renumber_build(p_date date)
returns void language plpgsql as $$
begin
  delete from public.renumber_plan where run_date = p_date;

  insert into public.renumber_plan
    (run_date, tracking_number, office_code, driver_id, driver_kind, common_id, delivery_order, basket_index, office_seq, basket_code)
  with base as (
    -- ① 配達順：ドライバー×当日で 共通ID→時間→住所→問合番号 の順に連番
    select
      d.tracking_number, d.office_code, d.driver_id, d.common_id, d.time_window, d.address,
      o.basket_order,
      greatest(1, least(500, coalesce(o.basket_cart_limit, 50)))  as cart_limit,  -- 1かご個数
      o.basket_code_format as fmt, o.basket_code_prefix as pfx, o.basket_code_digits as digs,
      row_number() over (
        partition by d.driver_id
        order by d.common_id, public.time_window_rank(d.time_window), d.address, d.tracking_number
      ) as delivery_order
    from public.deliveries d
    join public.offices o on o.office_code = d.office_code
    where d.status = '配車済' and d.delivery_date = p_date and d.driver_id is not null
  ),
  wb as (
    -- かご番号（ドライバー内）：basketIndex = ceil(配達順 / 1かご個数)
    select *, ceil(delivery_order::numeric / cart_limit)::int as basket_index
    from base
  ),
  drv as (
    -- ドライバー単位の集計（かご振り順の並べ替えキー）
    select office_code, driver_id, basket_order, fmt, pfx, digs,
           count(*)            as cnt,
           max(basket_index)   as bcount,
           min(common_id)      as min_zone,
           min( lpad(common_id, 16, ' ')
                || lpad(public.time_window_rank(time_window)::text, 5, '0')
                || coalesce(address, '') ) as min_key   -- 先頭配達順の代表キー
    from wb
    group by office_code, driver_id, basket_order, fmt, pfx, digs
  ),
  drank as (
    -- かご振り順でドライバーを並べる（ドライバー順=件数多い順／配達順順=先頭配達順早い順／ゾーン順=先頭共通ID順。同点は名前順）
    select *,
      row_number() over (
        partition by office_code
        order by
          case when basket_order = 'ドライバー順' then cnt     end desc,
          case when basket_order = '配達順順'     then min_key end asc,
          case when basket_order = 'ゾーン順'     then min_zone end asc,
          driver_id
      ) as dr
    from drv
  ),
  pref as (
    -- 自分より前のドライバーのかご数の累計（＝営業所内通し番号の起点）
    select *,
      coalesce(sum(bcount) over (partition by office_code order by dr
               rows between unbounded preceding and 1 preceding), 0) as base_seq
    from drank
  )
  select
    p_date, wb.tracking_number, wb.office_code, wb.driver_id,
    case when wb.driver_id like '仮%' then '仮' else '実' end,
    wb.common_id, wb.delivery_order, wb.basket_index,
    (pr.base_seq + wb.basket_index)::int as office_seq,
    public.basket_symbol((pr.base_seq + wb.basket_index)::int, pr.fmt, pr.pfx, pr.digs) as basket_code
  from wb
  join pref pr on pr.office_code = wb.office_code and pr.driver_id = wb.driver_id;
end $$;


-- =============================================================
-- §検証準備（任意・ダミーのみ）: 時間指定の付与とかご記号形式の例
--   ・②時間ランクを検証できるよう、当日DSPダミーに時間指定を散らす。
--   ・C01 を「数字形式 M01,M02…」にしてかご記号形式の設定を実証（A01はアルファベット既定）。
-- =============================================================
update public.deliveries
set time_window = case right(tracking_number, 1)
                    when '1' then '午前'
                    when '2' then '午前'
                    when '3' then '9:00-12:00'
                    when '4' then '9:00-12:00'
                    when '5' then '午後'
                    else null end
where tracking_number like 'DSP-%' and delivery_date = current_date;

update public.offices
set basket_code_format = '数字', basket_code_prefix = 'M', basket_code_digits = 2
where office_code = 'C01';


-- =============================================================
-- §A. dry-run（書き込まない。ドライバー別の配達順・かご記号・各かご個数をプレビュー）
-- =============================================================
select public.renumber_build(current_date);

-- A-1) ドライバー別サマリ（件数・かご数・配達順範囲・かご記号）
select office_code, driver_id, driver_kind,
       count(*)            as 件数,
       max(basket_index)   as かご数,
       min(delivery_order) as 配達順min,
       max(delivery_order) as 配達順max,
       string_agg(distinct basket_code, ',' order by basket_code) as かご記号
from public.renumber_plan where run_date = current_date
group by office_code, driver_id, driver_kind
order by office_code, driver_id;

-- A-2) 各かごの個数（1かご個数=かご台車上限 を超えない）
select office_code, driver_id, basket_code, count(*) as 個数
from public.renumber_plan where run_date = current_date
group by office_code, driver_id, basket_code
order by office_code, driver_id, min(office_seq);

-- A-3) dry-run では deliveries 未更新（配達順がまだ入っていない）
select count(*) as 未採番のまま
from public.deliveries
where delivery_date = current_date and tracking_number like 'DSP-%' and delivery_order is null;


-- =============================================================
-- §B. 本実行（確定）：deliveries へ配達順・かご記号を書き込み、問合Indexへ同期
-- =============================================================
select public.renumber_build(current_date);

-- B-1) deliveries へ採番を反映
update public.deliveries d
set delivery_order = p.delivery_order,
    basket_code    = p.basket_code
from public.renumber_plan p
where p.run_date = current_date and p.tracking_number = d.tracking_number;

-- B-2) 問合Index同期（問合番号→ドライバー・配達順・かご記号・共通ID。冪等上書き）
insert into public.delivery_index (tracking_number, driver_id, delivery_order, basket_code, common_id)
select p.tracking_number, p.driver_id, p.delivery_order, p.basket_code, p.common_id
from public.renumber_plan p
where p.run_date = current_date
on conflict (tracking_number) do update set
  driver_id      = excluded.driver_id,
  delivery_order = excluded.delivery_order,
  basket_code    = excluded.basket_code,
  common_id      = excluded.common_id;

-- B-3) 同期件数
select count(*) as plan_rows  from public.renumber_plan  where run_date = current_date;
select count(*) as index_rows from public.delivery_index di
  join public.deliveries d on d.tracking_number = di.tracking_number
  where d.delivery_date = current_date;
-- 期待: plan_rows = index_rows（当日分が一致）
