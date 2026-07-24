-- =============================================================
-- 指示書: 配車 割当優先順位（希望エリア第一）v0.3 — ① 設定列 offices.preferred_area_first
--   §12.5.2 割当優先順位（希望エリア第1）。dispatch_build に「希望エリア第一」を追加する切替スイッチ。
-- 実行: Supabase SQL Editor（postgres）で丸ごと Run。冪等。
-- =============================================================
-- 【固定の前提】新基盤・検証環境のみ・本番/現行GASは触らない・全テーブルRLS（読取ロール別・
--   書込はDEFINER関数のみ・write policyは作らない）・秘密は環境変数。
--
-- 【この列の役割】
--   ・preferred_area_first = true のとき、dispatch_build が Phase1 主担当ゾーン選定で
--     「担当ドライバーの希望エリア(preferred_areas)に含まれる common_id」を最優先にする。
--   ・既定 false ＝ 現行の「残荷量最大」のまま（回帰一致）。営業所ごとに切替できる。
--
-- 【既存 offices.dispatch_priority（Phase2充填方式）とは別軸】
--   dispatch_priority（処理能力優先/最低保証優先）とは意味が異なるため**混ぜず別列**で持つ（指示書明記）。
--   本列は Phase1 の主担当"並び"だけを切替える。dispatch_priority の意味は変えない。
-- =============================================================

alter table public.offices
  add column if not exists preferred_area_first boolean not null default false;

comment on column public.offices.preferred_area_first is
  '配車の主担当ゾーン選定で「担当ドライバーの希望エリア(work_schedules.preferred_areas)一致」を最優先にするか（§12.5.2）。'
  '既定false=現行の残荷量最大（回帰一致）。dispatch_priority(Phase2充填方式)とは別軸。dispatch_build が関数内で参照';


-- =============================================================
-- 確認：列が入ったか・既定が false か
-- =============================================================
select column_name, data_type, column_default, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'offices' and column_name = 'preferred_area_first';
-- 期待: boolean / false / NO（not null・既定false）。
