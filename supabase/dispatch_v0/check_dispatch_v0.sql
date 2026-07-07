-- =============================================================
-- 指示書: 配車 v0.5 — 手順 2/3：確認
--   配分・cap充足・隣接束ね・分割・仮ドライバー数・件数を実証する。
-- 実行: Supabase SQL Editor。dispatch_v0.sql（§A dry-run／§B 本実行）の後。
-- =============================================================

-- ① cap＝スキル×時間（承認のみ）。承認外DRV004が入らないこと ----------
select dd.driver_id, dd.skill, dd.hours, dd.cap,
       (dd.skill * dd.hours)::int as cap_expected,
       case when dd.cap = (dd.skill * dd.hours)::int then 'OK' else 'NG' end as judge
from public.dispatch_drivers dd
where dd.run_date = current_date and dd.driver_kind = '実'
order by dd.driver_id;
-- 期待: DRV001=160 / DRV002=108 / DRV003=176（全OK）

select count(*) as drv004_in_dispatch
from public.dispatch_drivers
where run_date = current_date and driver_id = 'DRV004';
-- 期待: 0（申請中はcapに入らない＝承認外除外）

-- ② ゾーン分割（閾値・1.8倍・2.6倍・以降ceil）-------------------------
select office_code, common_id, qty, threshold, split_count,
       case
         when qty <= threshold        then 1
         when qty <= 1.8 * threshold  then 2
         when qty <= 2.6 * threshold  then 3
         else ceil(qty::numeric / threshold)::int
       end as split_expected,
       case when split_count =
         case
           when qty <= threshold        then 1
           when qty <= 1.8 * threshold  then 2
           when qty <= 2.6 * threshold  then 3
           else ceil(qty::numeric / threshold)::int
         end then 'OK' else 'NG' end as judge
from public.dispatch_zones
where run_date = current_date
order by office_code, common_id;
-- 期待: OKZ_C split2 / TYT_C split2 / 他 split1（全OK）

-- ③ 処理能力優先：割当後 ≤ cap（実ドライバー）-----------------------
select dd.driver_id, dd.cap, dd.assigned_qty,
       case when dd.assigned_qty <= dd.cap then 'OK' else 'NG（cap超過）' end as judge
from public.dispatch_drivers dd
where dd.run_date = current_date and dd.driver_kind = '実'
order by dd.driver_id;
-- 期待: 全て assigned ≤ cap

-- ④ 隣接束ね（rank≤3）：rank>3が無いこと＋DRV003が2ゾーンを束ねること ---
select coalesce(max(assign_rank), 0) as max_rank,
       count(*) filter (where assign_rank > 3) as rank_gt3_count
from public.dispatch_assignments
where run_date = current_date;
-- 期待: max_rank ≤ 3 / rank_gt3_count = 0

select driver_id,
       count(distinct common_id) as zones,
       max(assign_rank)          as max_rank,
       count(*)                  as qty
from public.dispatch_assignments
where run_date = current_date and driver_kind = '実'
group by driver_id
order by driver_id;
-- 期待: DRV003 zones=2（TKI_C+CTA_C）/ max_rank=3 / qty=100（隣接束ね＋cap内）

-- ⑤ 仮ドライバー（推奨枠200で可視化）--------------------------------
select office_code, driver_id, assigned_qty
from public.dispatch_drivers
where run_date = current_date and driver_kind = '仮'
order by office_code, driver_id;
-- 期待: A01=仮1/仮2/仮3（各≤200・合計432）／ C01=なし

select count(*) filter (where driver_kind = '仮')                       as virtual_count,
       coalesce(max(assigned_qty) filter (where driver_kind = '仮'), 0) as max_chunk
from public.dispatch_drivers
where run_date = current_date;
-- 期待: virtual_count=3 / max_chunk ≤ 200

-- ⑥ 不足分析（仮が賄った分＝実capの不足）----------------------------
select office_code,
       sum(case when driver_kind='実' then cap          else 0 end) as real_cap,
       sum(case when driver_kind='実' then assigned_qty else 0 end) as real_assigned,
       sum(case when driver_kind='仮' then assigned_qty else 0 end) as shortage_by_virtual
from public.dispatch_drivers
where run_date = current_date
group by office_code order by office_code;
-- 期待: A01 real_cap=268/real_assigned=268/shortage=432  ｜ C01 real_cap=176/real_assigned=100/shortage=0

-- ⑦ 件数の総量保存（取りこぼし0）＋本実行のステータス -----------------
select
  (select count(*) from public.deliveries where tracking_number like 'DSP-%')                          as total,
  (select count(*) from public.deliveries where tracking_number like 'DSP-%' and status = '配車済')     as dispatched,
  (select count(*) from public.dispatch_assignments where run_date = current_date)                      as assignments;
-- 期待: total=800 / dispatched=800 / assignments=800（割当＝確定＝総量、欠落なし）
