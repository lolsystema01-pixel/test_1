-- =============================================================
-- 指示書: 配送一覧（配車結果表示）v0 — ドライバーアプリ §8.3
--   ログイン中ドライバーの当日担当を配達順に表示するための「読み取りクエリ＋確認」。
-- 実行: Supabase SQL Editor。前提=配車 v0.5／採番一式 v0.5 実機済み。
-- =============================================================
-- ・新しいオブジェクトは作らない（読み取りのみ）。画面は deliveries を直接 RLS で読む。
-- ・実アプリ（anon＋driverログイン）では RLS(deliveries_driver: driver_id=my_driver()) が
--   自分の担当のみに絞る。SQL Editor は postgres＝RLSバイパスのため、ここでは
--   driver_id を明示して「アプリで見えるはずの集合」を答え合わせする。
-- =============================================================

-- ① アプリの取得クエリ相当（DRV001・当日・配達順）------------------------
--    ※ アプリ側は driver_id を書かず RLS に委譲。ここは検証のため明示。
select
  delivery_order,                    -- 配達順（1始まり）
  basket_code,                       -- かご記号
  tracking_number,                   -- 問合番号
  address,                           -- 配送先住所
  recipient_name,                    -- 氏名（CSV取込由来。DSPダミーは空のことあり）
  time_window,                       -- 時間指定
  status                             -- ステータス
from public.deliveries
where driver_id = 'DRV001'
  and delivery_date = current_date
order by delivery_order asc
limit 20;

-- ② 配達順が 1..N の連番（ドライバー別。アプリ表示順の健全性）---------------
select driver_id,
       count(*)            as cnt,
       min(delivery_order) as mn,
       max(delivery_order) as mx,
       case when min(delivery_order)=1
                 and max(delivery_order)=count(*)
                 and count(distinct delivery_order)=count(*)
            then 'OK' else 'NG' end as judge
from public.deliveries
where delivery_date = current_date and driver_id is not null
group by driver_id
order by driver_id;
-- 期待: 各ドライバー OK（採番一式の連番のまま）

-- ③ 担当総数（DRV001・当日）= アプリのヘッダ件数 ------------------------
select count(*) as drv001_today
from public.deliveries
where driver_id = 'DRV001' and delivery_date = current_date;
-- 期待: 配車 v0 のseed基準＝160（DRV001の当日担当）

-- ④ RLSスコープの最終証明はアプリで（SQL Editorはバイパス）------------------
--   ・DRV001でログイン → 自分の160件のみ・配達順・各項目が出る。
--   ・他ドライバー（DRV002/仮）の荷物は 0件（deliveries_driver で範囲外0件）。
