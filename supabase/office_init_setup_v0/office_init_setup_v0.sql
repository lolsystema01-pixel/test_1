-- =============================================================
-- 指示書: 初期設定（営業所新規追加時の初回画面）v0.2 — §12.14
--   営業所を新規追加したとき、初回ログインでのみ自動表示する2項目入力の「器」と「保存口」。
--     ① 持出バッグリスト フォルダURL … offices.gdrive_folder_url（本ファイルで新規追加）
--     ② ラベルプリンタ機種           … offices.printer_model（管理者設定で追加済み・触らない）
-- 実行: Supabase SQL Editor（postgres）で丸ごと Run。冪等。
-- =============================================================
-- 【固定の前提】新基盤(Supabase+SvelteKit+Cloud Run)・検証環境のみ・本番/現行GASは触らない・
--   全テーブルRLS（書込はDEFINER関数のみ）・秘密情報は環境変数・SQLは人手コピペ（渡す前に pglite 検証）。
--
-- 【設計（指示書 v0.2 の訂正どおり）】
--  ・設定の実体は **offices**（office_settings テーブルは作らない）。管理者設定 v0.1 と同じ器。
--  ・**完了フラグ（setup_completed 相当）は作らない**。`gdrive_folder_url IS NULL` を
--    「初期設定 未完」とみなし、初回ゲートの判定に流用する（1列で状態を表す）。
--    ※ printer_model は既定値やCHECKで入り得るため、未完判定には使わない。
--  ・空文字ではなく **NULL** を「未完」とする。保存時は必ず非NULLを入れる（下記§2で検証）。
--  ・書込みは write policy を作らず **SECURITY DEFINER 関数**（本基盤の規約）。
--
-- 【権限の設計（★指示書が「要確認」としている論点）】
--   指示書は「権限＝管理者（§13.1）」としつつ、「初回ログイン時に自動表示なので
--   初回ログインユーザー（営業所長/オペレータ）との整合は要確認」と保留している。
--   本実装は次の折衷を採る（理由も併記）:
--     ・hq  … いつでも保存できる（全営業所）。
--     ・area … **自営業所のみ**、かつ **gdrive_folder_url が NULL のとき（＝初回設定）だけ** 保存できる。
--   理由: 初回ゲートを見るのは実際には area ユーザー（sort_nav は area 用アプリ／hq は /admin/settings へ振られる）。
--         hq 限定にすると「画面は出るが保存できない」デッドロックになり機能が成立しない。
--         一方で area に恒久的な編集権を与えないため、2回目以降の変更は hq（管理者設定§12.13）に限定する。
--   → 業務Aの確認事項。「初期設定も hq 限定」で運用するなら §2 の area 分岐を落とせば hq 限定になる。
-- =============================================================


-- =============================================================
-- §1. gdrive_folder_url を追加（NULL 許容＝初期設定 未完）
--   printer_model は管理者設定 v0.1 で追加済み＝ここでは触らない。
-- =============================================================
alter table public.offices add column if not exists gdrive_folder_url text;

comment on column public.offices.gdrive_folder_url is
  '持出バッグリストのGドライブ保存先フォルダURL（§12.14・営業所別）。NULL＝初期設定 未完（初回ゲートの判定に流用・専用フラグ列は作らない）。消費側＝出力の保存先 v0.3（§12.10.5）';


-- =============================================================
-- §0. gdrive_folder_url の受理判定（単一の正）
--   CHECK 制約・保存口2本が同一条件を参照するためのヘルパー（4箇所コピーを避ける）。
--   「保存してよい非NULL値」＝ trim済み・500文字以内・改行なし・URL安全文字のみの Drive フォルダURL。
--   ⚠ 正規表現の落とし穴（実測で確認）:
--     ・\Z は Postgres 非対応（リテラルZ扱い）→ 使わない。
--     ・[^\s] はブラケット内でバックスラッシュがリテラル化し「s以外」の意になり "folders" の s で
--       正常URLを誤弾き → 使わない。
--   → 文字クラス allowlist（<> 空白 その他記号を弾く）＋ 既定の $（文字列末尾）＋ strpos の改行チェック。
--   immutable（純関数）なので CHECK 制約から参照できる。
-- =============================================================
create or replace function public.is_valid_gdrive_url(u text)
returns boolean
language sql
immutable
as $$
  select u is not null
     and u = btrim(u)
     and length(u) <= 500
     and strpos(u, chr(10)) = 0
     and u ~ '^https://drive\.google\.com/[A-Za-z0-9/_?=&%.-]+$'
