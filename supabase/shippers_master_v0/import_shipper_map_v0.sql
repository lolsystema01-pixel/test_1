-- =============================================================
-- 指示書: 取込経路の差し替え（荷主名→shipper_idコード変換）v0.2
--   ★本質: import_v0.sql §4 は staging.shipper（名称＝HACHI EXPRESS）を
--     そのまま deliveries.shipper_id に入れていた。この版で「名称→コード(SHIP01)」
--     変換に差し替え、再取込しても名前が混入しない恒久対応にする（冪等）。
--   ＋ 既存 deliveries の名称→コード backfill（混在解消）。
--   対応: 要件定義 6.1 取込（荷主名→shipper_id 解決）／9.2。
-- 実行: SQL Editor。shippers_v0.sql（create+seed）の後。**このファイルが import_v0 の置き換え版**。
-- 前提: dbschema_v0 / rls_v0 / shippers_v0.sql 実行済み。
--   ★ このファイルを「2回」Run することで重複排除も検証（1回目=16件取込、2回目=0件取込）。
-- =============================================================


-- §1. ステージング（取込バッファ）------------------------------
drop table if exists public.import_staging;
create table public.import_staging (
  row_no           int,
  request_date_raw text,   -- 依頼日（生文字列）
  shipper          text,   -- 荷主（★名称。コードではない）
  recipient_name   text,   -- 配送先名（氏名）
  address          text,   -- 配送先住所
  tracking_number  text,   -- 問合番号
  note             text    -- 備考
);
comment on table public.import_staging is 'CSV取込バッファ（荷主CSVの取込対象列）';


-- §2. CSV内容を staging へ投入（= 渡されたCSVのseed）----------
--   検証ダミーは HACHI EXPRESS の1社のみ・表記ゆれ無し（18行）。
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
alter table public.deliveries add column if not exists recipient_name text;
comment on column public.deliveries.recipient_name is '配送先名（氏名）。CSV取込で付与';

create index if not exists idx_deliveries_recipient_name on public.deliveries (recipient_name);
create index if not exists idx_deliveries_address        on public.deliveries (address);


-- §4. ★名称→shipper_idコード変換して取込（旧 import_v0 §4 の置き換え）--
--   ・src: 問合番号で DISTINCT ON（CSV内重複を1件に集約）
--   ・resolved: staging.shipper（名称）→ shippers を引いて shipper_id コードに変換
--       一致しない名称は resolved_shipper_id=NULL（＝名前を素通りさせない／保留）
--   ・ON CONFLICT (tracking_number) DO NOTHING（既存重複はスキップ）
--   ・status='未配車'、import_batch_id を付与
with src as (
  select distinct on (tracking_number)
    tracking_number,
    to_date(regexp_replace(request_date_raw, '^\s*(\d+)年\s*(\d+)月\s*(\d+)日.*$', '\1-\2-\3'), 'YYYY-MM-DD') as delivery_date,
    address,
    recipient_name,
    shipper as shipper_name                    -- ★ここは名称
  from public.import_staging
  order by tracking_number, row_no             -- 同一問合番号は小さいrow_noを採用
),
resolved as (
  select
    src.tracking_number, src.delivery_date, src.address, src.recipient_name,
    src.shipper_name,
    sh.shipper_id as resolved_shipper_id       -- ★名称→コード（無ければNULL＝保留）
  from src
  left join public.shippers sh on sh.shipper_name = src.shipper_name
),
batch as (
  select 'BATCH-' || to_char(now(), 'YYYYMMDD-HH24MISS') as id
),
ins as (
  insert into public.deliveries
    (tracking_number, delivery_date, address, recipient_name, status, shipper_id, import_batch_id)
  select r.tracking_number, r.delivery_date, r.address, r.recipient_name, '未配車',
         r.resolved_shipper_id,                -- ★コード or NULL（名前は絶対に入れない）
         b.id
  from resolved r cross join batch b
  on conflict (tracking_number) do nothing
  returning tracking_number
)
select
  (select count(*) from public.import_staging)                                       as csv_rows,             -- 18
  (select count(*) from src)                                                         as unique_in_csv,        -- 16
  (select count(*) from ins)                                                         as inserted,             -- 1回目16 / 2回目0
  (select count(*) from public.import_staging) - (select count(*) from src)          as csv_internal_dup_excluded, -- 2
  (select count(*) from src) - (select count(*) from ins)                            as existing_dup_skipped, -- 1回目0 / 2回目16
  (select count(*) from resolved where resolved_shipper_id is null)                  as unresolved_shipper;   -- 名称未一致（保留）件数。期待 0（HACHI EXPRESSは登録済）


-- §5. ★既存 deliveries の backfill（名称→コード。混在解消）------
--   旧版で shipper_id に名称（'HACHI EXPRESS'）が入っていた行を 'SHIP01' に変換。
--   既に 'SHIP01' 等コードの行は shippers.shipper_name と一致しないため対象外（そのまま）。
--   冪等: 何度実行しても結果は同じ（名称行が無くなれば0行更新）。
update public.deliveries d
set shipper_id = sh.shipper_id
from public.shippers sh
where d.shipper_id = sh.shipper_name;          -- 名称一致の行だけコード化


-- §6. ★保留（未解決）行の事後解決 -----------------------------
--   §4で名称未一致だった荷物は shipper_id=NULL のまま入っている。
--   人手で shippers に荷主を追加した後に本ファイルを再Runすると、
--   既存の NULL 行も staging の名称経由でコードに解決される（再取込で取りこぼさない）。
update public.deliveries d
set shipper_id = sh.shipper_id
from public.import_staging s
join public.shippers sh on sh.shipper_name = s.shipper
where d.tracking_number = s.tracking_number
  and d.shipper_id is null;


-- =============================================================
-- 実行後の確認は check_shippers_v0.sql。
-- 未解決(unresolved_shipper)が 0 になったら shippers_v0.sql を再Runして FK を張る。
-- =============================================================
