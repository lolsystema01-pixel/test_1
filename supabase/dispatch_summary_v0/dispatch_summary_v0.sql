-- =============================================================
-- 指示書: 配車サマリ（仮割当・保留・希望外の検出と表示）v0.2 — 集計ビュー（deliveries ベース）
--   §12.5.3。配車結果を deliveries（確定実績・既存の役割別RLS）から読んで検出・集計するだけ（割当はしない）。
-- 実行: Supabase SQL Editor（postgres）で丸ごと Run。冪等（create or replace view）。
-- =============================================================
-- 【固定の前提】新基盤・検証環境のみ・本番/現行GASは触らない・全テーブルRLS（読取ロール別）・秘密は環境変数。
--
-- 【v0.1→v0.2 の再定義（現状の実体に整合）】
--   配車後の『未割当（実にも仮にも割り当たっていない）』は構造上ゼロと判明したため作らない。
--   指標を 仮割当／保留／希望外 に再定義し、正は **deliveries** とする（dispatch_* は hq限定RLSで
--   security_invoker 化が要るため第2段送り＝本ビューは触らない）。
--
-- 【3指標（対象日×自営業所）】
--   ・仮割当 = deliveries.driver_id LIKE '仮%'（実で捌けない＝要員不足。0が理想）。
--       ★office_home_summary（概況カード）の「仮配車」と同一定義＝件数・人数が一致する。
--   ・保留   = common_id IS NULL かつ status='保留'（住所が引けず配車の土俵に乗らない＝マスタ不備）。
--   ・希望外 = 割当 common_id が担当ドライバーの preferred_areas に無い（実ドライバーのみ）。
--       #28／シフト v0.7 実装後に有効（preferred_areas にデータが入るまで常に0）。
--
-- 【希望外の条件（#28 と同一・業務A確定 2026-07-20）】
--   実ドライバーのみ・preferred_areas が NULL（希望未指定）は数えない・common_id が preferred_areas に無い。
--   preferred_areas は work_schedules（driver_id×work_date=delivery_date・承認）から引く。
--   1日1稼働 UNIQUE(driver_id, work_date) により (driver,date) の承認稼働は一意＝join で行が増えない。
--
-- 【RLS】security_invoker=on ＝ 呼び出し元の deliveries RLS をそのまま継承（area は自営業所のみ）。
-- =============================================================


-- =============================================================
-- §1. dispatch_summary — 対象日×自営業所の3指標（ヘッドライン）
-- =============================================================
create or replace view public.dispatch_summary
with (security_invoker = on) as
select
  d.office_code,
  d.delivery_date,
  count(*)                                                                 as received,          -- 受信件数
  count(*) filter (where d.driver_id like '仮%')                          as virtual_items,     -- 仮割当 件数
  count(distinct d.driver_id) filter (where d.driver_id like '仮%')       as virtual_drivers,   -- 仮割当 人数
  count(*) filter (where d.common_id is null and d.status = '保留')       as hold_items,        -- 保留 件数
  count(*) filter (                                                                              -- 希望外 件数
    where d.driver_id is not null and d.driver_id not like '仮%'
      and d.common_id is not null
      and ws.preferred_areas is not null
      and not (d.common_id = any(ws.preferred_areas))
  )                                                                        as off_preference_items
from public.deliveries d
left join public.work_schedules ws
  on ws.driver_id = d.driver_id
 and ws.work_date = d.delivery_date
 and ws.application_status = '承認'
group by d.office_code, d.delivery_date;

comment on view public.dispatch_summary is
  '配車サマリ3指標（§12.5.3・対象日×自営業所）: 仮割当(driver_id LIKE 仮%・概況カードと同定義)／'
  '保留(common_id NULL かつ status=保留)／希望外(実・common_id が preferred_areas に無い・NULLは数えない)。'
  'deliveries ベース・security_invoker=on で既存RLS継承。希望外は #28/シフトv0.7 実装後に点灯（それまで0）';

grant select on public.dispatch_summary to authenticated;


-- =============================================================
-- §2. dispatch_summary_by_driver — ドライバー別内訳（担当件数・仮か・希望外件数）
--   概況カードは営業所全体の1行。本ビューはその内訳（ドライバー別）を担う。
-- =============================================================
create or replace view public.dispatch_summary_by_driver
with (security_invoker = on) as
select
  d.office_code,
  d.delivery_date,
  d.driver_id,
  (d.driver_id like '仮%')                                                as is_virtual,        -- 仮ドライバーか
  count(*)                                                                as items,             -- 担当件数
  count(*) filter (                                                                              -- 希望外 件数（実のみ）
    where d.driver_id not like '仮%'
      and d.common_id is not null
      and ws.preferred_areas is not null
      and not (d.common_id = any(ws.preferred_areas))
  )                                                                        as off_preference_items
from public.deliveries d
left join public.work_schedules ws
  on ws.driver_id = d.driver_id
 and ws.work_date = d.delivery_date
 and ws.application_status = '承認'
where d.driver_id is not null
group by d.office_code, d.delivery_date, d.driver_id;

comment on view public.dispatch_summary_by_driver is
  '配車サマリ ドライバー別内訳（§12.5.3）: 担当件数・仮か(is_virtual)・希望外件数。deliveries ベース・security_invoker=on';

grant select on public.dispatch_summary_by_driver to authenticated;


-- =============================================================
-- §3. dispatch_summary_detail — 明細（配送物ごとにカテゴリを付す。3指標の一覧の元）
--   運用者が中身を確認して判断できる粒度。category でフィルタして 仮割当/保留/希望外 の一覧にする。
--   カテゴリは排他（仮ドライバーは preferred_areas を持たないので希望外にならない＝順序判定でよい）。
-- =============================================================
create or replace view public.dispatch_summary_detail
with (security_invoker = on) as
select
  d.office_code,
  d.delivery_date,
  d.tracking_number,
  d.common_id,
  d.driver_id,
  d.status,
  case
    when d.driver_id like '仮%'                          then '仮割当'
    when d.common_id is null and d.status = '保留'        then '保留'
    when d.driver_id is not null and d.driver_id not like '仮%'
      and d.common_id is not null
      and ws.preferred_areas is not null
      and not (d.common_id = any(ws.preferred_areas))    then '希望外'
    else '正常'
  end                                                                     as category
from public.deliveries d
left join public.work_schedules ws
  on ws.driver_id = d.driver_id
 and ws.work_date = d.delivery_date
 and ws.application_status = '承認';

comment on view public.dispatch_summary_detail is
  '配車サマリ明細（§12.5.3）: 配送物ごとに category（仮割当／保留／希望外／正常）を付す。3指標の明細一覧の元。security_invoker=on';

grant select on public.dispatch_summary_detail to authenticated;


-- =============================================================
-- §4. 確認（対象日を指定して3指標を見る・概況カードとの一致確認は check_dispatch_summary_v0.sql）
-- =============================================================
-- select * from public.dispatch_summary where delivery_date = date '<対象日>';
-- 期待: 仮割当・保留・希望外の3件数が出る。仮割当は概況カード（office_home_summary の仮配車）と一致。
