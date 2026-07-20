-- =============================================================
-- 指示書: DBスキーマ v0（骨格）
--   対象: 配送データ・問合Index・マスタ・ドライバー・稼働予定
--   要件定義 第9章データ要件 に対応。※RLSは今回含めない（別指示書）。
-- 手順 1/3: 骨格テーブル定義＋参照(FK)
-- 実行: Supabase SQL Editor に貼り付けて Run
-- =============================================================
-- ・識別子は英語snake_case、用語集v0.1の語は COMMENT で併記。
-- ・バッグ番号・親バッグは作らない（かご記号に一本化）。
-- ・荷主ID・取込バッチID は列のみ保持し、FKは張らない（対応マスタ未作成）。
-- ・参照される側を先に作成（マスタ → 荷物 → 問合Index → ドライバー → 稼働予定）。
-- ・再実行できるよう、依存の子側から drop してから作り直す。
-- =============================================================

drop table if exists public.work_schedules  cascade;
drop table if exists public.delivery_index  cascade;
drop table if exists public.drivers         cascade;
drop table if exists public.deliveries      cascade;
drop table if exists public.address_master  cascade;
drop table if exists public.offices         cascade;
drop table if exists public.zone_plan       cascade;
drop table if exists public.depots          cascade;


-- =============================================================
-- ① マスタ：拠点／営業所
-- =============================================================

-- 拠点マスタ（営業所をまとめる親。親子関係の親側）
create table public.depots (
  depot_code  text primary key,          -- 拠点コード
  depot_name  text not null
);
comment on table public.depots is 'マスタ: 拠点（営業所の親グルーピング）';

-- 営業所マスタ＋営業所設定
create table public.offices (
  office_code        text primary key,                       -- 営業所コード
  depot_code         text references public.depots(depot_code), -- 親子関係（所属拠点）
  office_name        text not null,
  dispatch_priority  text    not null default '処理能力優先',  -- 配車優先方式（処理能力優先/最低保証優先）
  basket_order       text    not null default 'ドライバー順',  -- かご振り順（ドライバー順/配達順順/ゾーン順）
  basket_cart_limit  integer,                                 -- かご台車上限
  autosave_threshold integer not null default 50,             -- 自動保存閾値
  request_period_days integer                                 -- 申請可能期間（日数。NULL=無制限）
);
comment on table public.offices is 'マスタ: 営業所＋設定（配車優先方式・かご振り順・かご台車上限・自動保存閾値・申請可能期間）';


-- =============================================================
-- ① マスタ：住所／ゾーン（全国Master・全国ZonePlan）
--   ※版管理ロジックは範囲外。骨格のみ。
-- =============================================================

-- 全国ZonePlan（共通ID → ゾーン）
create table public.zone_plan (
  common_id      text primary key,        -- 共通ID（住所判定の中核キー）
  zone_no        text,                    -- ゾーン番号
  adjacent_zones text                     -- 隣接ゾーン（骨格: テキスト保持）
);
comment on table public.zone_plan is 'マスタ: 全国ZonePlan（共通ID→ゾーン・隣接）。版管理は範囲外';

-- ⚠⚠ RETIRED（2026-07-17）: address_master は撤去済み（本番DBに存在しません）。
--   後継は **area_master**（area_master_v0/area_master_schema_v0.sql）。
--   撤去の経緯: 指示書「語彙是正→address_master 撤去 v0.1」／ supabase/vocab_fix_v0/
--   ・新旧で共通IDの番号体系が別物（箱柳町: 旧 OKZ_C_01_08 → 新 OKZ_C_01_06）。
--     旧マスタを復活させても、実データの新語彙とは噛み合いません。
--   ★この create を復活させないでください。復活させたうえで dispatch_v0.sql /
--     delivery_status_rpc_v0.sql を再実行すると、④の移行が巻き戻り、
--     「エラー無しで市名NULL・同一市判定不成立」という静かな劣化に戻ります。
--   下記は履歴として残しています（実行しない）。
-- 全国Master（TownKey・共通ID）
-- create table public.address_master (
--   town_key      text primary key,                              -- TownKey（自治体＋町名）
--   municipality  text,                                          -- 自治体
--   town          text,                                          -- 町名
--   common_id     text references public.zone_plan(common_id)    -- 共通ID（→ZonePlan）
-- );
-- comment on table public.address_master is 'マスタ: 全国Master（TownKey・共通ID）。版管理は範囲外';


-- =============================================================
-- ② 配送データ（荷物）
--   driver_id は列のみ（drivers より先に作成するためFKは張らない）。
--   shipper_id / import_batch_id も列のみ（対応マスタ未作成のためFKなし）。
-- =============================================================
create table public.deliveries (
  tracking_number text primary key,                             -- 問合番号［主キー］
  delivery_date   date,                                         -- 日付
  address         text,                                         -- 配送先住所
  common_id       text,                                         -- 共通ID（全国配分で付与）
  depot_code      text,                                         -- 拠点コード
  office_code     text references public.offices(office_code),  -- 営業所コード（→営業所マスタ）
  driver_id       text,                                         -- ドライバーID（配車で付与・FKなし）
  delivery_order  integer,                                      -- 配達順
  basket_code     text,                                         -- かご記号
  status          text not null default '未配車',               -- ステータス
  time_window     text,                                         -- 時間指定
  shipper_id      text,                                         -- 荷主ID（列のみ・FKなし）
  import_batch_id text                                          -- 取込バッチID（列のみ・FKなし）
);
comment on table public.deliveries is '配送データ（荷物）。バッグ番号・親バッグは持たない';


-- =============================================================
-- ③ 問合Index（高速参照）
--   問合番号 → ドライバーID・配達順・かご記号・共通ID
-- =============================================================
create table public.delivery_index (
  tracking_number text primary key
                  references public.deliveries(tracking_number), -- 問合番号（→荷物）
  driver_id       text,                                          -- ドライバーID
  delivery_order  integer,                                       -- 配達順
  basket_code     text,                                          -- かご記号
  common_id       text                                           -- 共通ID
);
comment on table public.delivery_index is '問合Index: 問合番号から配車情報を引く高速参照';


-- =============================================================
-- ④ ドライバー（マスタ）
-- =============================================================
create table public.drivers (
  driver_id          text primary key,                            -- ドライバーID［主キー］
  driver_name        text not null,                               -- 氏名
  contact            text,                                        -- 連絡先
  vehicle            text,                                        -- 車両
  skill_per_hour     integer,                                     -- スキル（1時間あたり配達個数）
  contract_start_date date,                                       -- 契約開始日
  contract_end_date   date,                                       -- 契約解除日
  office_code        text references public.offices(office_code), -- 所属営業所コード（→営業所マスタ）
  registration_status text not null default '登録済'              -- 登録状態
);
comment on table public.drivers is 'マスタ: ドライバー';


-- =============================================================
-- ⑤ 稼働予定
--   ドライバーID（→ドライバー）／日付／稼働区分／申請状態
-- =============================================================
create table public.work_schedules (
  id                 bigint generated always as identity primary key,
  driver_id          text not null references public.drivers(driver_id), -- ドライバーID（→ドライバー）
  work_date          date not null,                                      -- 日付
  work_type          text,                                               -- 稼働区分（フル/2時間/6時間 等）
  application_status text not null default '申請中'
                     check (application_status in ('申請中','承認','却下')) -- 申請状態
);
comment on table public.work_schedules is '稼働予定: ドライバーの稼働申請（申請中/承認/却下）';
