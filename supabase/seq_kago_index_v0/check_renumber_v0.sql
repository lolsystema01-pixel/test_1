-- =============================================================
-- 指示書: 採番＋問合Index同期 v0.5 — 手順 3/3：確認
--   配達順の連番・かご記号の繰上げ・問合Index一致・件数 を実証する。
-- 実行: Supabase SQL Editor。renumber_v0.sql（§B 本実行）と index_today_v0.sql の後。
-- =============================================================

-- ① 配達順：ドライバーごとに 1..N の連番（欠番・重複なし）------------
select driver_id,
       count(*)                    as 件数,
       min(delivery_order)         as 最小,
       max(delivery_order)         as 最大,
       count(distinct delivery_order) as 異なり数,
       case when min(delivery_order) = 1
             and max(delivery_order) = count(*)
             and count(distinct delivery_order) = count(*)
            then 'OK' else 'NG' end as judge
from public.deliveries
where status = '配車済' and delivery_date = current_date and driver_id is not null
group by driver_id
order by driver_id;
-- 期待: 全ドライバー（実/仮）で 最小=1・最大=件数・異なり数=件数（連番・冪等）

-- ② かご記号：営業所内で通し番号が連続（1..最大・重複なし）----------
select office_code,
       min(office_seq)              as 最小,
       max(office_seq)              as 最大,
       count(distinct office_seq)   as 異なりかご数,
       count(distinct basket_code)  as 異なり記号数,
       case when min(office_seq) = 1
             and count(distinct office_seq) = max(office_seq)
             and count(distinct basket_code) = count(distinct office_seq)
            then 'OK' else 'NG' end as judge
from public.renumber_plan
where run_date = current_date
group by office_code
order by office_code;
-- 期待: 営業所内で 1..最大 が連続・記号も一意（A,B,C…／M01,M02…）

-- ②' 各かごが「1かご個数」(=かご台車上限)を超えない -----------------
select rp.office_code, rp.driver_id, rp.basket_code, count(*) as 個数,
       o.basket_cart_limit as かご台車上限,
       case when count(*) <= greatest(1, least(500, coalesce(o.basket_cart_limit,50))) then 'OK' else 'NG' end as judge
from public.renumber_plan rp
join public.offices o on o.office_code = rp.office_code
where rp.run_date = current_date
group by rp.office_code, rp.driver_id, rp.basket_code, o.basket_cart_limit
order by max(rp.office_seq)
limit 50;
-- 期待: 全かごの個数 ≤ かご台車上限

-- ③ 問合Index一致：当日分が deliveries と完全一致（冪等同期）--------
select count(*) as 不一致
from public.delivery_index di
join public.deliveries d on d.tracking_number = di.tracking_number
where d.delivery_date = current_date
  and ( di.driver_id      is distinct from d.driver_id
     or di.delivery_order is distinct from d.delivery_order
     or di.basket_code    is distinct from d.basket_code
     or di.common_id      is distinct from d.common_id );
-- 期待: 0（問合番号→ドライバー・配達順・かご記号・共通ID が一致）

-- ④ 当日一括取得ビュー：当日分だけが取れる ------------------------
select
  (select count(*) from public.index_today)                                                         as today_view,
  (select count(*) from public.delivery_index di join public.deliveries d
     on d.tracking_number = di.tracking_number where d.delivery_date = current_date)                as today_index,
  (select count(*) from public.delivery_index di join public.deliveries d
     on d.tracking_number = di.tracking_number where d.delivery_date <> current_date)               as other_day_index;
-- 期待: today_view = today_index（当日のみ）／ other_day_index は対象外（ビューに出ない）

-- ⑤ まとめ単位＝かご記号に一本化（バッグ番号・親バッグ列が無い）----
select count(*) as bag_like_columns
from information_schema.columns
where table_schema = 'public' and table_name = 'deliveries'
  and (column_name ilike '%bag%' or column_name ilike '%bag_parent%' or column_name ilike '%親バッグ%');
-- 期待: 0（バッグ番号・親バッグは持たない）
