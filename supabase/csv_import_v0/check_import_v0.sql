-- =============================================================
-- CSV取込 v0.2 確認SQL
-- 実行: import_v0.sql を（1回目・2回目）実行した後、SQL Editor で各ブロックを実行。
-- ★ 複数文は最後しか表示されないので、見たいSELECTを選択して Ctrl/Cmd+Enter。
-- =============================================================

-- ① 取込件数・ステータス・バッチ ------------------------------
--    deliveries 総数=16／status は全て「未配車」／import_batch_id が付与されている。
select count(*) as deliveries_total from public.deliveries;            -- 期待 16

select status, count(*) from public.deliveries group by status;       -- 未配車=16

select import_batch_id, count(*) as cnt
from public.deliveries
group by import_batch_id
order by import_batch_id;                                             -- どのバッチで入ったか


-- ② CSV内重複が排除されているか ------------------------------
--    deliveries に同じ問合番号が2件以上ない（= 0行なら重複なし）。
select tracking_number, count(*) as cnt
from public.deliveries
group by tracking_number
having count(*) > 1;                                                  -- 0行 が期待

--    元CSV(staging)では重複していた問合番号が、deliveries では各1件か。
select d.tracking_number, count(*) as in_deliveries
from public.deliveries d
where d.tracking_number in ('287477461927','253239627638')           -- 11201/11217, 11208/11218
group by d.tracking_number;                                           -- 各 1 件が期待


-- ③ 検索できるか（問合番号／住所／氏名）----------------------
-- 問合番号で
select tracking_number, recipient_name, address, status
from public.deliveries
where tracking_number = '287477461927';

-- 住所で（部分一致）
select tracking_number, recipient_name, address
from public.deliveries
where address ilike '%岡崎市%'
order by tracking_number;

-- 氏名で（部分一致）
select tracking_number, recipient_name, address
from public.deliveries
where recipient_name ilike '%田中%';


-- ④ （2回取込の確認）------------------------------------------
--    import_v0.sql を2回実行した後、deliveries は 16 のまま（増えていない）。
--    ※2回目実行時の counts 行で inserted=0 / existing_dup_skipped=16 を確認済みであること。
select count(*) as deliveries_total_after_2nd_import from public.deliveries; -- 16

-- =============================================================
-- 合格条件との対応
--   ・CSV内重複の排除      … ②（having count>1 が0行、対象問合番号が各1件）
--   ・2回目は全件スキップ  … import_v0.sql 2回目の inserted=0／④で総数16のまま
--   ・ステータス=未配車    … ①（status 未配車=16）
--   ・取込バッチID付与     … ①（import_batch_id でグルーピングできる）
--   ・件数が数で分かる     … import_v0.sql の counts 行（csv_rows/unique/inserted/除外）
--   ・問合番号/住所/氏名で検索 … ③
-- =============================================================
