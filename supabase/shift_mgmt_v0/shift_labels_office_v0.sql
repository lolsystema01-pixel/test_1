-- =============================================================
-- 指示書: シフト管理 v0.7 — 入力規則マスタ＝営業所別 shift_labels（v0.5・§12.2.3）
--   稼働区分（ラベル）→ 稼働時間(hours) を **営業所別** に持つ。cap の時間側がこれを参照する。
-- 実行: Supabase SQL Editor（postgres）で丸ごと Run。冪等。
--   ★適用順: 本ファイル → cap_wire_shift_labels_v0.sql（dispatch_build の参照差替）の順。
-- =============================================================
-- 【固定の前提】新基盤・検証環境のみ・全テーブルRLS（読取ロール別・書込DEFINER一本化）・秘密は環境変数。
--
-- 【なぜ営業所別か（§12.2.3）】営業所ごとに稼働時間が違いうる（フル=8h の営業所もあれば別値もある）。
--   グローバルな shift_hours（work_type→hours 単一）では表現できないため、(office_code, work_type) を PK にする。
--
-- 【移行方針（v0.4 回帰・業務A確認済み 2026-07-20）】
--   ・既存 shift_hours の全行を **全営業所ぶん複製** して shift_labels を作る。
--     → 移行直後は全営業所が同じラベル・同じ時間＝**既存 cap は1件も変わらない（回帰が成立）**。
--     → 「営業所別に定義できる」器は満たす（実態と違えば管理者設定でその営業所の行だけ編集）。
--   ・IT01 の「フル 8h」も自動的に含まれる（shift_hours に フル=8 があるため）。
--   ・shift_hours は消さない（配車の旧経路・verify_rls_scope 等が参照）。cap の参照先だけ切り替える。
--
-- 【ラベル未定義＝エラーの思想（指示書）】
--   cap は shift_labels を参照するため、承認済み稼働の (office, work_type) が未定義だと配車が成り立たない。
--   → フォールバック（既定8h等）はしない。cap_wire 側で事前チェックし **名指しで raise** する。
--     新設営業所へは seed_office_shift_labels() で明示配布する（自動実行はしない・下記）。
-- =============================================================


-- =============================================================
-- §1. shift_labels テーブル（営業所別ラベル→時間）
-- =============================================================
create table if not exists public.shift_labels (
  office_code text    not null references public.offices(office_code),
  work_type   text    not null,                 -- 稼働区分ラベル（フル/6時間/2時間/半日 等）
  hours       numeric not null check (hours > 0 and hours <= 24),
  primary key (office_code, work_type)
);
comment on table public.shift_labels is
  '入力規則マスタ（§12.2.3）: 営業所別の稼働区分ラベル→稼働時間(hours)。cap＝スキル×時間 の時間側（#27の式は無変更・参照先のみ）。旧 shift_hours（グローバル）の営業所別版';


-- =============================================================
-- §2. RLS（読取: hq=全件 ／ area=自営業所のみ。書込ポリシーは作らない＝規約）
-- =============================================================
alter table public.shift_labels enable row level security;
grant select on public.shift_labels to authenticated;
drop policy if exists shift_labels_hq   on public.shift_labels;
drop policy if exists shift_labels_area on public.shift_labels;
create policy shift_labels_hq   on public.shift_labels for select to authenticated
  using ( public.my_role() = 'hq' );
create policy shift_labels_area on public.shift_labels for select to authenticated
  using ( public.my_role() = 'area' and office_code = public.my_office() );


-- =============================================================
-- §3. 標準ラベルの配布口（新設営業所へ手動で撒く・自動実行しない）
--   ・shift_hours の内容を1営業所ぶん shift_labels に入れる（既存を上書きしない＝do nothing）。
--   ・★自動では呼ばない。営業所追加時に管理者が「標準を入れる」か「独自定義する」を選ぶ（指示書の
--     『必ず営業所で定義させる』を守る）。撒いた後は NOTICE で「標準初期値・実態と違えば修正」を促す。
-- =============================================================
create or replace function public.seed_office_shift_labels(p_office_code text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_inserted integer;
begin
  if public.my_role() is distinct from 'hq' then
    raise exception '標準ラベルを配布できるのは管理者(hq)のみです (role=%)',
      coalesce(public.my_role(), '(未設定)') using errcode = '42501';
  end if;
  if not exists (select 1 from public.offices o where o.office_code = p_office_code) then
    raise exception '営業所が存在しません: %', p_office_code using errcode = 'P0002';
  end if;

  insert into public.shift_labels (office_code, work_type, hours)
  select p_office_code, sh.work_type, sh.hours
  from public.shift_hours sh
  on conflict (office_code, work_type) do nothing;   -- 既存は上書きしない
  get diagnostics v_inserted = row_count;

  raise notice '営業所 % に標準ラベルを % 件配布しました。★これは標準の初期値です。実態と違う場合は管理者設定で修正してください。',
    p_office_code, v_inserted;
  return v_inserted;
end $$;
comment on function public.seed_office_shift_labels(text) is
  '新設営業所へ標準ラベル（shift_hours 由来）を配布（hqのみ・冪等）。自動実行しない＝営業所追加時に管理者が選ぶ。標準初期値のため実態と違えば要修正（§12.2.3）';
revoke execute on function public.seed_office_shift_labels(text) from public;
grant  execute on function public.seed_office_shift_labels(text) to authenticated;


-- =============================================================
-- §4. 既存営業所への移行（shift_hours 全行 × 全営業所 を複製）
--   ・postgres 実行（RLSバイパス）なので seed 関数を通さず直接複製する（移行は一度きりの管理作業）。
--   ・既存 shift_labels は上書きしない（do nothing）＝再実行しても増減しない（冪等）。
-- =============================================================
insert into public.shift_labels (office_code, work_type, hours)
select o.office_code, sh.work_type, sh.hours
from public.offices o
cross join public.shift_hours sh
on conflict (office_code, work_type) do nothing;


-- =============================================================
-- §5. 確認
-- =============================================================
-- (a) 営業所×ラベルが全て入ったか（= 営業所数 × shift_hours 行数）
select
  (select count(*) from public.offices)                                   as offices,
  (select count(*) from public.shift_hours)                               as labels_per_office,
  (select count(*) from public.offices) * (select count(*) from public.shift_hours) as expected,
  (select count(*) from public.shift_labels)                              as actual;
-- 期待: expected = actual（全営業所に全ラベルが複製された）。

-- (b) cap 回帰の下地: shift_labels の hours が shift_hours と一致すること（差分0が合格）
select sl.office_code, sl.work_type, sl.hours as label_hours, sh.hours as global_hours
from public.shift_labels sl
join public.shift_hours sh on sh.work_type = sl.work_type
where sl.hours <> sh.hours;
-- 期待: 0行（移行直後は全営業所が shift_hours と同値＝cap が変わらない）。
