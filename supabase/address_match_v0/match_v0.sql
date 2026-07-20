-- =============================================================
-- ⚠⚠ RETIRED（2026-07-17）: このファイル（②住所判定）は**二重に置換済み**です。実行しないでください。
--   1) 実装の置換: 共通ID付与 v0.4（common_id_assign_v0/）が area_master への
--      **直lookup**（town_key 前方一致・最長一致）に簡素化して置き換え済み。
--   2) 参照先の消滅: 本ファイルが join する **address_master は⑤で drop 済み**
--      （指示書「語彙是正→address_master 撤去 v0.1」）＝実行すれば「テーブル無し」で落ちます。
--   ※ 前段の normalize_v0.sql（①住所正規化・normalize_addr）は**現役**です。
--   経緯: supabase/vocab_fix_v0/README.md ／ docs/handoff_status_v0.md §3.1
--   以下は判定ロジックの設計意図を読む資料として残しています。
-- =============================================================
-- 共通ID判定 v0.2（丁目優先→TownKeyフォールバック / dry-run→本実行）
-- 実行: SQL Editor。normalize_v0.sql の後。
--   ★ まず【A. dry-run】を実行して件数を確認 → 問題なければ【B. 本実行】。
--   各まとまりを選択して Ctrl/Cmd+Enter で実行。
-- =============================================================
-- マッチ規則:
--   正規化した配送先住所が、Masterの「都道府県+自治体+町名」で前方一致するか。
--   ・丁目一致 : Master側に丁目がある行に丁目まで一致（今回Masterは丁目空のため0件）
--   ・TownKeyフォールバック一致: 自治体+町名で一致（丁目は無視）
--   ・不一致   : どのMaster行にも前方一致しない
--   複数候補は最長一致を採用（曖昧なら保留）。
-- =============================================================


/* ↓↓ RETIRED（2026-07-17）: 以下②の実行部を無効化。address_master 参照（撤去済み⑤）＋
   実装は common_id_assign_v0.4 に置換済み。drop後は実行時エラー＝fail-closed。設計意図の参照用に本文は残す。
-- =====================  A. dry-run（書き込まない）  ==========
-- 丁目一致／TownKeyフォールバック一致／不一致 の件数を出す。
with norm as (
  select tracking_number, address, public.normalize_addr(address) as na
  from public.deliveries
),
cand as (
  select n.tracking_number,
         m.common_id,
         (m.chome is not null and m.chome <> '') as has_chome,
         length(public.normalize_addr(coalesce(m.prefecture,'')||coalesce(m.municipality,'')||coalesce(m.town,''))) as keylen
  from norm n
  join public.address_master m
    on n.na like public.normalize_addr(coalesce(m.prefecture,'')||coalesce(m.municipality,'')||coalesce(m.town,'')) || '%'
),
best as (
  select distinct on (tracking_number) tracking_number, common_id, has_chome
  from cand
  order by tracking_number, keylen desc
),
labeled as (
  select d.tracking_number,
    case when b.tracking_number is null then '3_不一致'
         when b.has_chome             then '1_丁目一致'
         else                              '2_TownKeyフォールバック一致' end as match_level
  from public.deliveries d
  left join best b on b.tracking_number = d.tracking_number
)
select match_level, count(*) as cnt
from labeled
group by match_level
order by match_level;
-- 期待: 2_TownKeyフォールバック一致 = 14 / 3_不一致 = 2 （丁目一致は0=出ない）


-- =====================  B. 本実行（書き込み）  ===============
-- B-1) 一致した荷物に共通IDを付与
with norm as (
  select tracking_number, public.normalize_addr(address) as na from public.deliveries
),
cand as (
  select n.tracking_number, m.common_id,
         length(public.normalize_addr(coalesce(m.prefecture,'')||coalesce(m.municipality,'')||coalesce(m.town,''))) as keylen
  from norm n
  join public.address_master m
    on n.na like public.normalize_addr(coalesce(m.prefecture,'')||coalesce(m.municipality,'')||coalesce(m.town,'')) || '%'
),
best as (
  select distinct on (tracking_number) tracking_number, common_id
  from cand order by tracking_number, keylen desc
)
update public.deliveries d
set common_id = b.common_id
from best b
where b.tracking_number = d.tracking_number;

-- B-2) 不一致を未登録住所に記録
insert into public.unregistered_addresses (tracking_number, address, normalized_address, reason)
select d.tracking_number, d.address, public.normalize_addr(d.address),
       '共通ID判定不能（自治体＋町名がMaster未登録）'
from public.deliveries d
where d.common_id is null
on conflict (tracking_number) do nothing;

-- B-3) 不一致の荷物を保留にする（取りこぼさない）
update public.deliveries set status = '保留' where common_id is null;

-- B-4) 本実行の件数
select
  (select count(*) from public.deliveries where common_id is not null) as assigned_common_id,  -- 14
  (select count(*) from public.deliveries where common_id is null)     as unmatched,            -- 2
  (select count(*) from public.unregistered_addresses)                 as unregistered,         -- 2
  (select count(*) from public.deliveries where status = '保留')        as held;                 -- 2
*/ -- ↑↑ RETIRED（実行部ここまで・無効化）↑↑
