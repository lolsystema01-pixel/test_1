-- =============================================================
-- 配達実績の記録口（ステータス遷移）v0 確認SQL
-- 実行: status_log_v0.sql → record_status_transition_v0.sql の後。各ブロックを個別に実行。
-- ★ 状態を汚さないため、遷移デモは begin … rollback で包む（本番値を残さない）。
-- =============================================================

-- ⓪ 現在の status 分布 ------------------------------------------------
select status, count(*) from public.deliveries group by status order by status;


-- ① 全遷移が順に通る（未配車→配車済→仕分済→配送中→完了）---------------
--    既存の「未配車」荷物を1件選び、記録口で順に遷移。各ステップの戻り値を確認。
begin;
  -- 対象（未配車を1件）。無ければ DSP-* など別の起点に変更。
  create temporary table _t on commit drop as
    select tracking_number from public.deliveries where status='未配車' limit 1;

  select public.record_status_transition((select tracking_number from _t), '配車済', '配車')  as step1_配車済;
  select public.record_status_transition((select tracking_number from _t), '仕分済', '仕分け') as step2_仕分済;
  select public.record_status_transition((select tracking_number from _t), '配送中', '配達')   as step3_配送中;
  select public.record_status_transition((select tracking_number from _t), '完了',   '配達')   as step4_完了;

  -- ③ status一致：deliveries.status と最新ログ to_status が一致
  select d.tracking_number, d.status as deliveries_status,
         (select l.to_status from public.delivery_status_log l
          where l.tracking_number=d.tracking_number order by l.changed_at desc, l.id desc limit 1) as latest_log,
         (select count(*) from public.delivery_status_log l where l.tracking_number=d.tracking_number) as log_rows
  from public.deliveries d where d.tracking_number=(select tracking_number from _t);
  -- 期待: deliveries_status='完了'・latest_log='完了'・log_rows=4（各遷移1行）
rollback;  -- ★デモの遷移は戻す


-- ②a 許可外遷移（順序飛ばし）は拒否 ------------------------------------
--    未配車→仕分済（配車済を飛ばす）。エラー（許可されない遷移）になればOK。
begin;
  select public.record_status_transition(
    (select tracking_number from public.deliveries where status='未配車' limit 1),
    '仕分済', '手動');
rollback;
-- 期待: ERROR  許可されない遷移です（未配車 → 仕分済）…

-- ②b 逆行（配送中→未配車）も拒否（別途、配送中の1件で）------------------
--    起点が無ければスキップ可。
begin;
  -- 一時的に配送中まで進めてから逆行を試す
  create temporary table _t2 on commit drop as
    select tracking_number from public.deliveries where status='未配車' limit 1;
  select public.record_status_transition((select tracking_number from _t2),'配車済','配車');
  select public.record_status_transition((select tracking_number from _t2),'仕分済','仕分け');
  select public.record_status_transition((select tracking_number from _t2),'配送中','配達');
  select public.record_status_transition((select tracking_number from _t2),'未配車','手動'); -- 逆行
rollback;
-- 期待: ERROR  許可されない遷移です（配送中 → 未配車）…


-- ④ RLS：見える荷物に属するログだけ見える（area＝自営業所のみ）-----------
--    ★ sub を自分の area UUID に置換（select user_id from profiles where role='area';）。
--    事前に配車寄せ替え（dispatch_status_hook_v0.sql）でログが入っている前提。
begin;
  set local request.jwt.claims = '{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000000a1"}';
  set local role authenticated;
  select 'area' as who,
    count(*)                                                                              as "見えるログ総数",
    count(*) filter (where l.tracking_number in
        (select tracking_number from public.deliveries))                                  as "自スコープ内(=総数)",
    count(distinct d.office_code)                                                         as "見える営業所数(1期待)"
  from public.delivery_status_log l
  left join public.deliveries d on d.tracking_number = l.tracking_number;
rollback;
-- 期待: area は自営業所のログのみ（join先 deliveries も自営業所のみ＝見える営業所数1・範囲外0）

-- =============================================================
-- 合格条件との対応
--   ・delivery_status_log に from/to/changed_at/actor/source で1行ずつ          … ①（log_rows=4）
--   ・記録口で線形遷移が順に通る／許可外は拒否                                  … ①／②a②b
--   ・deliveries.status と最新ログが一致（不可分更新）                          … ①（③ブロック）
--   ・配車 v0.5 の 未配車→配車済 が記録口経由でログに残る                       … dispatch_status_hook_v0.sql
--   ・RLSで自スコープのログのみ                                               … ④
-- =============================================================
