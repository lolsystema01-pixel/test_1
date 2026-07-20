-- =============================================================
-- ②実行後の追加診断: zone_plan で解決できない deliveries 4行は何か
--
--   背景（2026-07-17 実測・zone_plan_new_vocab_v0.sql §3）:
--     ② 実行後も deliveries_unresolved = 4（合格条件は 0）。
--     内訳の見立て: audit §2 の旧語彙 804行 = 06-16:4行 + 06-17:800行。
--       ・06-17 の800行 … 旧 zone_plan の8行で解決できる（＝unresolved に出ない）
--       ・06-16 の4行   … 旧8件にも新1653件にも無い＝どこにも解決先が無い
--     → この4行の正体を特定し、③（旧DSPダミー削除）で消えるかを確認する。
--
--   なぜ確認するか:
--     ③の対象は「delivery_date in (2026-06-16, 2026-06-17) かつ common_id が area_master に無い行」。
--     4行がこの条件に入るなら③で消え、②の合格条件（unresolved=0）は③の後に満たされる。
--     入らないなら、③を実行しても unresolved が残る＝別の手当てが要る。
--
--   性質: SELECT のみ（副作用なし）。何度実行してもよい。
--   実行: Supabase SQL Editor（postgres）で丸ごと Run。
-- =============================================================

select
  d.tracking_number,
  d.delivery_date,
  d.common_id,
  -- どこに居ないのか
  exists (select 1 from public.zone_plan zp where zp.common_id = d.common_id)      as in_zone_plan,
  exists (select 1 from public.area_master am
           where am.common_id = d.common_id and am.is_valid)                        as in_area_master,
  exists (select 1 from public.address_master ad where ad.common_id = d.common_id)  as in_address_master,
  -- ③の対象条件に入るか（＝③で消えるか）
  case
    when d.delivery_date in (date '2026-06-16', date '2026-06-17')
         and not exists (select 1 from public.area_master am
                          where am.common_id = d.common_id and am.is_valid)
      then '✅ ③の対象＝③実行で消える（②の合格条件は③の後に満たされる）'
    when d.delivery_date not in (date '2026-06-16', date '2026-06-17')
      then '⚠ ③の対象外（日付が 06-16/06-17 ではない）＝③後も残る。別の手当てが必要'
    else '⚠ ③の対象外（common_id が area_master に存在する）＝想定外'
  end as after_step3
from public.deliveries d
where d.common_id is not null
  and not exists (select 1 from public.zone_plan zp where zp.common_id = d.common_id)
order by d.delivery_date, d.common_id, d.tracking_number;

-- 【読み方】
--   ・after_step3 が全件 ✅ … ②はこのまま完了扱いでよい。③実行後に unresolved=0 になる。
--       （②の合格条件「deliveries.common_id が全て zone_plan に存在」は③の完了をもって満たされる）
--   ・⚠ が出る … ③を実行しても解決しない行がある。②③の順序か対象条件の見直しが必要。
--   ・common_id の値そのものにも注目する。
--       ハンドオフ docs/handoff_status_v0.md §5 に「C0001 は廃止」とあり、
--       正準規格 v1 より前の規格の残骸である可能性がある（その場合も③の日付条件に入れば消える）。
