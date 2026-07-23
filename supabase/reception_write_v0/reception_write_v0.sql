-- =============================================================
-- 受付テーブル＋書き込み口 v0.2 — ① 帯設定 ② 受付テーブル ③④ 記録口関数（register_reception / get_reception_public）
--   対応: 要件定義 D章相当（受付種別・希望日時・置き配場所の必須項目）／N-4(受付登録)・N-5(二重受付)・N-6(状態照会)
--   §4 番号帯ルーティング（帯の追加・照会解禁はこの表の行変更のみ）
-- 実行: Supabase SQL Editor。前提=schema_v0（deliveries）。
-- =============================================================
-- ・受付登録（N-4）を店頭のインメモリ実装からSupabaseへ移す第一歩。書込みは本ファイルの
--   SECURITY DEFINER関数に一本化（本基盤の規約：write policyを作らず記録口関数で代替）。
-- ・受付は「お客様チャネル（Web/LINE/SMS/電話/AI電話）」からの未認証アクセスを想定するため、
--   register_reception と get_reception_public のみ例外的に anon にも実行権を付与する
--   （ai_status_reply_v0/delivery_status_rpc_v0.sql の delivery_status_public と同じ考え方）。
-- =============================================================


-- =============================================================
-- §1. number_bands（問合番号の帯ルーティング設定。行変更だけで照会解禁・帯追加＝要件v0 §4）
-- =============================================================
create table if not exists public.number_bands (
  band_key            text primary key,                              -- 帯キー（英字コード）
  prefix              text not null,                                  -- 問合番号の接頭辞
  digits              integer,                                        -- 接頭辞より後ろの数字部の桁数。NULL=可変（桁数チェックなし）
  lookup_enabled      boolean not null default false,                 -- 状況照会の可否
  verify_on_reception boolean not null default true,                  -- 受付時に deliveries 実在チェックを課すか
  label               text not null,                                  -- 表示用ラベル
  enabled             boolean not null default true                   -- 帯そのものの有効/無効
);
comment on table public.number_bands is
  '問合番号の帯（番号帯ルーティング）。帯の追加・状況照会の解禁はこの表の行変更のみで完結させる（コード改修不要）';
comment on column public.number_bands.band_key            is '帯キー（英字コード。例: demo9000/req/dsp/kaz）';
comment on column public.number_bands.prefix               is '問合番号の接頭辞（最長一致で判定）';
comment on column public.number_bands.digits                is '接頭辞より後ろの数字部の桁数。NULL=桁数チェックなし（可変長を許容）';
comment on column public.number_bands.lookup_enabled       is '状況照会（非PIIサマリ等）の解禁フラグ';
comment on column public.number_bands.verify_on_reception  is '受付時に deliveries への実在チェックを課すか（falseなら未照合でも受付可）';

-- 初期データ（upsert・冪等）:
--   demo9000('9',11,照会可,照合あり) … 検証9000帯（12桁・9始まり）
--   req    ('REQ-',null,照会可,照合あり) … 伊丹デモ帯
--   dsp    ('DSP-',null,照会可,照合あり) … 配車量産デモ帯
--   kaz/a/four … 仮値（現場確認後にUPDATE。照会不可・照合なし）
insert into public.number_bands (band_key, prefix, digits, lookup_enabled, verify_on_reception, label) values
  ('demo9000', '9',    11,   true,  true,  '検証9000帯'),
  ('req',      'REQ-', null, true,  true,  'REQ帯(伊丹デモ)'),
  ('dsp',      'DSP-', null, true,  true,  'DSP帯(配車量産デモ)'),
  ('kaz',      'KAZ',  null, false, false, 'KAZ帯(仮値)'),
  ('a',        'A',    null, false, false, 'A帯(仮値)'),
  ('four',     '4',    null, false, false, '4帯(仮値)')
on conflict (band_key) do nothing;


