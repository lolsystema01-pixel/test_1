-- =============================================================
-- 指示書: 配車表PDF v0 — 手順 2/4：検証用 仕分済 seed（仕分後モード確認用）
--   対応: 6.9。仕分後モードで「仕分済／未仕分」件数が出ることを実証する。
-- 実行: Supabase SQL Editor（postgres＝RLSバイパス）。前提=採番一式 v0.5 実機済み。
-- =============================================================
-- ・実運用の仕分済反映（仕分けナビのスキャン→保存）は「書き込みRLS整備」後。
--   本seedはそれを待たずに postgres 権限で一部を status='仕分済' に立て、検証する。
-- ・冪等：再実行しても件数は安定。§3 のクリーンアップで配車済みへ戻し、正本ダミーの状態を残さない。
-- =============================================================

-- §1. 一部を仕分済に立てる（A01・当日・DRV001 の配達順 1..30）-----------
update public.deliveries
set status = '仕分済'
where delivery_date = current_date
  and office_code   = 'IT01'
  and driver_id     = 'ITD001'
  and status        = '配車済'
  and delivery_order <= 30;

-- §2. 確認：ドライバー別 仕分済／未仕分（A01・当日）---------------------
select driver_id,
       count(*)                                  as total,
       count(*) filter (where status = '仕分済') as sorted,
       count(*) filter (where status <> '仕分済') as unsorted
from public.deliveries
where delivery_date = current_date and office_code = 'A01'
group by driver_id order by driver_id;
-- 期待: DRV001 total=160 / sorted=30 / unsorted=130 ／ 他ドライバー sorted=0

-- =============================================================
-- §3. クリーンアップ（確認後に実行）：仕分済→配車済みへ戻す
--     ※ 正本ダミーの状態を残さないため、検証が終わったら必ず実行。
-- =============================================================
-- update public.deliveries
-- set status = '配車済'
-- where delivery_date = current_date and office_code = 'A01' and status = '仕分済';
--
-- 戻し確認（仕分済=0 を期待）:
-- select count(*) as remaining_sorted from public.deliveries
--   where delivery_date = current_date and office_code = 'A01' and status = '仕分済';
