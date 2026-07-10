-- =============================================================
-- 指示書: 営業所ホーム 概況カード v0.1 — 手順 2/4：検証用ダミー（冪等）
--   受信 → 未配車（状態行『予測配車を実行』）→ 配車（配車済/仮配車 更新）
--   → 新規受信（再予測合図）… の状態を作る。すべて tracking_number 'OH-%' で隔離。
-- 実行: Supabase SQL Editor。office_home_summary_v0.sql の後。
-- =============================================================
-- ★営業所 = IT01（あなたのarea営業所に合わせる。別営業所なら 'IT01' を置換）
-- ★対象日 = current_date（既存データと衝突しない検証用の隔離日）
--   → 概況カードは /home の既定（今日）で確認できる
-- ・driver_id は FK 無し。実ドライバー=OHD1/OHD2、仮ドライバー='仮OH1'。
-- =============================================================

-- 0) 冪等クリーン（ログ→本体の順。FK: log→deliveries）--------------------
delete from public.delivery_status_log where tracking_number like 'OH-%';
delete from public.deliveries          where tracking_number like 'OH-%';

-- 1) 受信（parcels）10件：未配車・受信時刻は3時間前 ----------------------
insert into public.deliveries
  (tracking_number, delivery_date, office_code, status, address, imported_at)
select 'OH-' || lpad(g::text, 3, '0'),
       current_date, 'IT01', '未配車',
       '伊丹市検証' || g || '丁目',
       now() - interval '3 hours'
from generate_series(1, 10) g;
-- ここで概況カードは：受信=10・配車0 → 状態行『予測配車を実行してください』（青）

-- 2) 配車（実ドライバー2名=6件／仮ドライバー1名=2件／未配車2件）---------
update public.deliveries set driver_id = 'OHD1', status = '配車済'
  where tracking_number in ('OH-001','OH-002','OH-003');
update public.deliveries set driver_id = 'OHD2', status = '配車済'
  where tracking_number in ('OH-004','OH-005','OH-006');
update public.deliveries set driver_id = '仮OH1', status = '配車済'
  where tracking_number in ('OH-007','OH-008');
-- OH-009/010 は未配車のまま

-- 配車ログ（source='配車'・最終配車実行=1時間前）------------------------
insert into public.delivery_status_log
  (tracking_number, from_status, to_status, changed_at, changed_by, actor, source)
select tracking_number, '未配車', '配車済', now() - interval '1 hour', null, 'system', '配車'
from public.deliveries
where tracking_number like 'OH-%' and driver_id is not null;
-- ここで：受信=10・配車済(実 2人/6件・仮 1人/2件)・最終配車実行=1時間前
--   最新受信(3時間前) < 最終配車実行(1時間前) → 再予測合図=なし → 状態行『仕分けを進めてください』（青）

-- 3) 新規受信（配車の後に3件）：受信時刻=今 → 再予測合図が立つ ----------
insert into public.deliveries
  (tracking_number, delivery_date, office_code, status, address, imported_at)
select 'OH-' || lpad(g::text, 3, '0'),
       current_date, 'IT01', '未配車',
       '伊丹市検証' || g || '丁目',
       now()
from generate_series(11, 13) g;
-- 最終状態：受信=13・配車済(実 2人/6件・仮 1人/2件)・最終配車実行=1時間前
--   最新受信(今) > 最終配車実行(1時間前) → 再予測合図=あり → 状態行『再予測してください』（青）


-- 確認（この検証データの概況カード）------------------------------------
select office_code, delivery_date, received,
       real_drivers, real_items, virt_drivers, virt_items,
       last_dispatch_at, need_repredict, state_line, state_color
from public.office_home_summary
where office_code = 'IT01' and delivery_date = current_date;
-- 期待: received=13 / real 2人・6件 / virt 1人・2件 / need_repredict=true / state_line='再予測してください' / '青'


-- =============================================================
-- ▼ 追加検証（任意）: 『仕分け完了・出力可能』(緑) を見たいとき
--   新規受信を消し、配車済を全て仕分済にする → 再予測合図なし・全件仕分済
-- =============================================================
-- delete from public.deliveries where tracking_number in ('OH-011','OH-012','OH-013');
-- update public.deliveries set status = '仕分済'
--   where tracking_number like 'OH-%' and driver_id is not null;
-- → received=10 / dispatched=8 / sorted=8 / need_repredict=false
--   → state_line='仕分け完了・出力可能' / state_color='緑'
