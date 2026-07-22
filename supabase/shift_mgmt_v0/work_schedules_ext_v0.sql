-- =============================================================
-- 指示書: シフト管理（DB＋書き込み口）v0.7 — work_schedules 列拡張（v0.5）
--   §12.2.1 日次シフト（希望エリア複数）／§12.5.2 希望エリア（配車）
-- 実行: Supabase SQL Editor（postgres）で丸ごと Run。冪等。
-- =============================================================
-- 【固定の前提】新基盤(Supabase+SvelteKit+Cloud Run)・検証環境のみ・本番/現行GASは触らない・
--   全テーブルRLS（読取ロール別・書込はDEFINER関数のみ・write policyは作らない）・秘密は環境変数。
--
-- 【この SQL の範囲】work_schedules に3列を追加するだけ（書き込み口＝別ファイル shift_write_definers_v0.sql）。
--   ・preferred_areas … 希望エリア（common_id の配列）。配車 #28/#29 が同じ common_id で突合する。
--   ・is_virtual      … 仮ドライバー枠フラグ（将来用の器）。※下記【is_virtual の設計判断】参照。
--   ・is_absent       … 欠勤状態（当日欠勤の記録）。承認済みでも欠勤なら cap に入れない運用の土台。
--
-- 【v0.4 ルール：既定値を入れない】
--   新設列に default を置かない＝既存行（basket 等 admin_settings の実データ）を一切書き換えない。
--   3列とも NULL 許容で追加し、default 句を付けない（ALTER が既存行を touch しない）。
--
-- 【is_virtual の設計判断（業務A確認済み 2026-07-20）】
--   ＝(a) フラグ列だけ。work_schedules.driver_id は drivers への FK であり、
--     仮ドライバー（仮N）は drivers マスタに存在しない（配車エンジンが実行時に dispatch_drivers 上に
--     一時生成するだけ）。よって「仮の稼働も work_schedules に入れる」(b) は FK を外すことになり
--     既存設計の前提が崩れる。本 v0.7 では **FK は触らず、列だけ用意**する。
--     将来「仮ドライバー枠を稼働予定として持つ」要件が出たら、そのとき別途設計（別テーブル or FK 見直し）。
-- =============================================================


-- =============================================================
-- §1. 列追加（default なし・既存行不変・冪等）
-- =============================================================
alter table public.work_schedules add column if not exists preferred_areas text[];
alter table public.work_schedules add column if not exists is_virtual      boolean;
alter table public.work_schedules add column if not exists is_absent       boolean;

comment on column public.work_schedules.preferred_areas is
  '希望エリア（common_id の配列）。§12.5.2。配車#28の主担当ゾーン優先・#29の突合が同じ common_id で行う。表示名の解決は #28 の表示名ビュー（未実装なら common_id のまま）。NULL/空=希望なし';
comment on column public.work_schedules.is_virtual is
  '仮ドライバー枠フラグ（将来用の器）。実データは実ドライバーのみ＝通常 NULL/false。仮ドライバー(仮N)は drivers に無く配車エンジンが dispatch_drivers 上に生成するため、本列は work_schedules 側の予約枠管理用';
comment on column public.work_schedules.is_absent is
  '欠勤状態。承認済み(application_status=承認)でも当日欠勤なら true。cap 集計（承認済み人数/時間）から除外する運用の土台。NULL/false=出勤';


-- =============================================================
-- §2. 希望エリアの妥当性ガード（CHECK・冪等）
--   ・preferred_areas は common_id の配列。空文字・NULL要素・重複を弾く（データ品質）。
--   ・重複を許すと #29 の突合で二重計上になるため、要素の一意性を制約する。
--   ⚠ CHECK 制約にサブクエリは書けない（0A000）ため、判定は immutable 関数に切り出して参照する。
-- =============================================================
create or replace function public.preferred_areas_ok(a text[])
returns boolean
language sql
immutable
as $$
  select a is null
     or (
       array_position(a, null) is null                                   -- NULL 要素なし
       and array_position(array(select btrim(e) from unnest(a) e), '') is null  -- 空文字/空白のみなし
       and cardinality(a) = cardinality(array(select distinct e from unnest(a) e))  -- 重複なし
     )
$$;
comment on function public.preferred_areas_ok(text[]) is
  '希望エリア配列(common_id[])の受理判定：NULL要素なし・空文字なし・重複なし。work_schedules の CHECK が参照';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'work_schedules_preferred_areas_chk') then
    alter table public.work_schedules add constraint work_schedules_preferred_areas_chk
      check ( public.preferred_areas_ok(preferred_areas) );
  end if;
end $$;


-- =============================================================
-- §2-2. ★1日1稼働/ドライバー の一意制約（業務A確定 2026-07-20）
--   理由: cap＝skill×hours は「1日1つの hours」を前提にしており、dispatch_drivers の PK が
--     (run_date, driver_id) ＝「1日1ドライバー1cap」。同一 (driver, date) の承認が2行あると
--     dispatch_build (1) が dispatch_drivers に2行 INSERT しようとして 23505 で **その日の配車が
--     全営業所巻き添えで全停止**する（レビュー指摘・実証済み）。
--   → work_schedules に UNIQUE(driver_id, work_date) を張り、定義域として「1日1稼働」を強制する。
--     これで「同日2承認による配車全停止」と「二重申請の check-then-insert TOCTOU」を同時に塞ぐ。
--   ⚠ 既存データに同一 (driver, date) が複数あると制約追加が失敗する。その場合は重複を解消してから。
-- =============================================================
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'work_schedules_driver_date_uq') then
    alter table public.work_schedules add constraint work_schedules_driver_date_uq
      unique (driver_id, work_date);
  end if;
end $$;


-- =============================================================
-- §3. 希望エリア重複警告（common_id 単位・SELECTのみ・任意実行）
--   同一 (driver_id, work_date) に希望エリアが複数行で重なっていないか等の点検用。
--   ※本 v0.7 は1稼働=1行に希望エリア配列を持つ設計なので、行内重複は §2 CHECK が防ぐ。
--     ここは「同じ common_id を希望するドライバーが同日に何人いるか」を配車前に見るための集計。
-- =============================================================
select w.work_date, area.common_id, count(*) as drivers_wanting
from public.work_schedules w
cross join lateral unnest(coalesce(w.preferred_areas, '{}')) as area(common_id)
where w.application_status = '承認' and coalesce(w.is_absent, false) = false
group by w.work_date, area.common_id
having count(*) > 1
order by w.work_date, drivers_wanting desc;
-- 期待: 希望が重なる (日付, common_id) が人数付きで出る。0行なら重複なし。
--   配車 #28 はこの希望を「主担当ゾーン選択の優先」に使う（複数人が同じエリアを希望＝要調整の芽）。


-- =============================================================
-- §4. 確認（列が入ったか・既存行が不変か）
-- =============================================================
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'work_schedules'
  and column_name in ('preferred_areas','is_virtual','is_absent')
order by column_name;
-- 期待: 3列とも is_nullable=YES / column_default=NULL（既定値なし＝既存行を書き換えない）。