-- =============================================================
-- §2. reception_requests（受付。上書きは旧行'取消'＋新行=履歴保全）
-- =============================================================
create table if not exists public.reception_requests (
  receipt_no      text primary key,                                          -- 受付番号（'R-YYMMDD-連番'）
  tracking_number text not null,                                             -- 問合番号
  band_key        text not null references public.number_bands(band_key),   -- 判定された帯
  verified        boolean not null,                                         -- deliveries実在チェックを通ったか
  reception_type  text not null check (reception_type in ('再配達','置き配','時間変更')), -- 受付種別
  desired_date    date,                                                     -- 希望日（再配達・時間変更で必須）
  time_slot       text,                                                     -- 時間帯（再配達・時間変更で必須）
  drop_place      text,                                                     -- 置き配場所（置き配で必須）
  channel         text not null check (channel in ('web','line','sms','phone','ai_phone')), -- 受付チャネル
  caller_phone    text,                                                     -- PII: 発信者番号（電話系チャネルのみ）
  status          text not null default '受付済' check (status in ('受付済','反映済','取消')), -- 受付の状態
  created_at      timestamptz not null default now(),
  created_by      uuid                                                      -- auth.uid()。anonチャネルはNULL
);
comment on table public.reception_requests is
  '受付（N-4登録・N-5二重受付・N-6状態照会）。書込みは register_reception 関数経由のみ（write policyは置かない）';
comment on column public.reception_requests.receipt_no      is '受付番号（問合番号ではない。表示用の "R-" 形式）';
comment on column public.reception_requests.tracking_number is '問合番号（12桁等・帯により書式が異なる）';
comment on column public.reception_requests.verified        is 'deliveries実在チェックを通ったか（照合なし帯は常にfalse）';
comment on column public.reception_requests.reception_type  is '受付種別（再配達／置き配／時間変更）';
comment on column public.reception_requests.caller_phone    is 'PII: 発信者番号。電話系チャネル(phone/ai_phone)以外は通常NULL。ログ・非PII照会には出さない';
comment on column public.reception_requests.status          is '受付済=有効中／反映済=配車等へ反映済み／取消=上書きにより無効化（履歴保全のため物理削除しない）';

-- 活性受付（受付済）は同一問合番号につき1件＝DB層で不変条件を保証（同時実行の二重登録防止）
create unique index if not exists reception_requests_active_tn_uidx
  on public.reception_requests (tracking_number) where status = '受付済';

-- v0.2追記: memo（自由記入）。現行フォームのmemoを受付テーブルに保存する（LOL指摘）。
--   自由記入＝PII混入がありうる前提で扱う（get_reception_public では返さない）。
alter table public.reception_requests add column if not exists memo text;
comment on column public.reception_requests.memo is
  '自由記入メモ（現行フォームのmemo・500字上限）。PII混入がありうるため非PII照会(get_reception_public)には出さない';

create sequence if not exists public.reception_receipt_seq;


-- =============================================================
-- §2b. 入力上限のバックストップ（CHECK制約・冪等に追加）
--   register_reception 内のI2バリデーションと同じ上限をテーブル側にも課す（anon実行の書き込み口の
--   ため、関数を経由しない直接INSERTが万一あっても崩れないようにする二段構え）。
--   desired_dateの窓（JST±）は運用で調整したい業務ルールのため、あえてCHECKにはしない（関数側のみ）。
-- =============================================================
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'reception_requests_tn_len_chk') then
    alter table public.reception_requests add constraint reception_requests_tn_len_chk
      check (char_length(tracking_number) <= 32);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'reception_requests_ts_len_chk') then
    alter table public.reception_requests add constraint reception_requests_ts_len_chk
      check (time_slot is null or char_length(time_slot) <= 32);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'reception_requests_dp_len_chk') then
    alter table public.reception_requests add constraint reception_requests_dp_len_chk
      check (drop_place is null or char_length(drop_place) <= 100);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'reception_requests_cp_len_chk') then
    alter table public.reception_requests add constraint reception_requests_cp_len_chk
      check (caller_phone is null or char_length(caller_phone) <= 32);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'reception_requests_memo_len_chk') then
    alter table public.reception_requests add constraint reception_requests_memo_len_chk
      check (memo is null or char_length(memo) <= 500);
  end if;
end $$;


