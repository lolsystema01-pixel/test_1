-- =============================================================
-- 配達順の修正 v0.3 — 採番一式 v0.5 の renumber_build を「ソートキーだけ」差し替え
--   対応: 6.5（配達順）。③『住所自然順』→『ゾーン番号(zone_no)』に置換。ユニット番号は使わない。
-- 実行: Supabase SQL Editor。前提=採番一式 v0.5（renumber_build の§0オブジェクト・offices拡張）
--       ＋ 共通ID付与 v0.4（deliveries.zone_no 保存済み）。
-- =============================================================
-- 変更点は base CTE の row_number() の ORDER BY のみ：
--   旧: common_id → 時間指定 → 住所 → 問合番号
--   新: common_id → 時間指定 → zone_no(昇順・NULLは末尾) → 住所(tiebreak) → 問合番号
-- 採番本体（連番・かご記号・office_seq・冪等・dry-run/本実行）は v0.5 のまま（無改修）。
-- ※本ファイルは renumber_build を再定義するだけ。実行(dry-run/本実行)は採番一式 v0.5 の §A/§B を使う。
-- =============================================================

create or replace function public.renumber_build(p_date date)
returns void language plpgsql as $$
begin
  delete from public.renumber_plan where run_date = p_date;

  insert into public.renumber_plan
    (run_date, tracking_number, office_code, driver_id, driver_kind, common_id, delivery_order, basket_index, office_seq, basket_code)
  with base as (
    -- ① 配達順：ドライバー×当日で 共通ID→時間→【zone_no】→住所→問合番号 の順に連番
    select
      d.tracking_number, d.office_code, d.driver_id, d.common_id, d.time_window, d.address,
      o.basket_order,
      greatest(1, least(500, coalesce(o.basket_cart_limit, 50)))  as cart_limit,  -- 1かご個数
      o.basket_code_format as fmt, o.basket_code_prefix as pfx, o.basket_code_digits as digs,
      row_number() over (
        partition by d.driver_id
        order by d.common_id,
                 public.time_window_rank(d.time_window),
                 d.zone_no asc nulls last,          -- ★③ 旧『住所自然順』→ ゾーン番号（保留=NULLは末尾）
                 d.address,                          -- ④ 同一ゾーン内の最終tiebreak（住所）
                 d.tracking_number                   -- ⑤ タイブレーク
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
                || coalesce(address, '') ) as min_key
    from wb
    group by office_code, driver_id, basket_order, fmt, pfx, digs
  ),
  drank as (
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

comment on function public.renumber_build(date) is
  '採番一式v0.5＋配達順修正v0.3：配達順ソートを common_id→時間→zone_no→住所→問合番号 に（③住所をzone_noへ置換）';
