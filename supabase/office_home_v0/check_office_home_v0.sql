-- =============================================================
-- 指示書: 営業所ホーム 概況カード v0.1 — 手順 3/4：確認
--   概況カードの集計・状態行・再予測合図・（area RLS）を確認する。
-- 実行: Supabase SQL Editor。office_home_summary_v0.sql ＋ seed_office_home_v0.sql の後。
--   ※ RLS自営業所スコープの最終証明はアプリ（area ログイン）の /home 表示で行う
--     （SQL Editor は postgres＝RLSバイパスのため）。
-- =============================================================

-- ① 概況カード（seed の IT01・対象日=current_date）------------------
select office_code, delivery_date, received,
       real_drivers  as "配車済_人数", real_items  as "配車済_件数",
       virt_drivers  as "仮配車_人数", virt_items  as "仮配車_件数",
       last_dispatch_at as "最終配車実行", need_repredict as "再予測合図",
       state_line as "状態行", state_color as "色"
from public.office_home_summary
where office_code = 'IT01' and delivery_date = current_date;
-- 期待: received=13 / 配車済 実2人・6件 / 仮配車 1人・2件 / 再予測合図=true /
--        状態行='再予測してください' / 色='青'

-- ② 集計の内訳整合：ビューの件数＝deliveries 実数と一致 -------------------
with raw as (
  select
    count(*)                                                              as received,
    count(*) filter (where driver_id is not null and driver_id not like '仮%') as real_items,
    count(*) filter (where driver_id like '仮%')                          as virt_items,
    count(*) filter (where driver_id is not null)                        as dispatched
  from public.deliveries
  where office_code = 'IT01' and delivery_date = current_date
)
select r.received, r.real_items, r.virt_items, r.dispatched,
       s.received as v_received, s.real_items as v_real, s.virt_items as v_virt, s.dispatched_items as v_disp,
       case when r.received=s.received and r.real_items=s.real_items
                 and r.virt_items=s.virt_items and r.dispatched=s.dispatched_items
            then 'OK' else 'NG' end as judge
from raw r
cross join (select * from public.office_home_summary
            where office_code='IT01' and delivery_date=current_date) s;
-- 期待: judge=OK（ビュー集計と deliveries 実数が一致）

-- ③ 最終配車実行＝配車ログ(source='配車')の最新時刻 ---------------------
select s.last_dispatch_at as "ビュー最終配車実行",
       (select max(l.changed_at) from public.delivery_status_log l
        join public.deliveries d on d.tracking_number=l.tracking_number
        where d.office_code='IT01' and d.delivery_date=current_date and l.source='配車') as "ログ最新",
       case when s.last_dispatch_at =
            (select max(l.changed_at) from public.delivery_status_log l
             join public.deliveries d on d.tracking_number=l.tracking_number
             where d.office_code='IT01' and d.delivery_date=current_date and l.source='配車')
            then 'OK' else 'NG' end as judge
from public.office_home_summary s
where s.office_code='IT01' and s.delivery_date=current_date;
-- 期待: judge=OK

-- ④ 状態行の導出ロジック（4状態）を1クエリで俯瞰 -----------------------
--   受信0/未配車/再予測/仕分完了 の分岐が state_line に正しく出るか（seed変化で確認）
select delivery_date, received, dispatched_items, sorted_items, need_repredict, state_line, state_color
from public.office_home_summary
where office_code='IT01' and delivery_date = current_date;
-- 期待（seed直後）: 状態行='再予測してください'・色='青'
--   ※ seed末尾の「▼追加検証」を流すと '仕分け完了・出力可能'・'緑' に変わる。

-- =============================================================
-- ⑤ 規約の実証：security_invoker=on（RLS継承）が付いているか
--   ※ これが無いとビューは所有者権限で走り、area RLSが効かない（重大）。
-- =============================================================
select relname,
       coalesce(array_to_string(reloptions, ','), '(なし)') as reloptions,
       case when coalesce(array_to_string(reloptions, ','), '') ~ 'security_invoker=(on|true)'
            then 'OK' else 'NG(RLS継承されない)' end as judge
from pg_class where relname = 'office_home_summary';
-- 期待: reloptions=security_invoker=on / judge=OK

-- =============================================================
-- ⑥ 列名一致の実証：ビュー列 = フロント型 OfficeHomeCard
--   （+page.server.ts / +page.svelte の OfficeHomeCard と1:1で揃っていること）
-- =============================================================
with need(col) as (values
  ('office_code'),('delivery_date'),('received'),('real_drivers'),('real_items'),
  ('virt_drivers'),('virt_items'),('dispatched_items'),('sorted_items'),
  ('last_dispatch_at'),('last_import_at'),('need_repredict'),('state_line'),('state_color'))
select n.col,
       case when c.column_name is null then 'NG(欠落)' else 'OK' end as judge
from need n
left join information_schema.columns c
  on c.table_schema = 'public' and c.table_name = 'office_home_summary' and c.column_name = n.col
order by n.col;
-- 期待: 全行 OK（1つでもNGならフロントが undefined を読む）

-- =============================================================
-- ⑦ ステータス実値の確認：DBは '配車済'/'仕分済'（表示ラベルの「配車済み」ではない）
--   ※ ビューは driver_id で実/仮を判定し、仕分済のみ status を見る。誤字参照が無いことを確認。
-- =============================================================
select status, count(*) from public.deliveries
where office_code = 'IT01' and delivery_date = current_date
group by status order by status;
-- 期待: '未配車' / '配車済'（'配車済み' は存在しない）

select case when pg_get_viewdef('public.office_home_summary'::regclass, true) like '%配車済み%'
            then 'NG(ビューが 配車済み を参照)' else 'OK' end as judge_no_typo,
       case when pg_get_viewdef('public.office_home_summary'::regclass, true) like '%仕分済%'
            then 'OK' else 'NG(仕分済 の参照が無い)' end as judge_sorted;
-- 期待: judge_no_typo=OK / judge_sorted=OK

-- =============================================================
-- ⑧ Realtime publication に載っているか（Supabase専用・購読の前提）
-- =============================================================
select tablename,
       case when tablename is not null then 'OK' else 'NG' end as judge
from pg_publication_tables
where pubname = 'supabase_realtime' and schemaname = 'public'
  and tablename in ('deliveries','delivery_status_log')
order by tablename;
-- 期待: deliveries / delivery_status_log の2行（無いとRealtimeイベントが配信されない）

-- =============================================================
-- ⑨ area RLS（自営業所のみ）— アプリ実機で証明（SQL Editorはバイパス）
--   ・area/IT01 でログイン → /home に IT01 の1枚だけ出る。
--   ・他営業所(例 A01)のカードは出ない（範囲外0件）。
--   ・別セッションで OH-% を更新 → カードが自動更新（Realtime）＋手動更新ボタン。
--   ・ビュー未適用時は「本日の受信はありません(緑)」ではなく赤いエラー帯が出ること。
-- =============================================================
