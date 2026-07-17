-- =============================================================
-- 指示書: 全国Master／ZonePlan テーブル化・読込 v0.4
--   【AI】手順1: テーブルをv0.4仕様に整える＋ステージング作成
--   対応: 要件定義 4.3 / 9.2 / 9.3
-- 実行: SQL Editor。前提=DBスキーマ v0（address_master/zone_plan の骨格）作成済み。
-- =============================================================
-- 既存の address_master / zone_plan を DROP せず ALTER で拡張する
-- （rls_v0 のRLSポリシー・GRANTを保持するため）。
--   全国Master = address_master（PK=town_key）
--   全国ZonePlan = zone_plan（PK=common_id）
-- =============================================================

-- ⚠⚠ RETIRED（2026-07-17）: ①の全国Master（address_master）は撤去済み（⑤）。
--   後継は **area_master**（area_master_v0/）。②の ZonePlan 部分は**現役**なので、
--   このファイルは①だけを retire し、②以降はそのまま使う。
--   ★①を復活させないこと。新旧で共通IDの番号体系が別物のため、旧マスタを戻しても
--     実データ（新語彙）とは噛み合わず、④で移行した3関数を巻き戻す入口になる。
--   経緯: supabase/vocab_fix_v0/README.md
--
-- ① 全国Master（address_master）をv0.4仕様へ -------------------   ← RETIRED（実行しない）
--   列: 自治体・町名・丁目・共通ID・拠点・TownKey（既存: town_key/municipality/town/common_id）
-- alter table public.address_master add column if not exists prefecture text;            -- 都道府県（CSVにあるため保持）
-- alter table public.address_master add column if not exists chome      text;            -- 丁目（属性列・通常空）
-- alter table public.address_master add column if not exists depot_code text;            -- 拠点（拠点コード）
-- alter table public.address_master add column if not exists version    integer not null default 1;   -- 版番号（版管理フック）
-- alter table public.address_master add column if not exists is_valid   boolean not null default true; -- 有効フラグ（版管理フック）

-- comment on column public.address_master.chome    is '丁目（属性列。通常は空＝NULL）';
-- comment on column public.address_master.depot_code is '拠点コード';
-- comment on column public.address_master.version  is '版番号（改訂案→承認→適用の本フローは別指示書）';

-- ② 全国ZonePlan（zone_plan）をv0.4仕様へ ---------------------
--   列: 共通ID・ゾーン番号(zone_no)・拠点(depot_code)・隣接(adjacent_zones)
--   既存: common_id(PK)/zone_no/adjacent_zones → depot_code・版列を追加
alter table public.zone_plan add column if not exists depot_code text;                 -- 拠点
alter table public.zone_plan add column if not exists version    integer not null default 1;   -- 版番号
alter table public.zone_plan add column if not exists is_valid   boolean not null default true; -- 有効フラグ

comment on column public.zone_plan.zone_no        is 'ゾーン番号（単一）。From–To範囲は配車側の実装詳細へ';
comment on column public.zone_plan.adjacent_zones is '隣接ゾーンの共通ID（カンマ区切り）';
comment on column public.zone_plan.depot_code     is '拠点コード';


-- ③ ステージング（取込バッファ）------------------------------
-- ⚠ RETIRED（2026-07-17）: master_staging は⑤で drop 済み（旧マスタ専用バッファ）。
--   後継 area_master の取込バッファは **area_master_staging**（area_master_v0/）。
--   ★下の create を復活させないこと（旧マスタ復活の入口）。
--   ※ このすぐ下の **zoneplan_staging は現役**（dispatch_v0.sql:33-36 が分割閾値の読込で参照）。
-- 全国Master CSV: 拠点,TownKey,都道府県,自治体,町名,丁目,共通ID,有効
-- drop table if exists public.master_staging;
-- create table public.master_staging (
--   depot        text,   -- 拠点
--   town_key     text,   -- TownKey
--   prefecture   text,   -- 都道府県
--   municipality text,   -- 自治体
--   town         text,   -- 町名
--   chome        text,   -- 丁目（空）
--   common_id    text,   -- 共通ID
--   valid        text    -- 有効（'有効'）
-- );

-- 全国ZonePlan CSV: 共通ID,拠点,エリア,自治体,ゾーンFrom,ゾーンTo,グループ名,隣接,分割閾値,優先度
drop table if exists public.zoneplan_staging;
create table public.zoneplan_staging (
  common_id       text,  -- 共通ID
  depot           text,  -- 拠点
  area            text,  -- エリア（v0.4では持たない）
  municipality    text,  -- 自治体（v0.4では持たない）
  zone_from       text,  -- ゾーンFrom（→ ゾーン番号に採用）
  zone_to         text,  -- ゾーンTo（範囲は配車側へ）
  group_name      text,  -- グループ名（隣接名→共通ID変換の対応に使用）
  adjacent_raw    text,  -- 隣接（グループ名のカンマ区切り）
  split_threshold text,  -- 分割閾値（持たない）
  priority        text   -- 優先度（持たない）
);
