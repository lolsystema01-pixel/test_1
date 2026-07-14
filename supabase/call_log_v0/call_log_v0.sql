-- =============================================================
-- 通話・対応ログ＋折り返しリスト v0 — 表 call_logs ＋ 記録口2関数 ＋ ビュー callback_queue
--   対応: 要件定義 §9.2「通話・対応ログ」エンティティ／設計原理§0「例外はすべて折り返しリストに落ちる」。
--   正本: docs/shijisho_drafts/shijisho_call_log_v0_1_draft.md（承認済み）の列定義に整合。
--   指示書❷（AI電話計画）。電話番号申請・会話エンジン(❸)・音声接続(❹)とは無関係に着手可能。
-- 実行: Supabase SQL Editor。1文ずつコピペ→Run（ブロック選択でCtrl+Enter個別実行）。
-- =============================================================
-- ・1通話＝1行。書き込みは record_call_log（記録）／resolve_callback（折り返し解決）の2関数に集約。
--   本表に書込みポリシー（INSERT/UPDATE/DELETE）は置かない＝関数経由のみ。
-- ・SELECTは deliveries 継承ではない。通話は着信時点でどの営業所の荷物か不明（判明前に受電）なので、
--   CS（配達センター）横断で hq/depot/area は全件可視、driver/shipper/anon は0件（役割ベースRLS）。
-- =============================================================

create table if not exists public.call_logs (
  -- 通話識別 -------------------------------------------------------------
  id                 bigint generated always as identity primary key,
  call_sid           text not null unique,        -- 通話ID（Twilio等）。record_call_log の冪等キー
  channel            text not null default 'ai_phone'
                     check (channel in ('ai_phone','phone')), -- 経路（AI電話 / 電話）
  started_at         timestamptz,                  -- 通話開始時刻
  ended_at           timestamptz,                  -- 通話終了時刻
  duration_sec       integer,                      -- 通話時間（秒）
  -- 相手 -----------------------------------------------------------------
  caller_phone       text,                         -- 発信者番号（非通知はnull）
  -- 内容 -----------------------------------------------------------------
  tracking_number    text,                         -- 問合番号（判明時のみ・FKなしのゆるい参照）
  band_key           text,                         -- 番号帯（number_bands.band_key 相当・FKなし）
  intent             text,                         -- 用件分類（再配達/状況照会/クレーム/その他 等・自由文字列）
  summary            text,                         -- AI要約
  transcript         text,                         -- 全文文字起こし
  recording_url      text,                         -- 録音URL（メタのみ・音声本体はTwilio側・保持期間は範囲外）
  -- 結果 -----------------------------------------------------------------
  outcome            text not null default 'AI完結'
                     check (outcome in ('AI完結','転送済','折り返し要','中断','いたずら')),
  receipt_no         text,                         -- 受付登録につながった場合の受付番号（reception_write_v0連携・FKなし）
  priority           int not null default 0,       -- 優先度（大きいほど先頭。クレーム等はengine側で高くする）
  -- 折り返し管理 ---------------------------------------------------------
  callback_status    text not null default '不要'
                     check (callback_status in ('待ち','完了','不要')),
  callback_by        uuid,                         -- 掛け直し担当（auth.uid()）
  callback_at        timestamptz,                  -- 掛け直し完了時刻
  callback_note      text,                         -- 折り返しメモ
  -- 記録メタ -------------------------------------------------------------
  created_at         timestamptz not null default now(),
  created_by         uuid                          -- 記録時の auth.uid()（anon／system はnull）
);

comment on table public.call_logs is
  '通話・対応ログ（要件定義§9.2）。AI電話の1通話=1行。書き込みは record_call_log/resolve_callback 関数経由。SELECTは役割ベース（hq/depot/area=全件、driver/shipper/anon=0件）＝通話は着信時点で営業所に帰属しないため';

comment on column public.call_logs.caller_phone is '発信者番号。PII（非通知時はnull）';
comment on column public.call_logs.transcript   is '全文文字起こし。PII';
comment on column public.call_logs.recording_url is '録音URL（メタのみ）。PII';

create index if not exists idx_call_logs_callback
  on public.call_logs (callback_status, priority desc, created_at);
-- call_sid は unique 制約で索引済み（明示のインデックスは不要）。

-- RLS：SELECTのみ。書込みポリシーは置かない（関数経由のみ）。
alter table public.call_logs enable row level security;
grant select on public.call_logs to authenticated;
-- ★anon には SELECT 権を与えない（受電直後の未認証経路は record_call_log の書込みのみ許可）。

drop policy if exists call_logs_cs on public.call_logs;
create policy call_logs_cs on public.call_logs for select to authenticated
  using ( public.my_role() in ('hq','depot','area') );
-- 通話は着信時点で営業所に帰属しないため CS横断で hq/depot/area は全件可視。
-- driver/shipper は my_role() が該当しないため0件（範囲外0件・default-deny）。


