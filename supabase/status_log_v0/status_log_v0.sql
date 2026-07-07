-- =============================================================
-- 配達実績の記録口（ステータス遷移）v0 — ① 遷移ログ表 delivery_status_log
--   対応: 要件定義 6.10 第1項（T1段階からステータス遷移を一貫した記録口で記録）。
-- 実行: Supabase SQL Editor。前提=schema_v0（deliveries.status）・rls_v0（deliveries RLS）。
-- =============================================================
-- ・ステータス遷移を1行ずつ記録（from/to/changed_at/actor/source/note）。
-- ・書込み（INSERT/UPDATE）は記録口関数 record_status_transition に集約（本表に書込みポリシーは置かない）。
-- ・SELECT は「その荷物が見えるならログも見える」＝deliveries の RLS をそのまま継承（hq/depot/area/driver/shipper）。
-- =============================================================

create table if not exists public.delivery_status_log (
  id              bigint generated always as identity primary key,
  tracking_number text not null references public.deliveries(tracking_number),
  from_status     text,                         -- 遷移前（新規記録時は旧 deliveries.status）
  to_status       text not null,                -- 遷移後
  changed_at      timestamptz not null default now(),
  changed_by      uuid,                         -- actor の user_id（auth.uid()／system は NULL）
  actor           text not null default 'system', -- actor のロール（hq/area/driver/shipper/depot/system）
  source          text,                         -- 配車 / 仕分け / 配達 / CS / 手動
  note            text
);
comment on table public.delivery_status_log is
  'ステータス遷移ログ（6.10第1項）。書込みは record_status_transition 関数経由。SELECTは deliveries RLS継承';

create index if not exists idx_status_log_tracking
  on public.delivery_status_log (tracking_number, changed_at desc);
create index if not exists idx_status_log_changed_at
  on public.delivery_status_log (changed_at desc);

-- RLS：SELECT のみ。書込みポリシーは置かない（関数経由のみ）。
alter table public.delivery_status_log enable row level security;
grant select on public.delivery_status_log to authenticated;

-- 「その荷物が deliveries で見えるなら、そのログも見える」＝deliveries RLS をそのまま継承。
--   サブクエリ内で deliveries の RLS が効くため、5ロール（hq/depot/area/driver/shipper）の可視範囲を自動で踏襲する。
drop policy if exists status_log_inherit on public.delivery_status_log;
create policy status_log_inherit on public.delivery_status_log for select to authenticated
  using (
    exists (
      select 1 from public.deliveries d
      where d.tracking_number = public.delivery_status_log.tracking_number
    )
  );