$$;
comment on function public.is_valid_gdrive_url(text) is
  '持出バッグリストGドライブURLの受理判定（§12.14）。trim済み・500字以内・改行なし・URL安全文字のみの drive.google.com フォルダURL。CHECK制約と保存口が共有する単一の正';

-- gdrive_folder_url に入れてよい値を CHECK で厳密に縛る（冪等）。
--   目的1: 未完の表現を **NULL のみ** に限定（空文字を作れないように）。
--     空文字を許すと、ゲートは `is null` 判定なので「完了」とみなして初期設定画面を出さない一方、
--     保存口の area 分岐は `v_current is null` のみ許可なので area は直せない
--     ＝「画面は出ないのに設定もできない」宙づり状態が postgres 直UPDATEで作れてしまう。
--   目的2: Drive フォルダURL以外・改行混入・不正文字・過大長を弾く（v0.3 の Gドライブ保存や帳票に
--     この値が埋め込まれる段での改行注入・不正コンテンツの芽を根本から断つ）。判定は §0 の
--     is_valid_gdrive_url に一本化（CHECK・保存口2本が同じ関数を参照＝条件のドリフトを防ぐ）。
--   ※ 保存口は btrim 済みの値を書き込むが、postgres 直UPDATE の未trim値も弾けるよう
--     is_valid_gdrive_url 内で `u = btrim(u)` を課している。
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'offices_gdrive_folder_url_chk') then
    -- 旧定義（空文字のみ禁止・インライン旧パターン）が残っていれば張り替える
    alter table public.offices drop constraint offices_gdrive_folder_url_chk;
  end if;
  alter table public.offices add constraint offices_gdrive_folder_url_chk
    check ( gdrive_folder_url is null or public.is_valid_gdrive_url(gdrive_folder_url) );
end $$;