-- =============================================================
-- 記録口① record_call_log（SECURITY DEFINER・冪等・authenticated＋anon）
--   会話エンジン(❸)/音声接続(❹)が通話終了時に呼ぶ。call_sid で冪等（同一通話の二重記録なし）。
-- =============================================================
create or replace function public.record_call_log(
  p_call_sid         text,
  p_caller_phone     text        default null,
  p_tracking_number  text        default null,
  p_band_key         text        default null,
  p_intent           text        default null,
  p_summary          text        default null,
  p_transcript       text        default null,
  p_recording_url    text        default null,
  p_outcome          text        default 'AI完結',
  p_receipt_no       text        default null,
  p_priority         int         default 0,
  p_channel          text        default 'ai_phone',
  p_started_at       timestamptz default null,
  p_ended_at         timestamptz default null,
  p_duration_sec     int         default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id              bigint;
  v_callback_status text;
  v_ex_id           bigint;
  v_ex_callback     text;
begin
  -- outcome='折り返し要' のときだけ callback_status='待ち' を自動セット。
  v_callback_status := case when p_outcome = '折り返し要' then '待ち' else '不要' end;

  insert into public.call_logs (
    call_sid, channel, started_at, ended_at, duration_sec,
    caller_phone, tracking_number, band_key, intent, summary,
    transcript, recording_url, outcome, receipt_no, priority,
    callback_status, created_by
  ) values (
    p_call_sid, coalesce(p_channel, 'ai_phone'), p_started_at, p_ended_at, p_duration_sec,
    p_caller_phone, p_tracking_number, p_band_key, p_intent, p_summary,
    p_transcript, p_recording_url, coalesce(p_outcome, 'AI完結'), p_receipt_no, coalesce(p_priority, 0),
    v_callback_status, auth.uid()
  )
  on conflict (call_sid) do nothing
  returning id into v_id;

  if v_id is not null then
    return jsonb_build_object(
      'result', 'recorded',
      'call_id', v_id,
      'call_sid', p_call_sid,
      'callback_status', v_callback_status
    );
  end if;

  -- 冪等：既に同じ call_sid が記録済み → 挿入せず既存を返す。
  select id, callback_status into v_ex_id, v_ex_callback
  from public.call_logs where call_sid = p_call_sid;

  return jsonb_build_object(
    'result', 'duplicate',
    'call_id', v_ex_id,
    'call_sid', p_call_sid,
    'callback_status', v_ex_callback
  );
end $$;

revoke execute on function public.record_call_log(
  text, text, text, text, text, text, text, text, text, text, int, text, timestamptz, timestamptz, int
) from public;
grant execute on function public.record_call_log(
  text, text, text, text, text, text, text, text, text, text, int, text, timestamptz, timestamptz, int
) to authenticated, anon;

comment on function public.record_call_log(
  text, text, text, text, text, text, text, text, text, text, int, text, timestamptz, timestamptz, int
) is
  '通話・対応ログの記録口（§9.2）。call_sidで冪等・outcome=折り返し要でcallback_status=待ちを自動セット。SECURITY DEFINER・authenticated/anon実行可';


-- =============================================================
-- 記録口② resolve_callback（SECURITY DEFINER・authenticatedのみ・CS認可）
--   折り返し完了・不要の解決。お客様側（driver/shipper/anon）は触れない。
-- =============================================================
create or replace function public.resolve_callback(
  p_call_id bigint,
  p_note    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_role   text := public.my_role();
  v_status text;
  v_by     uuid;
begin
  -- authz①：未認証（anon）は拒否。
  if v_uid is null then
    raise exception '認証されていません（resolve_callback）' using errcode = '42501';
  end if;

  -- authz②：CS（hq/depot/area）のみ。driver/shipper・無権限は拒否。
  if v_role is null or v_role not in ('hq','depot','area') then
    raise exception '折り返し対応の権限がありません（role=%）', coalesce(v_role,'(null)')
      using errcode = '42501';
  end if;

  select callback_status, callback_by into v_status, v_by
  from public.call_logs
  where id = p_call_id;

  if not found then
    raise exception '対象の通話ログが見つかりません（call_id=%）', p_call_id
      using errcode = 'P0002';
  end if;

  -- 二重解決を避け、既に完了なら冪等に既存を返す。
  if v_status = '完了' then
    return jsonb_build_object(
      'result', 'already',
      'call_id', p_call_id,
      'callback_by', v_by
    );
  end if;

  update public.call_logs
     set callback_status = '完了',
         callback_by     = v_uid,
         callback_at     = now(),
         callback_note   = p_note
   where id = p_call_id;

  return jsonb_build_object(
    'result', 'resolved',
    'call_id', p_call_id,
    'callback_by', v_uid
  );
end $$;

revoke execute on function public.resolve_callback(bigint, text) from public;
grant execute on function public.resolve_callback(bigint, text) to authenticated;
-- ★anonには実行権を与えない（REVOKE段階で拒否＋関数内authzの二重防御）。

comment on function public.resolve_callback(bigint, text) is
  '折り返し解決の記録口（§9.2）。CS(hq/depot/area)のみ実行可・二重解決は冪等（already）。SECURITY DEFINER';


-- =============================================================
-- ビュー callback_queue（security_invoker=on）— 折り返し待ちを優先度→古い順で並べる
--   配達センターが上から掛け直すための画面の元（v0の閲覧はSupabase Table Editor／簡易表示）。
--   列（正本§やること）：受信時刻・発信者番号・番号帯・用件・要約・優先度。
-- =============================================================
create or replace view public.callback_queue
with (security_invoker=on) as
select id, call_sid, created_at, caller_phone, tracking_number, band_key, intent, summary, priority
from public.call_logs
where callback_status = '待ち'
order by priority desc, created_at asc;

grant select on public.callback_queue to authenticated;
-- security_invoker=on ＝ 呼び出し元の call_logs RLS がそのまま効く（hq/depot/areaのみ見える）。

comment on view public.callback_queue is
  '折り返しリスト（callback_status=待ちを優先度→古い順）。security_invoker=on で call_logs のRLSを継承';
