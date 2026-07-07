-- =============================================================
-- 住所正規化・共通ID判定 v0.2 確認SQL
-- 実行: match_v0.sql の B.本実行 の後。各ブロックを選択して Ctrl/Cmd+Enter。
-- =============================================================

-- ① 件数サマリ（付与14 / 保留2 / 未登録2）---------------------
select
  (select count(*) from public.deliveries where common_id is not null) as assigned,
  (select count(*) from public.deliveries where status = '保留')        as held,
  (select count(*) from public.unregistered_addresses)                 as unregistered;

select status, count(*) from public.deliveries group by status order by status;  -- 未配車=14 / 保留=2


-- ② 共通ID付与 → ゾーン・拠点が引ける（判定経路）-------------
--    荷物.common_id → zone_plan で ゾーン番号・拠点・隣接 が引ける。
select d.tracking_number, d.recipient_name, d.address, d.common_id,
       z.zone_no, z.depot_code, z.adjacent_zones
from public.deliveries d
join public.zone_plan z on z.common_id = d.common_id
order by d.common_id, d.tracking_number;


-- ③ TownKeyフォールバックの確認（丁目あり荷物も共通IDに当たる）
select tracking_number, address, common_id, status
from public.deliveries
where address like '%丁目%'
order by tracking_number;                                   -- 明大寺町1丁目 / 小坂町2丁目 → 共通IDあり


-- ④ 未登録住所（判定不能の記録）------------------------------
select tracking_number, address, normalized_address, reason, resolved
from public.unregistered_addresses
order by tracking_number;                                   -- 存在しない町 / 名古屋市栄 の2件


-- ⑤ 保留になった荷物（取りこぼし防止）------------------------
select tracking_number, address, status, common_id
from public.deliveries
where status = '保留'
order by tracking_number;                                   -- common_id は NULL


-- ⑥ 正規化で表記ゆれが吸収されているか -----------------------
--    全角スペース／全角ハイフン＋建物名 が同じTownKeyに当たる。
select tracking_number, address, public.normalize_addr(address) as normalized, common_id
from public.deliveries
where tracking_number in ('287477461927','281361685974','275726265038')
order by tracking_number;                                   -- いずれも 箱柳町/高隆寺町 → OKZ_C_01_08


-- ⑦ 郵便番号補助のデモ（第10章）------------------------------
--    郵便番号があれば postal_master で自治体・町名を補完できる
--    （今回の荷物に郵便番号列は無いため判定は町名マッチにフォールバック）。
select postal_code, prefecture, municipality, town from public.postal_master order by postal_code;

-- =============================================================
-- 合格条件との対応
--   ・dry-run件数（丁目/TownKey/不一致）   … match_v0.sql A
--   ・本実行で共通ID付与＋ゾーン/拠点結合   … ①②
--   ・丁目なし/不一致がTownKeyで当たる      … ③（丁目あり荷物も共通IDあり）
--   ・判定不能→未登録住所＋保留            … ④⑤
--   ・同じ正規化で表記ゆれ吸収             … ⑥
--   ・郵便番号補助（無ければ町名フォールバック）… ⑦
-- =============================================================