-- =============================================================
-- §3. register_reception（SECURITY DEFINER・帯判定→検証→二重制御→採番）
--   受付番号: 'R-' || YYMMDD(JST) || '-' || 4桁連番（既存 'R-' 形式踏襲・乱数排除で決定化）
--   D章相当: 再配達/時間変更→desired_date・time_slot必須。置き配→drop_place必須。
--   冪等: 活性受付(status='受付済')と全項目（種別・希望日・時間帯・置き配場所）一致→'unchanged'（行を増やさない）
--   実行権限: authenticated＋anon（お客様チャネルは未ログインのため）。search_path=public固定。
-- =============================================================
-- v0.2改訂: p_memo追加＝引数構成が変わるため旧シグネチャを明示drop（default解決の衝突事故防止・冪等）
drop function if exists public.register_reception(text, text, date, text, text, text, text, boolean);

create or replace function public.register_reception(
  p_tracking_number text,
  p_type            text,
  p_desired_date    date,
  p_time_slot       text,
  p_drop_place      text,
  p_channel         text,
  p_caller_phone    text default null,
  p_overwrite       boolean default false,
  p_memo            text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_band       public.number_bands%rowtype;
  v_existing   public.reception_requests%rowtype;
  v_verified   boolean;
  v_same       boolean;
  v_receipt_no text;
  v_seq        bigint;
begin
  -- ── D章相当のバリデーション（帯判定より先に行い、番号の形式に関わらず一貫して弾く）──
  if p_type not in ('再配達','置き配','時間変更') then
    raise exception '受付種別が不正です: %', coalesce(p_type, '(未指定)') using errcode = '22023';
  end if;
  if p_channel not in ('web','line','sms','phone','ai_phone') then
    raise exception '受付チャネルが不正です: %', coalesce(p_channel, '(未指定)') using errcode = '22023';
  end if;
  if p_type in ('再配達','時間変更') and (p_desired_date is null or p_time_slot is null) then
    raise exception '%には受け取り希望日と時間帯の指定が必須です', p_type using errcode = '23514';
  end if;
  if p_type = '置き配' and (p_drop_place is null or btrim(p_drop_place) = '') then
    raise exception '置き配には置き配場所の指定が必須です' using errcode = '23514';
  end if;

  -- ── I2: 入力上限チェック（anon実行の書き込み口のため、書込み前にDB側で一律に弾く）──
  --   既存のformat_errorと同じjsonb形状で返す。desired_dateの窓はJST基準（既存のJST運用に合わせる）。
  if char_length(p_tracking_number) > 32
     or char_length(coalesce(p_time_slot, '')) > 32
     or char_length(coalesce(p_drop_place, '')) > 100
     or char_length(coalesce(p_caller_phone, '')) > 32
     or char_length(coalesce(p_memo, '')) > 500
     or (
       p_desired_date is not null
       and (
         p_desired_date < (now() at time zone 'Asia/Tokyo')::date - 1
         or p_desired_date > (now() at time zone 'Asia/Tokyo')::date + 90
       )
     )
  then
    return jsonb_build_object(
      'result', 'format_error', 'receipt_no', null, 'band_key', null,
      'verified', null, 'existing_receipt_no', null, 'existing_type', null
    );
  end if;

  -- ── 帯判定（最長prefix優先）──
  select * into v_band from public.number_bands
  where enabled and p_tracking_number like prefix || '%'
    and (digits is null or substring(p_tracking_number from char_length(prefix) + 1) ~ ('^[0-9]{' || digits || '}$'))
  order by char_length(prefix) desc, band_key
  limit 1;

  if not found then
    return jsonb_build_object(
      'result', 'format_error', 'receipt_no', null, 'band_key', null,
      'verified', null, 'existing_receipt_no', null, 'existing_type', null
    );
  end if;

  -- ── 照合あり帯のみ deliveries 実在チェック。無ければ not_found ──
  if v_band.verify_on_reception then
    if not exists (select 1 from public.deliveries d where d.tracking_number = p_tracking_number) then
      return jsonb_build_object(
        'result', 'not_found', 'receipt_no', null, 'band_key', v_band.band_key,
        'verified', null, 'existing_receipt_no', null, 'existing_type', null
      );
    end if;
  end if;
  v_verified := v_band.verify_on_reception;

  -- ── 活性受付（status='受付済'）の有無で分岐 ──
  select * into v_existing from public.reception_requests
  where tracking_number = p_tracking_number and status = '受付済'
  order by created_at desc
  limit 1;

  if found then
    if not p_overwrite then
      -- N-5: 二重受付（上書き許可なし）
      return jsonb_build_object(
        'result', 'duplicate', 'receipt_no', null, 'band_key', v_band.band_key,
        'verified', null, 'existing_receipt_no', v_existing.receipt_no, 'existing_type', v_existing.reception_type
      );
    end if;

    v_same := (v_existing.reception_type is not distinct from p_type)
      and (v_existing.desired_date is not distinct from p_desired_date)
      and (v_existing.time_slot is not distinct from p_time_slot)
      and (v_existing.drop_place is not distinct from p_drop_place)
      and (v_existing.memo is not distinct from p_memo);

    if v_same then
      -- 冪等: 内容が全項目一致 → 行を増やさない
      return jsonb_build_object(
        'result', 'unchanged', 'receipt_no', v_existing.receipt_no, 'band_key', v_band.band_key,
        'verified', v_existing.verified, 'existing_receipt_no', null, 'existing_type', null
      );
    end if;

    -- 上書き: 旧行を'取消'にして新行を追加（履歴保全）
    update public.reception_requests set status = '取消' where receipt_no = v_existing.receipt_no;

    -- C1: lpad(...,4,'0') はPostgresでは4桁を超えると「切り詰め」になる（lpad('10000',4,'0')='1000'）ため、
    --   採番が9999を超えるとreceipt_noが衝突しPK違反になっていた。桁が4を超えたらそのまま出す形に修正。
    v_seq := nextval('public.reception_receipt_seq');
    v_receipt_no := 'R-' || to_char(now() at time zone 'Asia/Tokyo', 'YYMMDD') || '-'
      || lpad(v_seq::text, greatest(4, char_length(v_seq::text)), '0');

    begin
      insert into public.reception_requests
        (receipt_no, tracking_number, band_key, verified, reception_type, desired_date, time_slot, drop_place, channel, caller_phone, memo, status, created_by)
      values
        (v_receipt_no, p_tracking_number, v_band.band_key, v_verified, p_type, p_desired_date, p_time_slot, p_drop_place, p_channel, p_caller_phone, p_memo, '受付済', auth.uid());
    exception
      when unique_violation then
        -- M1: 同時実行で他トランザクションが先に活性受付(reception_requests_active_tn_uidx)を
        --   作っていた場合、エラーにせずduplicateとして返す（同時実行はpgliteで再現不可・
        --   部分UNIQUEインデックスが最終防衛）。
        select * into v_existing from public.reception_requests
        where tracking_number = p_tracking_number and status = '受付済'
        order by created_at desc
        limit 1;
        return jsonb_build_object(
          'result', 'duplicate', 'receipt_no', null, 'band_key', v_band.band_key,
          'verified', null, 'existing_receipt_no', v_existing.receipt_no, 'existing_type', v_existing.reception_type
        );
    end;

    return jsonb_build_object(
      'result', 'overwritten', 'receipt_no', v_receipt_no, 'band_key', v_band.band_key,
      'verified', v_verified, 'existing_receipt_no', v_existing.receipt_no, 'existing_type', v_existing.reception_type
    );
  end if;

  -- 活性受付なし → 新規登録（C1修正は上と同じ式を使用）
  v_seq := nextval('public.reception_receipt_seq');
  v_receipt_no := 'R-' || to_char(now() at time zone 'Asia/Tokyo', 'YYMMDD') || '-'
    || lpad(v_seq::text, greatest(4, char_length(v_seq::text)), '0');

  begin
    insert into public.reception_requests
      (receipt_no, tracking_number, band_key, verified, reception_type, desired_date, time_slot, drop_place, channel, caller_phone, memo, status, created_by)
    values
      (v_receipt_no, p_tracking_number, v_band.band_key, v_verified, p_type, p_desired_date, p_time_slot, p_drop_place, p_channel, p_caller_phone, p_memo, '受付済', auth.uid());
  exception
    when unique_violation then
      -- M1: 上と同じ理由（新規登録側でも同時実行の競合をduplicateとして返す）。
      select * into v_existing from public.reception_requests
      where tracking_number = p_tracking_number and status = '受付済'
      order by created_at desc
      limit 1;
      return jsonb_build_object(
        'result', 'duplicate', 'receipt_no', null, 'band_key', v_band.band_key,
        'verified', null, 'existing_receipt_no', v_existing.receipt_no, 'existing_type', v_existing.reception_type
      );
  end;

  return jsonb_build_object(
    'result', 'created', 'receipt_no', v_receipt_no, 'band_key', v_band.band_key,
    'verified', v_verified, 'existing_receipt_no', null, 'existing_type', null
  );
end $$;

comment on function public.register_reception(text, text, date, text, text, text, text, boolean, text) is
  '受付登録の記録口（N-4/N-5）。帯判定→(照合あり帯のみ)deliveries実在チェック→二重/冪等/上書き制御→採番。SECURITY DEFINER。anon実行可（お客様チャネル向け）';

revoke execute on function public.register_reception(text, text, date, text, text, text, text, boolean, text) from public;
grant  execute on function public.register_reception(text, text, date, text, text, text, text, boolean, text) to authenticated, anon;


-- =============================================================
-- §4. get_reception_public（SECURITY DEFINER・非PIIサマリ。caller_phone/created_byは返さない）
--   活性受付(status='受付済')の要約のみ返す（N-6 状態照会）。該当なしは NULL。
-- =============================================================
create or replace function public.get_reception_public(p_tracking_number text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'receipt_no',   r.receipt_no,
    'type',         r.reception_type,
    'desired_date', r.desired_date,
    'time_slot',    r.time_slot,
    'drop_place',   r.drop_place,
    'status',       r.status
  )
  from public.reception_requests r
  where r.tracking_number = p_tracking_number
    and r.status = '受付済'
  order by r.created_at desc
  limit 1
$$;
--   ↑ caller_phone（PII）・created_by・memo（自由記入＝PII混入がありうる）は意図的に SELECT しない（非PIIサマリの源流強制）。

comment on function public.get_reception_public(text) is
  '活性受付の非PIIサマリ（N-6）。receipt_no/type/desired_date/time_slot/drop_place/status のみ。caller_phone・created_byは返さない';

revoke execute on function public.get_reception_public(text) from public;
grant  execute on function public.get_reception_public(text) to authenticated, anon;


-- =============================================================
-- §5. GRANT → RLS（テーブルへの直接SELECTはanonに与えない。書込みは関数経由のみ＝write policyなし）
-- =============================================================

-- number_bands: 非PII・非機微の帯ルーティング設定。authenticatedなら誰でも参照可（設計判断）。
--   ※anonには付与しない（テーブル直接参照はさせず、関数経由の判定結果のみ返す）。
alter table public.number_bands enable row level security;
grant select on public.number_bands to authenticated;
drop policy if exists number_bands_authenticated on public.number_bands;
create policy number_bands_authenticated on public.number_bands for select to authenticated
  using ( true );
comment on policy number_bands_authenticated on public.number_bands is
  '帯設定は非PII・非機微のため authenticated 全員に参照を許可（編集は今後の管理口で hq 限定にする想定）';

-- reception_requests: 「その荷物(deliveries)が見えるなら受付も見える」＝deliveries RLSを継承（status_log_inheritと同型）。
--   未照合行(verified=false)はdeliveriesに親が無い＝hqのみ可視（設計判断。README等に明記）。
--   write policyは置かない（register_reception 関数経由のみ）。
alter table public.reception_requests enable row level security;
grant select on public.reception_requests to authenticated;
drop policy if exists reception_requests_select on public.reception_requests;
create policy reception_requests_select on public.reception_requests for select to authenticated
  using (
    public.my_role() = 'hq'
    or exists (
      select 1 from public.deliveries d
      where d.tracking_number = public.reception_requests.tracking_number
    )
  );
