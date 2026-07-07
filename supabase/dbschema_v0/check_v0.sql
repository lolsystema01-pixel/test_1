-- =============================================================
-- 手順 3/3: 確認用（テーブル作成・参照成立・用語）
-- 実行: SQL Editor に貼り付けて Run（seed_dummy_v0.sql の後）
-- =============================================================

-- A. 5グループのテーブルが作成できているか --------------------
--    8テーブルが並べば OK（depots/offices/zone_plan/address_master/
--    deliveries/delivery_index/drivers/work_schedules）
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in ('depots','offices','zone_plan','address_master',
                     'deliveries','delivery_index','drivers','work_schedules')
order by table_name;


-- B. 外部キー制約が定義されているか --------------------------
--    合格条件の4参照（deliveries→offices / drivers→offices /
--    work_schedules→drivers / delivery_index→deliveries）が含まれること
select
  tc.table_name      as 参照元テーブル,
  kcu.column_name    as 参照元列,
  ccu.table_name     as 参照先テーブル,
  ccu.column_name    as 参照先列
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu
  on tc.constraint_name = kcu.constraint_name and tc.table_schema = kcu.table_schema
join information_schema.constraint_column_usage ccu
  on tc.constraint_name = ccu.constraint_name and tc.table_schema = ccu.table_schema
where tc.constraint_type = 'FOREIGN KEY'
  and tc.table_schema = 'public'
order by tc.table_name, kcu.column_name;


-- C. ダミーデータで参照が実際に成立するか（JOIN件数）---------
--    各 matched が、対象行数と一致すれば参照成立。
select '荷物→営業所'        as 参照, count(*) as matched
  from public.deliveries d      join public.offices o on d.office_code = o.office_code
union all
select 'ドライバー→営業所', count(*)
  from public.drivers dr        join public.offices o on dr.office_code = o.office_code
union all
select '稼働予定→ドライバー', count(*)
  from public.work_schedules w  join public.drivers dr on w.driver_id = dr.driver_id
union all
select '問合Index→荷物',      count(*)
  from public.delivery_index i  join public.deliveries d on i.tracking_number = d.tracking_number;


-- D. 用語確認：deliveries に「バッグ番号・親バッグ」が無いこと ---
--    結果が 0 行なら、廃止語が混入していない（OK）。
select column_name
from information_schema.columns
where table_schema = 'public' and table_name = 'deliveries'
  and (column_name ilike '%bag%' or column_name ilike '%バッグ%' or column_name ilike '%親バッグ%');


-- 参考: 各テーブルの件数 -------------------------------------
select 'depots' as t, count(*) from public.depots
union all select 'offices',        count(*) from public.offices
union all select 'zone_plan',      count(*) from public.zone_plan
union all select 'address_master', count(*) from public.address_master
union all select 'deliveries',     count(*) from public.deliveries
union all select 'delivery_index', count(*) from public.delivery_index
union all select 'drivers',        count(*) from public.drivers
union all select 'work_schedules', count(*) from public.work_schedules
order by t;
