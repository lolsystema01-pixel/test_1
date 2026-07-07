-- =============================================================
-- エリアマスタ取込 v0.1 — ① スキーマ（area_master ＋ staging）
--   対応: 第4章 全国配分（Master整備）。②共通ID付与 v0.4 / ⑤配達順 v0.3 の参照元。
-- 実行: Supabase SQL Editor。前提=normalize_v0.sql（normalize_addr）。
-- =============================================================
-- ・集約master を「最小列」で保持：町キー＋ゾーン番号＋共通ID＋有効＋優先度。
--   親バッグ名・バッグ番号・ユニット番号は取込まない（かご記号一本化・配達順v0.3で廃止）。
-- ・town_key = normalize_addr(都道府県+自治体+町名)（①と同一関数で整合）。②はこれへ前方一致で直lookup。
-- ・RLSは hq 参照のみ（マスタ＝バックエンド参照。zone_plan と同格）。
-- =============================================================

-- 取込バッファ（CSVをそのまま文字列で受ける。DashboardのCSVインポート先）--------
create table if not exists public.area_master_staging (
  prefecture   text,   -- 都道府県
  municipality text,   -- 自治体
  town         text,   -- 町名
  chome        text,   -- 丁目（空可）
  zone_no      text,   -- ゾーン番号（例 '1' / '1.0'）
  common_id    text,   -- 共通ID
  is_valid     text,   -- 有効（'有効'等）
  priority     text,   -- 優先度
  area         text,   -- エリア（U-OKZ-01 等。将来の二段突合/階層参照用）
  depot        text,   -- 拠点（例 '愛知県1'。zone_no は拠点スコープ＝一意性の担保）
  src_town_key text,   -- 元TownKey（集約masterの TownKey 列。追跡・照合用）
  postal_code  text    -- 郵便番号（将来の郵便番号突合用・保持のみ）
);
comment on table public.area_master_staging is 'エリアマスタ集約masterのCSV取込バッファ（文字列受け）。親バッグ/バッグ番号/ユニット番号は取込まない';

-- 本表（確定・突合キーは town_key）--------------------------------------------
create table if not exists public.area_master (
  town_key     text primary key,               -- normalize_addr(都道府県+自治体+町名)＝突合キー
  prefecture   text,
  municipality text,
  town         text,
  chome        text,
  zone_no      integer,                         -- ゾーン番号（数値）
  common_id      text,                          -- 共通ID（②の付与元）
  area           text,                          -- エリア（U-OKZ-01 等・将来用）
  depot          text,                          -- 拠点（zone_no のスコープ）
  source_town_key text,                         -- 元TownKey（集約master由来・追跡用）
  postal_code    text,                          -- 郵便番号（将来の郵便番号突合用・保持のみ）
  is_valid       boolean not null default true,
  priority       integer
);
comment on table public.area_master is 'エリアマスタ（最小列）。town_key→(common_id, zone_no) の直lookup元。有効のみ・優先度で1件確定';

create index if not exists idx_area_master_common on public.area_master (common_id);

-- RLS：hq 参照のみ（マスタ＝バックエンド参照）。書込みは取込SQL（postgres）で行う。
alter table public.area_master         enable row level security;
alter table public.area_master_staging enable row level security;
grant select on public.area_master to authenticated;
drop policy if exists area_master_hq on public.area_master;
create policy area_master_hq on public.area_master for select to authenticated
  using ( public.my_role() = 'hq' );
-- staging は参照ポリシーを置かない（authenticated からは見えない＝取込作業用）。
