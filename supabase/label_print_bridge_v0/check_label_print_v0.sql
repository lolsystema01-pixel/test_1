-- =============================================================
-- ラベル印刷ブリッジ v0.4 確認SQL
-- 実行: label_payload_v0.sql の後。各 begin〜rollback は選択して個別実行。
-- ★ 対象日は既定 current_date。実データが別日なら 'YYYY-MM-DD' に置換。
-- =============================================================

-- ⓪ ラベル対象（採番済）のある日付 -------------------------------------
select delivery_date, count(*) as labels, count(distinct driver_id) as drivers
from public.label_payload
group by delivery_date order by delivery_date;


-- ① ペイロード（機種非依存：かご記号・配達順・問合番号のみ）---------------
select office_code, driver_id, basket_code, delivery_order, tracking_number
from public.label_payload
where delivery_date = current_date
order by office_code, driver_id, delivery_order
limit 20;
-- 期待: 大ラベル＝basket_code＋delivery_order / 小ラベル＝tracking_number。住所・氏名の列が無い。

-- ペイロードに住所・氏名が含まれないこと（列名で確認）。
select string_agg(column_name, ', ') as label_payload_columns
from information_schema.columns
where table_schema='public' and table_name='label_payload';
-- 期待: address / recipient_name を含まない（office_code,delivery_date,driver_id,tracking_number,basket_code,delivery_order）


-- ② area：自営業所のみ（他営業所0件）------------------------------------
--    ★ 自分の area アカウントの sub(UUID) に置換（select user_id from profiles where role='area';）。
begin;
  set local request.jwt.claims = '{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000000a1"}';
  set local role authenticated;
  select 'area' as who,
    (select count(*) from public.label_payload where delivery_date=current_date)                                   as "対象件数",
    (select count(distinct office_code) from public.label_payload where delivery_date=current_date)                as "見える営業所数(1期待)",
    (select count(*) from public.label_payload where delivery_date=current_date
        and office_code <> coalesce((select office_code from public.profiles where user_id=auth.uid()),''))        as "他営業所(0期待)";
rollback;


-- ③ 印刷履歴 record_prints（記録→再印刷→自営業所のみ可視）----------------
--    ★ area UUID を自分のものに置換して実行。
begin;
  set local request.jwt.claims = '{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000000a1"}';
  set local role authenticated;
  -- 記録（印刷）
  select public.record_prints(jsonb_build_array(
    jsonb_build_object('tracking_number','LBL-TEST-1','basket_code','A','delivery_order',1,'kind','print','terminal_id','T-001')
  )) as inserted_print;
  -- 再印刷（kind=reprint）
  select public.record_prints(jsonb_build_array(
    jsonb_build_object('tracking_number','LBL-TEST-1','basket_code','A','delivery_order',1,'kind','reprint','terminal_id','T-001')
  )) as inserted_reprint;
  -- 自営業所の履歴が見える（printed_by=自分・office=自営業所に固定）
  select count(*) as "自分の履歴(2期待)", count(*) filter (where kind='reprint') as "再印刷(1期待)"
  from public.print_history where tracking_number='LBL-TEST-1';
rollback;  -- ★テスト履歴は残さない

-- =============================================================
-- 合格条件との対応
--   ・ペイロード（かご記号・配達順・問合番号）が1荷物単位        … ①
--   ・住所/氏名を載せない                                       … ①（列に無い）
--   ・area RLSで自営業所のみ                                    … ②（他営業所0）
--   ・印刷履歴が記録され再印刷できる                            … ③（print+reprint=2）
--   ・PDF出力（大/小・数字のみ・バーコード枠OFF）/ON-OFF/送信フック … フロント /label・label.ts 単体で確認
--   ・アダプタ契約・外注仕様                                    … docs/label_print_bridge_v0/
-- =============================================================
