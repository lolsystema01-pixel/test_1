-- =============================================================
-- 指示書: 未登録住所の記録・修正フロー v0 — 確認SQL
--   未登録件数・解消件数・残保留件数を実証する。
-- 実行: SQL Editor。unregistered_v0.sql（§5 再判定）の後。各ブロックを個別実行。
-- =============================================================


-- ① 件数サマリ：未登録 累計 / 解消 / 未対応 / 保留中 -------------
select
  (select count(*) from public.unregistered_addresses)                       as unregistered_total,
  (select count(*) from public.unregistered_addresses where resolved = true)  as resolved_cnt,
  (select count(*) from public.unregistered_addresses where resolved = false) as unresolved,
  (select count(*) from public.deliveries where status = '保留')              as held_now;


-- ② 未対応の未登録住所 一覧（残っているもの）--------------------
select u.tracking_number, u.address, u.reason, u.note, d.status, d.common_id
from public.unregistered_addresses u
join public.deliveries d on d.tracking_number = u.tracking_number
where u.resolved = false
order by u.tracking_number;
-- 期待: 修正しても判定不能な住所（例:名古屋市栄）が保留(common_id=NULL)で残る


-- ③ 解消した荷物：共通ID・拠点・営業所が付与され、未配車に戻ったか
select u.tracking_number, d.address, d.common_id, d.depot_code, d.office_code, d.status, u.resolved
from public.unregistered_addresses u
join public.deliveries d on d.tracking_number = u.tracking_number
where u.resolved = true
order by u.tracking_number;
-- 期待: resolved=true の荷物は common_id/depot_code/office_code が埋まり status=未配車


-- ④ ステータス分布（再判定後）----------------------------------
select status, count(*) from public.deliveries group by status order by status;
-- 期待: 未配車=14+解消分 / 保留=残った未対応分


-- ⑤ 取りこぼし無しの確認：保留荷物＝未対応の未登録住所と一致 ------
--    保留なのに未登録住所に無い荷物 / 未対応なのに保留でない荷物 が 0 であること。
select
  (select count(*) from public.deliveries d
     where d.status = '保留'
       and not exists (select 1 from public.unregistered_addresses u
                       where u.tracking_number = d.tracking_number and u.resolved = false)) as held_without_record,
  (select count(*) from public.unregistered_addresses u
     join public.deliveries d on d.tracking_number = u.tracking_number
     where u.resolved = false and d.status <> '保留')                                        as unresolved_not_held;
-- 期待: held_without_record=0 / unresolved_not_held=0（保留と未対応が一致＝取りこぼし無し）
