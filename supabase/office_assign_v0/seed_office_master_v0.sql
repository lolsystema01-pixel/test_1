-- =============================================================
-- 指示書: 拠点振分 v0.2 — 手順 1/3
--   拠点/営業所マスタを seed（非版管理の設定マスタ）。拠点→営業所 1:1（5.4）。
--   対応: 要件定義 5.4（拠点＝営業所の親・既定1:1）/ 9.2（拠点/営業所マスタ）
-- 実行: Supabase SQL Editor に貼り付けて Run（前提: 全国Master・ZonePlan 読込済み）。
-- =============================================================
-- ・拠点/営業所は版管理対象外 → CSV取込不要、直接seed。
-- ・★正準ダミーデータ規格 v1（docs/dummy_data_standard_v1.md）に統一：
--     depot_code は英コード D01/D02（旧版の '愛知県1'/'愛知県2' 日本語コードは廃止）。
--     名称は depot_name='愛知県第1拠点' / office_name='愛知県1営業所'。
--   ここが「共通ID→拠点→営業所」の経路の接続点。zone_plan/address_master.depot_code
--   （load_master_v0 で D01/D02）と offices.depot_code を一致させ、関係結合で振り分ける。
-- ・既定 1拠点=1営業所（1:1）。D01→A01 / D02→C01。
-- =============================================================


-- =============================================================
-- §0. 余り（B01）が残っていれば削除して 1:1 に整理（冪等・FK順）
--   正準規格では B01 は廃止。旧データに B01 が残る環境のための後方互換クリーンアップ。
-- =============================================================
delete from public.work_schedules
 where driver_id in (select driver_id from public.drivers where office_code = 'B01');
delete from public.drivers  where office_code = 'B01';
update public.profiles set office_code = NULL where office_code = 'B01';
delete from public.offices  where office_code = 'B01';


-- =============================================================
-- §1. 拠点マスタ（depots）：英コード D01/D02・愛知県名称（冪等）
-- =============================================================
insert into public.depots (depot_code, depot_name) values
  ('D01','愛知県第1拠点'),   -- 岡崎市・豊田市 ほか
  ('D02','愛知県第2拠点')    -- 東海市・知多市 ほか
  on conflict (depot_code) do update set depot_name = excluded.depot_name;


-- =============================================================
-- §2. 営業所（offices）：A01(D01)/C01(D02)・愛知県名称（冪等）
--   office_code は温存して drivers.office_code(FK) の紐付きを壊さない。
-- =============================================================
insert into public.offices
  (office_code, depot_code, office_name, dispatch_priority, basket_order, basket_cart_limit, autosave_threshold, request_period_days) values
  ('A01','D01','愛知県1営業所','処理能力優先','ドライバー順',10,50,30),
  ('C01','D02','愛知県2営業所','処理能力優先','ドライバー順',10,50,30)
  on conflict (office_code) do update
    set depot_code  = excluded.depot_code,
        office_name = excluded.office_name;


-- =============================================================
-- §3. 確認（seed 結果：拠点と営業所が 1:1）
-- =============================================================
select d.depot_code, d.depot_name, o.office_code, o.office_name
from public.depots d
left join public.offices o on o.depot_code = d.depot_code
order by d.depot_code, o.office_code;
-- 期待: D01→A01(愛知県1営業所) / D02→C01(愛知県2営業所) の2行（各拠点に営業所1つ＝1:1）

-- 営業所が1拠点に1つ（1:1）であることの確認（>1 の行が出なければOK）
select depot_code, count(*) as office_count
from public.offices
group by depot_code
having count(*) > 1;
-- 期待: 0行（どの拠点も営業所は1つ）
