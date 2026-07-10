-- =============================================================
-- 指示書: 営業所ホーム 概況カード v0.1 — 手順 1/4：集計ビュー
--   対応: 要件定義 §12.0.1 概況カード（状態行・受信件数・配車済み・仮配車・最終配車実行・再予測合図）
-- 実行: Supabase SQL Editor。前提=配車 v0.5／採番 v0.5／status_log v0.1 実機済み。
-- =============================================================
-- 【指示書の抽象テーブル → 本基盤の実テーブル マッピング】
--   parcels（受信・imported_at）        → public.deliveries（+ imported_at 列を追加）
--   dispatches（実/仮ドライバー・status）→ public.deliveries.driver_id（'仮%'=仮ドライバー）
--   dispatches.assigned_at（最終配車実行）→ delivery_status_log.max(changed_at) where source='配車'
--   再予測合図                          → 最新受信(imported_at) > 最終配車実行(assigned_at)
-- ・area ロールが自営業所のみ見えるよう security_invoker=on（deliveries/status_log のRLSを継承）。
-- ・対象日(delivery_date)の絞り込みはフロント側で `.eq('delivery_date', 対象日)`。
-- ・読むだけ（集計）。処理本体（予測配車=#25／仕分け／出力）は各機能。書き込みRLS不要。
-- =============================================================


-- =============================================================
-- §0. 受信時刻 imported_at（再予測合図の基準。無ければ追加・既定 now()）
--   ※ 既存行は alter 実行時の now() が入る。新規取込・seed では明示的に入れる。
-- =============================================================
alter table public.deliveries
  add column if not exists imported_at timestamptz default now();
comment on column public.deliveries.imported_at is '受信時刻（取込時刻）。再予測合図＝最新受信 > 最終配車実行 の基準';


-- =============================================================
-- §1. 概況カード集計ビュー（対象日 × 自営業所）
--   受信件数／配車済み(実ドライバー 人数・件数)／仮配車(仮ドライバー 人数・件数)／
--   最終配車実行／再予測合図／状態行(＋色) を1行で返す。
-- =============================================================
create or replace view public.office_home_summary
with (security_invoker = on) as
with base as (
  -- 受信・配車済み・仮配車・仕分済 の件数/人数（deliveries を office×date で集計）
  select
    d.office_code,
    d.delivery_date,
    count(*)                                                                          as received,        -- 受信件数（parcels）
    count(*) filter (where d.driver_id is not null and d.driver_id not like '仮%')     as real_items,      -- 配車済み 件数（実ドライバー）
    count(distinct d.driver_id) filter (where d.driver_id is not null and d.driver_id not like '仮%')
                                                                                       as real_drivers,    -- 配車済み 人数（実ドライバー）
    count(*) filter (where d.driver_id like '仮%')                                     as virt_items,      -- 仮配車 件数（仮ドライバー）
    count(distinct d.driver_id) filter (where d.driver_id like '仮%')                  as virt_drivers,    -- 仮配車 人数（仮ドライバー）
    count(*) filter (where d.driver_id is not null)                                   as dispatched_items,-- 配車済み総数（実＋仮）
    count(*) filter (where d.status = '仕分済')                                        as sorted_items,    -- 仕分済 件数
    max(d.imported_at)                                                                as last_import_at   -- 最新受信時刻
  from public.deliveries d
  group by d.office_code, d.delivery_date
),
disp as (
  -- 最終配車実行：配車ログ（source='配車'）の最新時刻を office×date で
  select d.office_code, d.delivery_date, max(l.changed_at) as last_dispatch_at
  from public.delivery_status_log l
  join public.deliveries d on d.tracking_number = l.tracking_number
  where l.source = '配車'
  group by d.office_code, d.delivery_date
)
select
  b.office_code,
  b.delivery_date,
  b.received,
  b.real_drivers,
  b.real_items,
  b.virt_drivers,
  b.virt_items,
  b.dispatched_items,
  b.sorted_items,
  dp.last_dispatch_at,                                                                 -- 最終配車実行（null=未実行）
  b.last_import_at,
  -- 再予測合図：配車実行済み かつ その後に新規受信があった（§12.5.6／§15.1B）
  (dp.last_dispatch_at is not null and b.last_import_at > dp.last_dispatch_at)         as need_repredict,
  -- 状態行：データから『いま行うべき作業』を導出（§12.0.1）
  case
    when b.received = 0                                                    then '本日の受信はありません'
    when b.dispatched_items = 0                                            then '予測配車を実行してください'
    when dp.last_dispatch_at is not null and b.last_import_at > dp.last_dispatch_at
                                                                          then '再予測してください'
    when b.sorted_items = b.dispatched_items                               then '仕分け完了・出力可能'
    else                                                                       '仕分けを進めてください'
  end                                                                                  as state_line,
  -- 色：青=作業中／緑=完了
  case
    when b.received = 0                                                    then '緑'
    when b.sorted_items = b.dispatched_items
         and not (dp.last_dispatch_at is not null and b.last_import_at > dp.last_dispatch_at)
         and b.dispatched_items > 0                                        then '緑'
    else                                                                       '青'
  end                                                                                  as state_color
from base b
left join disp dp on dp.office_code = b.office_code and dp.delivery_date = b.delivery_date;

comment on view public.office_home_summary is
  '営業所ホーム概況カード：対象日×自営業所の 受信/配車済(人数件数)/仮配車(人数件数)/最終配車実行/再予測合図/状態行（area RLS）';

grant select on public.office_home_summary to authenticated;


-- =============================================================
-- §2. Realtime（Supabase専用）：deliveries / delivery_status_log の変更を購読可能に
--   ※ pglite 対象外。Supabase の publication supabase_realtime に冪等追加。
--   ※ 変更の可視範囲は各テーブルのRLSに従う（area=自営業所のみ通知）。
-- =============================================================
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname='supabase_realtime' and schemaname='public' and tablename='deliveries') then
    alter publication supabase_realtime add table public.deliveries;
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname='supabase_realtime' and schemaname='public' and tablename='delivery_status_log') then
    alter publication supabase_realtime add table public.delivery_status_log;
  end if;
exception when undefined_object then
  raise notice 'publication supabase_realtime が無い環境のためスキップ（ローカル等）';
end $$;


-- 確認（当日・営業所別）------------------------------------------------
select office_code, delivery_date, received, real_drivers, real_items,
       virt_drivers, virt_items, last_dispatch_at, need_repredict, state_line, state_color
from public.office_home_summary
where delivery_date = current_date
order by office_code;
