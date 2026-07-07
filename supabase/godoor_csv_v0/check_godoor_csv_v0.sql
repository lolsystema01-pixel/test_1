-- =============================================================
-- GoDoor用CSV出力 v0.2 確認SQL（手順 2/3）
--   仕分済のみ・有効ドライバー・件数・並び・RLS自営業所のみ を確認する。
-- 実行: godoor_csv_v0.sql の後。各 begin〜rollback を選択して個別実行。
-- ★ 対象日は既定 current_date。別日を見るときは current_date を 'YYYY-MM-DD' に置換。
--   （seed_sort_status_v0 は current_date の A01/DRV001 を仕分済にする）
-- ★ 21列・UTF-8 BOM・CRLF・サニタイズ・固定列の整形はフロント側（godoor.ts 単体テストで検証）。
-- =============================================================

-- ⓪ どの日付に仕分済データがあるか（0件のときの当たり付け）--------------
select delivery_date, count(*) as sorted_items, count(distinct driver_id) as drivers
from public.godoor_csv
group by delivery_date order by delivery_date;


-- ① 管理者(RLS無視)：対象（ドライバー別 件数）------------------------
select office_code, driver_id, driver_name, count(*) as items
from public.godoor_csv
where delivery_date = current_date
group by office_code, driver_id, driver_name
order by office_code, driver_name;


-- ② 仕分済フィルタの実証：ビューの対象が全て status='仕分済' か --------
--    deliveries 側で、ビューに出る問合番号が全て仕分済であること（混入0）。
select count(*) as "非仕分済の混入(0期待)"
from public.deliveries d
where d.delivery_date = current_date
  and d.tracking_number in (select tracking_number from public.godoor_csv where delivery_date=current_date)
  and d.status <> '仕分済';
-- 期待: 0

--    未割当・空ドライバーが出ていないこと。
select count(*) as "無効ドライバー混入(0期待)"
from public.godoor_csv
where delivery_date = current_date
  and (driver_id is null or driver_id = '未割当');
-- 期待: 0


-- ③ area：自営業所のみ（他営業所0件）------------------------------------
--    ★ 自分の area アカウントの sub(UUID) に置換（select user_id from profiles where role='area';）。
begin;
  set local request.jwt.claims = '{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000000a1"}';  -- ★自分のarea UUID
  set local role authenticated;
  select 'area' as who,
    (select count(*) from public.godoor_csv where delivery_date=current_date)                                  as "対象件数",
    (select count(distinct office_code) from public.godoor_csv where delivery_date=current_date)               as "見える営業所数(1期待)",
    (select count(*) from public.godoor_csv where delivery_date=current_date
        and office_code <> coalesce((select office_code from public.profiles where user_id=auth.uid()),''))    as "他営業所(0期待)";
rollback;

-- =============================================================
-- 合格条件との対応
--   ・仕分済かつ有効ドライバーのみ … ②（非仕分済0・無効ドライバー0）
--   ・ドライバー別件数・並び       … ①（並びの確定はフロント godoor.ts）
--   ・area RLSで自営業所のみ        … ③（見える営業所=1・他営業所=0）
--   ・21列/BOM/CRLF/サニタイズ/固定列 … godoor.ts 単体テスト＋実機CSVで確認
-- =============================================================