-- =============================================================
-- §2. 保存口（SECURITY DEFINER・初回設定の2項目）
--   ・2項目を同時に保存する（初期設定画面は2項目セット）。
--   ・gdrive_folder_url は **必須・非NULL・空文字不可**（入れた時点で「完了」になるため）。
--   ・printer_model は CHECK 制約の許容値のみ（画面はそこから選ばせる）。
--   ・offices に write policy は作らない（規約）。
-- =============================================================
create or replace function public.save_office_init_setup(
  p_office_code       text,
  p_gdrive_folder_url text,
  p_printer_model     text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role    text := public.my_role();
  v_office  text := public.my_office();
  v_current text;
  v_updated integer;
begin
  -- 対象営業所の存在確認＋現在値の取得
  select o.gdrive_folder_url into v_current
  from public.offices o where o.office_code = p_office_code;
  if not found then
    raise exception '営業所が存在しません: %', p_office_code using errcode = 'P0002';
  end if;

  -- 権限（上記ヘッダの設計）:
  --   hq   … 常に可
  --   area … 自営業所 かつ 初回（gdrive_folder_url が NULL）のときのみ可
  if v_role = 'hq' then
    null;                                   -- 許可
  elsif v_role = 'area'
        and v_office is not distinct from p_office_code
        and v_current is null then
    null;                                   -- 許可（初回設定のみ）
  else
    raise exception
      '初期設定を保存する権限がありません (role=%, office=%, 対象=%)。'
      '2回目以降の変更は管理者設定（§12.13）から hq が行ってください。',
      coalesce(v_role, '(未設定)'), coalesce(v_office, '(未設定)'), p_office_code
      using errcode = '42501';
  end if;

  -- 入力検証（画面と二重＝多層防御。RPC を直接叩かれても同じ判定が効くよう、
  --   画面側と**同じ条件**にしてある。片方だけ緩いと検証が形骸化するため）
  if p_gdrive_folder_url is null or btrim(p_gdrive_folder_url) = '' then
    raise exception '持出バッグリストのフォルダURLは必須です（空にはできません）'
      using errcode = '22023';
  end if;
  -- URL の受理判定は CHECK と共有の is_valid_gdrive_url に一本化（片方だけ緩いと形骸化するため）。
  if not public.is_valid_gdrive_url(btrim(p_gdrive_folder_url)) then
    raise exception
      'GドライブのフォルダURLを指定してください（https://drive.google.com/… で始まり、改行や空白・記号を含まない500文字以内）: %',
      p_gdrive_folder_url using errcode = '22023';
  end if;
  if p_printer_model is null or btrim(p_printer_model) = '' then
    raise exception 'ラベルプリンタ機種は必須です' using errcode = '22023';
  end if;
  if p_printer_model not in ('Brother TD-2350', '汎用サーマル') then
    raise exception '印刷機種が不正です: %', p_printer_model using errcode = '22023';
  end if;

  -- ★TOCTOU対策: 「hq＝常時／area＝初回(NULL)のみ」という不変条件を **書込みの WHERE** に落とし込む。
  --   上の事前チェック（v_current is null）は逐次呼び出しに明確なエラーを返すためのもの。
  --   だが read→write の隙間に別リクエストが初回設定を確定させる並行ケースは事前チェックでは防げない。
  --   READ COMMITTED では、同一行への2本目のUPDATEは1本目のcommitまで待機し、最新値で WHERE を
  --   再評価する。よって `gdrive_folder_url is null` を WHERE に置けば、先発が非NULLにした後の
  --   後発は 0 件更新になる＝「初回のみ」の不変条件が並行時にも保たれる。
  update public.offices set
    gdrive_folder_url = btrim(p_gdrive_folder_url),
    printer_model     = p_printer_model
  where office_code = p_office_code
    and (v_role = 'hq' or gdrive_folder_url is null);
  get diagnostics v_updated = row_count;

  if v_updated = 0 then
    -- 事前チェックは通ったのに 0 件＝並行リクエストが先に初回設定を確定させた（または直前に営業所が消えた）。
    raise exception
      '初期設定は既に完了しています（並行更新で他のリクエストが先に確定）。再編集は管理者設定（§12.13）から行ってください。'
      using errcode = '42501';
  end if;
end $$;

comment on function public.save_office_init_setup(text, text, text) is
  '初期設定（§12.14）の保存。hq＝常時／area＝自営業所かつ初回(gdrive_folder_url IS NULL)のみ。offices に write policy を作らない規約に従い SECURITY DEFINER';

revoke execute on function public.save_office_init_setup(text, text, text) from public;
grant  execute on function public.save_office_init_setup(text, text, text) to authenticated;


-- =============================================================
-- §2-2. 管理者による再編集口（hq 専用・§12.13 から呼ぶ）
--   ・初期設定（§12.14）は area が初回のみ入力するが、その後の変更は hq が管理者設定から行う。
--     save_office_init_setup は「初回設定」の口で printer_model を必須とし NULL クリアを許さないため、
--     gdrive_folder_url だけを付け替え／クリアする hq 専用の口を分ける。
--   ・NULL を許可＝「初期設定 未完に戻す」（誤登録・営業所閉鎖時など）ができる。
--   ・非NULL は is_valid_gdrive_url でCHECKと同一検証。offices に write policy は作らない（規約）。
-- =============================================================
create or replace function public.set_office_gdrive_url(
  p_office_code       text,
  p_gdrive_folder_url text        -- NULL 可（＝未完に戻す）
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_norm    text := nullif(btrim(p_gdrive_folder_url), '');  -- 空文字は NULL 扱い（未完）に正規化
  v_updated integer;
begin
  if public.my_role() is distinct from 'hq' then
    raise exception 'Gドライブ保存先を変更できるのは管理者(hq)のみです (role=%)',
      coalesce(public.my_role(), '(未設定)') using errcode = '42501';
  end if;

  -- 非NULL なら CHECK と同一の受理判定（友好的なエラーのため関数側でも検証）
  if v_norm is not null and not public.is_valid_gdrive_url(v_norm) then
    raise exception
      'GドライブのフォルダURLを指定してください（https://drive.google.com/… で始まり、改行や空白・記号を含まない500文字以内）: %',
      p_gdrive_folder_url using errcode = '22023';
  end if;

  update public.offices set gdrive_folder_url = v_norm
  where office_code = p_office_code;
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception '営業所が存在しません: %', p_office_code using errcode = 'P0002';
  end if;
end $$;

comment on function public.set_office_gdrive_url(text, text) is
  '管理者(hq)による持出バッグリストGドライブURLの再編集（§12.13）。NULLで未完に戻せる。非NULLは is_valid_gdrive_url で検証。SECURITY DEFINER';

revoke execute on function public.set_office_gdrive_url(text, text) from public;
grant  execute on function public.set_office_gdrive_url(text, text) to authenticated;


-- =============================================================
-- §3. 確認（postgres 実行＝RLSバイパス。権限の実証は check_office_init_v0.sql で）
-- =============================================================
select office_code, office_name, gdrive_folder_url, printer_model,
       case when gdrive_folder_url is null then '未完' else '完了' end as setup_status
from public.offices
order by office_code;
-- 期待: gdrive_folder_url が NULL の営業所＝「未完」→ 初回ログインで初期設定画面が出る。
--       値が入っている営業所＝「完了」→ 自動表示されない（再編集は管理者設定§12.13）。
