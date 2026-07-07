-- =============================================================
-- 指示書: CSV取込＋重複排除（問合番号）v0.2
--   荷主CSV → 配送データ（荷物）へ取込。問合番号で重複排除。
--   取込直後は「未配車」、取込バッチIDを付与。
--   対応: 要件定義 6.1 荷物データ取込 / 9.1
-- 実行: SQL Editor。reset_prev_dummy_v0.sql の後。
--   ★ このファイルを「2回」Run することで既存重複の排除も検証する
--     （1回目=16件取込/2件除外、2回目=0件取込）。
-- 前提: DBスキーマ v0（deliveries 等）作成済み。
-- =============================================================
-- 入力CSV: shipper_data_dummy.csv.xlsx（【人】が用意した荷主ダミー）
--   18行。問合番号の重複2件（11217=11201, 11218=11208）→ ユニーク16件。
--   ここでは【AI】が同内容を staging へ seed として投入する
--   （【人】が Supabase Table Editor でCSVインポートする場合は §1・§2をスキップ可）。
-- =============================================================


-- §1. ステージング（取込バッファ）テーブル -------------------
drop table if exists public.import_staging;
create table public.import_staging (
  row_no           int,
  request_date_raw text,   -- 依頼日（生文字列）
  shipper          text,   -- 荷主
  recipient_name   text,   -- 配送先名（氏名）
  address          text,   -- 配送先住所
  tracking_number  text,   -- 問合番号
  note             text    -- 備考
);
comment on table public.import_staging is 'CSV取込バッファ（荷主CSVの取込対象列）';


-- §2. CSV内容を staging へ投入（= 渡されたCSVのseed）----------
insert into public.import_staging (row_no, request_date_raw, shipper, recipient_name, address, tracking_number, note) values
 (11201,'2026年6月8日（月）','HACHI EXPRESS','田中 様','愛知県岡崎市箱柳町12-3','287477461927',NULL),
 (11202,'2026年6月8日（月）','HACHI EXPRESS','栗原 様','愛知県岡崎市高隆寺町5-1','282359785607',NULL),
 (11203,'2026年6月8日（月）','HACHI EXPRESS','佐藤 様','愛知県岡崎市小美町8-22','288152431842',NULL),
 (11204,'2026年6月8日（月）','HACHI EXPRESS','鈴木 様','愛知県岡崎市戸崎町1-4','283650806198',NULL),
 (11205,'2026年6月8日（月）','HACHI EXPRESS','高橋 様','愛知県岡崎市鴨田町3-7','269625801055',NULL),
 (11206,'2026年6月8日（月）','HACHI EXPRESS','伊藤 様','愛知県豊田市西町2-15','284951396931',NULL),
 (11207,'2026年6月8日（月）','HACHI EXPRESS','渡辺 様','愛知県豊田市神田町4-8','262254453714',NULL),
 (11208,'2026年6月8日（月）','HACHI EXPRESS','中村 様','愛知県東海市南柴田町6-2','253239627638',NULL),
 (11209,'2026年6月8日（月）','HACHI EXPRESS','小林 様','愛知県東海市名和町10-1','288143287399',NULL),
 (11210,'2026年6月8日（月）','HACHI EXPRESS','加藤 様','愛知県知多市八幡15-3','287929604432',NULL),
 (11211,'2026年6月8日（月）','HACHI EXPRESS','山本 様','愛知県岡崎市明大寺町1丁目2-3','261290103653','丁目あり'),
 (11212,'2026年6月8日（月）','HACHI EXPRESS','中島 様','愛知県豊田市小坂町2丁目5-1','254844718047','丁目あり'),
 (11213,'2026年6月8日（月）','HACHI EXPRESS','名原 様','愛知県　岡崎市　箱柳町　１２－３','281361685974','表記ゆれ'),
 (11214,'2026年6月8日（月）','HACHI EXPRESS','林 様','愛知県岡崎市高隆寺町５ー１ プレジールパレス932','275726265038','表記ゆれ'),
 (11215,'2026年6月8日（月）','HACHI EXPRESS','木村 様','愛知県岡崎市存在しない町99-9','271002558810','判定不能（未登録想定）'),
 (11216,'2026年6月8日（月）','HACHI EXPRESS','清水 様','愛知県名古屋市中区栄3-1-1','279113440026','対象外市（未登録想定）'),
 (11217,'2026年6月8日（月）','HACHI EXPRESS','田中 様','愛知県岡崎市箱柳町12-3','287477461927','重複（=11201）'),
 (11218,'2026年6月8日（月）','HACHI EXPRESS','中川 様','愛知県東海市荒尾町7-5','253239627638','重複（=11208）');


-- §3. 取込先（deliveries）の準備：氏名列・検索用インデックス ----
--   氏名検索のため recipient_name を追加（無ければ）。
alter table public.deliveries add column if not exists recipient_name text;
comment on column public.deliveries.recipient_name is '配送先名（氏名）。CSV取込で付与';

create index if not exists idx_deliveries_recipient_name on public.deliveries (recipient_name);
create index if not exists idx_deliveries_address        on public.deliveries (address);


-- §4. 重複排除して取込（CSV内重複は1件に集約＋既存重複はスキップ）--
--   ・src: 問合番号で DISTINCT ON（CSV内重複を1件に集約）
--   ・ON CONFLICT (tracking_number) DO NOTHING（既存重複はスキップ）
--   ・status='未配車'、import_batch_id を付与
--   最後に件数（取込/除外）を表示する。
with src as (
  select distinct on (tracking_number)
    tracking_number,
    to_date(regexp_replace(request_date_raw, '^\s*(\d+)年\s*(\d+)月\s*(\d+)日.*$', '\1-\2-\3'), 'YYYY-MM-DD') as delivery_date,
    address,
    recipient_name,
    shipper
  from public.import_staging
  order by tracking_number, row_no            -- 同一問合番号は小さいrow_noを採用
),
batch as (
  select 'BATCH-' || to_char(now(), 'YYYYMMDD-HH24MISS') as id
),
ins as (
  insert into public.deliveries
    (tracking_number, delivery_date, address, recipient_name, status, shipper_id, import_batch_id)
  select s.tracking_number, s.delivery_date, s.address, s.recipient_name, '未配車', s.shipper, b.id
  from src s cross join batch b
  on conflict (tracking_number) do nothing
  returning tracking_number
)
select
  (select count(*) from public.import_staging)                                   as csv_rows,             -- 18
  (select count(*) from src)                                                     as unique_in_csv,        -- 16
  (select count(*) from ins)                                                     as inserted,             -- 1回目16 / 2回目0
  (select count(*) from public.import_staging) - (select count(*) from src)      as csv_internal_dup_excluded, -- 2
  (select count(*) from src) - (select count(*) from ins)                        as existing_dup_skipped; -- 1回目0 / 2回目16
