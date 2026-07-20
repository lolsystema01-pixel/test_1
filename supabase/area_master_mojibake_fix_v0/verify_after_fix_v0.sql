-- =============================================================
-- 指示書: エリアマスタ文字化け修正 v0.1 — ①-d 追加検証（再loadの完了確認）
--   detect=0/0 は「U+FFFDが無い」だけ。①-c の load 再実行が走り、
--   破損行が正しく再生成＋is_valid修正6行が復活したかを確認する。SELECT のみ。
-- 実行: Supabase SQL Editor（postgres）。fix→delete→load 本実行 の後。
-- =============================================================

-- (a) 総数（dry-run の distinct_town_keys=81200 と整合するか。復活分で微増し得る）
select count(*) as area_master_rows, count(distinct town_key) as distinct_town_keys
from public.area_master;

-- (b) 直した「町名」が area_master に存在し正しい（代表5町）
select town, common_id, prefecture, municipality, town_key
from public.area_master
where common_id in ('OSC_C_25_31','RGS_C_01_05','MHR_C_63_64','HND_C_23_30','KAR_E_23_26')
  and town in ('城見ＭＩＤタワー（３５階）','平畑','清水','稲穂町','北波多大杉')
order by common_id;
-- 期待: 5行（town_key に U+FFFD なし＝派生列が正しく再生成）。

-- (c) is_valid を直して復活すべき6町が、いま有効行として存在するか（★reload完了の決め手）
select common_id, prefecture, municipality, town, is_valid
from public.area_master
where town in ('勝本町本宮仲触','中川原台','建部町下神目','千屋花見','本町','増泉')
  and municipality in ('壱岐市','富山市','岡山市北区','新見市','近江八幡市','金沢市')
order by municipality;
-- 期待: 6行そろって is_valid=true。
--   0行なら load 本実行が未実行の疑い（DELETEだけで detect=0 になっている）。
