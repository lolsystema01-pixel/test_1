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

  -- 入力検証（画面と二重。NULL/空文字は「未完」のままにしないため必須）
  if p_gdrive_folder_url is null or btrim(p_gdrive_folder_url) = '' then
    raise exception '持出バッグリストのフォルダURLは必須です（空にはできません）'
      using errcode = '22023';
  end if;
  if p_printer_model is null or btrim(p_printer_model) = '' then
    raise exception 'ラベルプリンタ機種は必須です' using errcode = '22023';
  end if;
  if p_printer_model not in ('Brother TD-2350', '汎用サーマル') then
    raise exception '印刷機種が不正です: %', p_printer_model using errcode = '22023';
  end if;

  update public.offices set
    gdrive_folder_url = btrim(p_gdrive_folder_url),
    printer_model     = p_printer_model
  where office_code = p_office_code;
end $$;

comment on function public.save_office_init_setup(text, text, text) is
  '初期設定（§12.14）の保存。hq＝常時／area＝自営業所かつ初回(gdrive_folder_url IS NULL)のみ。offices に write policy を作らない規約に従い SECURITY DEFINER';

revoke execute on function public.save_office_init_setup(text, text, text) from public;
grant  execute on function public.save_office_init_setup(text, text, text) to authenticated;


-- =============================================================
-- §3. 確認（postgres 実行＝RLSバイパス。権限の実証は check_office_init_v0.sql で）
-- =============================================================
select office_code, office_name, gdrive_folder_url, printer_model,
       case when gdrive_folder_url is null then '未完' else '完了' end as setup_status
from public.offices
order by office_code;
-- 期待: gdrive_folder_url が NULL の営業所＝「未完」→ 初回ログインで初期設定画面が出る。
--       値が入っている営業所＝「完了」→ 自動表示されない（再編集は管理者設定§12.13）。
