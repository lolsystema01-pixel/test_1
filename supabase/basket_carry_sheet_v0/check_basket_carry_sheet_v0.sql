-- =============================================================
-- かご持出表PDF v0 確認SQL（手順 2/3）
--   ドライバー別の かご記号・担当個数・合計／RLS自営業所のみ を確認する。
-- 実行: basket_carry_sheet_v0.sql の後。各 begin〜rollback を選択して個別実行。
-- ★ 対象日は既定 current_date（配車 v0.5＋採番一式 v0.5 は当日 delivery_date で投入）。
--    別日のデータを見たいときは下の current_date を 'YYYY-MM-DD' に置換。
-- ★ SQLエディタは複数文だと最後の結果しか出ない → ブロックを選択して Ctrl/Cmd+Enter。
-- =============================================================

-- ⓪ どの日付にデータがあるか（0件のときの当たり付け）--------------------
select delivery_date, count(*) as rows, count(distinct driver_id) as drivers
from public.basket_carry_sheet
group by delivery_date order by delivery_date;


-- ① 管理者(RLS無視)：明細（ドライバー×かご×担当個数）------------------
select office_code, driver_id, driver_name, basket_code, item_count
from public.basket_carry_sheet
where delivery_date = current_date
order by office_code, driver_id, basket_code;
-- 期待: 当日の配車・採番結果に一致（ドライバー×かご記号ごとの担当個数）。


-- ② 管理者：サマリ（ドライバー別 かご数/合計）--------------------------
select office_code, driver_id, driver_name, basket_count, total_count
from public.basket_carry_sheet_summary
where delivery_date = current_date
order by office_code, driver_id;
-- 期待: total_count = そのドライバーの当日担当個数の合計。


-- ③ area（自営業所のみ・他営業所0件）------------------------------------
--    ★ 自分の area アカウントの sub(UUID) に置き換えて実行（promote_test_area_v0 のユーザー）。
--    他営業所 office_code は自分以外の値に置き換え（既定 'C01' を自分の対向に）。
begin;
  set local request.jwt.claims = '{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000000a1"}';  -- ★自分のarea UUID
  set local role authenticated;
  select 'area' as who,
    (select count(*)                  from public.basket_carry_sheet where delivery_date=current_date)                       as "明細行",
    (select count(distinct driver_id) from public.basket_carry_sheet where delivery_date=current_date)                       as "ドライバー数",
    (select coalesce(sum(item_count),0) from public.basket_carry_sheet where delivery_date=current_date)                     as "担当個数計",
    (select count(distinct office_code) from public.basket_carry_sheet where delivery_date=current_date)                     as "見える営業所数(1期待)",
    (select count(*) from public.basket_carry_sheet where delivery_date=current_date and office_code <> coalesce((select office_code from public.profiles where user_id=auth.uid()),'')) as "他営業所(0期待)";
rollback;


-- ④ 採番結果との一致（担当個数 = deliveries の実件数）------------------
--    管理者で、ビューの担当個数が deliveries の生集計と一致するか（不一致行が出なければOK）。
select v.office_code, v.driver_id, v.basket_code, v.item_count,
       (select count(*) from public.deliveries d
         where d.delivery_date=current_date and d.driver_id=v.driver_id
           and d.basket_code is not distinct from v.basket_code) as raw_count
from public.basket_carry_sheet v
where v.delivery_date=current_date
  and v.item_count <> (select count(*) from public.deliveries d
         where d.delivery_date=current_date and d.driver_id=v.driver_id
           and d.basket_code is not distinct from v.basket_code);
-- 期待: 0行（ビュー＝採番結果と一致）。

-- =============================================================
-- 合格条件との対応
--   ・ドライバー別 かご記号・担当個数・合計 … ①②（採番一致は④で不一致0）
--   ・area RLSで自営業所のみ・他営業所0件   … ③（見える営業所=1・他営業所=0）
-- =============================================================
