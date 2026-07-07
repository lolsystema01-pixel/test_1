-- =============================================================
-- 配達実績の記録口（ステータス遷移）v0 — ③ 配車v0.5 の status更新を記録口へ寄せ替え
--   対応: 6.10。配車 v0.5 §B の「未配車→配車済」直UPDATE を、記録口呼び出しに差し替える。
-- 実行: Supabase SQL Editor。前提=record_status_transition_v0.sql・配車v0.5・dispatch_assignments 確定済み。
-- =============================================================
-- ★ dispatch_v0.sql の §B（本実行）にあった次の直UPDATEを廃止し、本パッチの手順に置換する：
--     update public.deliveries d set driver_id=a.driver_id, status='配車済'
--     from public.dispatch_assignments a where a.run_date=current_date and a.tracking_number=d.tracking_number;
--   → driver_id 付与（status以外）は従来どおり直更新。status の変更だけ「記録口」経由にし、ログを残す。
-- =============================================================

-- (0) 配車計算（dry-run と同じ・冪等）
select public.dispatch_build(current_date);

-- (1) driver_id の付与（status は触らない）
update public.deliveries d
set driver_id = a.driver_id
from public.dispatch_assignments a
where a.run_date = current_date
  and a.tracking_number = d.tracking_number;

-- (2) status「未配車→配車済」を “記録口” で確定（1荷物=1呼び出し＝ログ1行）。source='配車'。
--     記録口が ①遷移検証 ②status更新 ③ログ記録 を不可分に行う。
do $$
declare
  r record;
begin
  for r in
    select a.tracking_number
    from public.dispatch_assignments a
    join public.deliveries d on d.tracking_number = a.tracking_number
    where a.run_date = current_date
      and d.status = '未配車'              -- 既に配車済の再実行はスキップ（冪等）
  loop
    perform public.record_status_transition(r.tracking_number, '配車済', '配車', null);
  end loop;
end $$;

-- 確定件数（配車済＝800・未配車＝0 を期待）
select status, count(*) as cnt
from public.deliveries where tracking_number like 'DSP-%'
group by status order by status;

-- 記録口経由でログが残ったか（配車済への遷移件数）
select count(*) as dispatched_log
from public.delivery_status_log
where to_status = '配車済' and source = '配車';

-- =============================================================
-- 注: 大量件数（数千〜万）でも commit は一度きり。性能が要れば set-based 版
--   （update + insert ... select を記録口と同じ検証で）に置換可能。本書は「口を関数1本」を優先し per-row。
-- 採番一式は status を変えない（配達順→かご記号→問合Index同期のみ）＝寄せ替え不要。
-- =============================================================
