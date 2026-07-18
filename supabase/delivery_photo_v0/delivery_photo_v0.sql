-- =============================================================
-- 指示書(ドライバーMVP 第1.5弾): 置き配写真POD v0
--   — delivery_photos 表（複数枚正規化） ＋ Storage delivery-photos バケット
--     ＋ 記録口 attach_delivery_photo／clear_delivery_photos
--   対応: 要件定義 8.5（撮影ガイド文言）／設計書 §10.5（2026-07-17 管理側要望）
--     管理要望「置き配がどこに置かれたか見たい」。GPS精度5〜15mでは2件並びの識別は不可能＝
--     隣家識別の証拠は写真のみ、という結論に基づく。
--   【2026-07-18 LOL確定＋監査MED-3対応】写真は1配達につき最大3枚・6ヶ月保存・2回目訪問（日内再訪）は
--     入れ替え。photo_pathの単数列設計（v0初版）は複数枚を保持できないため、本ファイルで
--     delivery_photos（複数行）テーブルに置き換える。
-- 実行: Supabase SQL Editor（ブロック単位）。
-- 前提: dbschema_v0・rls_v0（profiles/my_*ヘルパ）・status_log_v0・delivery_result_v0
--       （delivery_results 表・record_delivery_result・my_depot_drivers() が適用済みであること）。
-- =============================================================


-- =============================================================
-- ① 旧設計（photo_path単数列）の後始末 ＋ delivery_photos 表（複数枚・正規化）
--   【設計判断】1配達=1列（旧v0初版）ではなく「1配達=複数行（最大3）」のテーブルに正規化した。
--   理由: (a) 最大3枚という要件を自然に表現できる（列を3本並べるより拡張・集計が楽）、
--         (b) delivery_results 側のスキーマを触らずに済む＝写真モジュールの変更が
--             delivery_result_v0 に波及しない（モジュール境界を保つ）、
--         (c) delivery_results と同じ「書込みRLS無し・SECURITY DEFINER関数一本化」の
--             改ざん耐性パターンをそのまま複製できる。
--   photo_paths text[] 案も検討したが、行ロック粒度・1枚ずつの冪等判定（同一seqへの再送等）を
--   素直に書けるテーブル正規化を採用した。
-- =============================================================
alter table public.delivery_results drop column if exists photo_path;

-- 旧版（単数photo_path・2引数attach＝MED-3前の弱い前方一致版）の残骸を除去。
-- 旧版適用済み環境へ再適用したとき、旧2引数attachがdropされた列を参照して残るのを防ぐ。
drop function if exists public.attach_delivery_photo(text, text);

create table if not exists public.delivery_photos (
  id              bigint generated always as identity primary key,
  result_id       bigint not null references public.delivery_results(id) on delete cascade,
  tracking_number text not null references public.deliveries(tracking_number),
  driver_id       text not null,                -- 記録時の担当（my_driver()固定・delivery_resultsと同じ形）
  seq             smallint not null check (seq between 1 and 3),  -- 1配達につき最大3枚
  photo_path      text not null,                -- Storageパス（delivery-photosバケット内）
  recorded_at     timestamptz not null default now(),
  created_by      uuid                          -- auth.uid() 固定
);
comment on table public.delivery_photos is
  '置き配写真POD（複数枚・最大3枚/配達実績）。8.5／設計書§10.5（2026-07-17管理要望・2026-07-18 LOL確定）。'
  '書込みは attach_delivery_photo／clear_delivery_photos 経由のみ（このテーブルにUPDATE/DELETEのRLSポリシーは無い＝改ざん耐性）';
comment on column public.delivery_photos.photo_path is
  '機微: Storageパス（delivery-photosバケット内・{driver_id}/{tracking_number}/{seq}.jpg）';
comment on column public.delivery_photos.result_id is
  'どの配達実績（delivery_results.id）に紐づく写真か。日内再訪で新しい delivery_results 行ができても'
  '旧行の写真行は履歴として残る（clear_delivery_photosで明示的に消さない限り）';

create unique index if not exists uq_delivery_photos_result_seq
  on public.delivery_photos (result_id, seq);
create index if not exists idx_delivery_photos_tracking
  on public.delivery_photos (tracking_number);
create index if not exists idx_delivery_photos_driver
  on public.delivery_photos (driver_id);

-- RLS（SELECTのみ・delivery_results_select と同じ可視範囲をそのまま複製）
alter table public.delivery_photos enable row level security;
grant select on public.delivery_photos to authenticated;
drop policy if exists delivery_photos_table_select on public.delivery_photos;
create policy delivery_photos_table_select on public.delivery_photos
  for select to authenticated
  using (
    case public.my_role()
      when 'hq'     then true
      when 'depot'  then driver_id in (select public.my_depot_drivers())
      when 'area'   then driver_id = any (select public.my_office_drivers())
      when 'driver' then driver_id = public.my_driver()
      else false
    end
  );


-- =============================================================
-- ② Storage バケット delivery-photos（private）
--   quality 0.4 のJPEGを想定（アプリ側 launchCameraAsync）。上限15MB・画像のみ。
--   【6ヶ月保存（LOL確定）】本v0の範囲では自動ライフサイクル削除は実装しない（Supabase Storageの
--   バケットレベルのライフサイクルルールはダッシュボードGUI設定 or 別途スケジュールジョブが必要で、
--   SQL単体では完結しない）。【人】がSupabase Dashboard（Storage > delivery-photos > Policies/Lifecycle）
--   で6ヶ月の削除ルールを設定するか、定期実行のクリーンアップジョブを別途用意すること。
--   ＝ 運用注記（README「6ヶ月保存の運用」参照）。
-- =============================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('delivery-photos', 'delivery-photos', false, 15728640, array['image/jpeg','image/jpg','image/png'])
on conflict (id) do update set
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;


-- =============================================================
-- ③ Storage RLS（既存パターン踏襲: auth_rls_remaining_v1/storage_rls_all_buckets_v0.sql の
--    storage_office_allowed(object名の先頭フォルダ×my_*) を driver_id 版に置き換えたもの）
--   パス運用: <driver_id>/<tracking_number>/<seq>.jpg（seq=1〜3）→ 先頭フォルダ = driver_id。
--   ★2階層目にtracking_numberを挟むフォルダ構成に変更（v0初版は <driver_id>/<tracking_number>.jpg の
--     1階層だった）。storage.foldername(name) は「末尾ファイル名を除いた全階層」を返すため、
--     [1]（先頭フォルダ）は今回も driver_id のまま＝storage_own_driver_folder/storage_driver_visible の
--     判定ロジック自体は変更不要（[1]参照のみ・階層が増えても崩れない）。
-- =============================================================

-- ③-1 書込スコープ判定：driver本人の自フォルダ（{driver_id}/…）にのみ書ける
create or replace function public.storage_own_driver_folder(object_name text)
returns boolean
language sql
stable
as $$
  select public.my_role() = 'driver'
     and public.my_driver() is not null
     and (storage.foldername(object_name))[1] = public.my_driver()
$$;
comment on function public.storage_own_driver_folder(text) is
  '置き配写真Storageの書込スコープ：object名の先頭フォルダ(driver_id)が呼び出しドライバー本人か（driver以外は常にfalse）。'
  'パスは{driver_id}/{tracking_number}/{seq}.jpgの2階層だが判定は[1]（driver_id）のみなので階層追加後も不変';
grant execute on function public.storage_own_driver_folder(text) to authenticated;

-- ③-2 読取スコープ判定：delivery_results のSELECT RLSと同じ可視範囲を流用
--   （hq=全件／depot=配下営業所所属ドライバー分／area=自営業所所属ドライバー分／driver=自分のみ）
create or replace function public.storage_driver_visible(object_name text)
returns boolean
language sql
stable
as $$
  select case public.my_role()
    when 'hq'     then true
    when 'depot'  then (storage.foldername(object_name))[1] in (select public.my_depot_drivers())
    when 'area'   then (storage.foldername(object_name))[1] in (select public.my_office_drivers())
    when 'driver' then (storage.foldername(object_name))[1] = public.my_driver()
    else false
  end
$$;
comment on function public.storage_driver_visible(text) is
  '置き配写真Storageの読取スコープ：object名の先頭フォルダ(driver_id)が可視範囲内か。'
  'delivery_results_select ポリシー（my_depot_drivers()/my_office_drivers()）と同じ判定を流用（shipper/その他は常にfalse）';
grant execute on function public.storage_driver_visible(text) to authenticated;

-- ③-3 ポリシー（INSERT・SELECTのみ。UPDATE/DELETEは付与しない＝default-deny）
--   ★写真の後日差し替え（証跡の改ざん）を防ぐため、あえてUPDATEを許可しない設計判断。
--   アプリ側は upload(..., { upsert: false }) を使う。再送で「既に存在」エラーが返った場合は
--   （前回試行でアップロード自体は成功していたとみなし）そのまま次段の attach_delivery_photo へ進む。
--   ★DELETEも通常ポリシーとしては付与しない。日内再訪での入れ替え（旧オブジェクトの削除）は
--   下記 clear_delivery_photos（SECURITY DEFINER・本人限定）経由のみで許可する＝改ざん耐性を維持。
drop policy if exists delivery_photos_insert on storage.objects;
create policy delivery_photos_insert on storage.objects
  for insert to authenticated
  with check ( bucket_id = 'delivery-photos' and public.storage_own_driver_folder(name) );

drop policy if exists delivery_photos_select on storage.objects;
create policy delivery_photos_select on storage.objects
  for select to authenticated
  using ( bucket_id = 'delivery-photos' and public.storage_driver_visible(name) );


-- =============================================================
-- ④ 記録口 attach_delivery_photo
--   認可・作法は record_delivery_result（delivery_result_v0.sql）に合わせる。
--   【監査MED-3対応】旧版は「driver_id プレフィックス一致」しか見ておらず、同じdriverの
--   別tracking_numberフォルダの写真パスを紐付けられてしまう余地があった（誤紐付け／使い回し）。
--   本版は p_photo_path が {my_driver()}/{p_tracking_number}/{p_seq}.jpg に**完全一致**することを要求する。
-- =============================================================
create or replace function public.attach_delivery_photo(
  p_tracking_number text,
  p_seq             integer,
  p_photo_path      text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid           uuid := auth.uid();
  v_driver        text := public.my_driver();
  v_expected_path text;
  v_result_id     bigint;
  v_owner         text;
  v_existing_path text;
  v_count         integer;
begin
  -- 認可: driver本人のみ（record_delivery_result と同じ形）
  if v_uid is null or public.my_role() <> 'driver' or v_driver is null then
    raise exception '置き配写真を記録できるのは担当ドライバーのみです' using errcode = '42501';
  end if;

  -- 入力検証: 枚数(seq)は1〜3のみ
  if p_seq is null or p_seq < 1 or p_seq > 3 then
    raise exception '写真の枚数(seq)は1〜3のみです（%）', coalesce(p_seq::text,'(null)') using errcode = '23514';
  end if;

  -- 入力検証: 空・長さ超過（300文字）は拒否
  if p_photo_path is null or length(p_photo_path) = 0 or length(p_photo_path) > 300 then
    raise exception '写真パスが不正です（空または300文字超）' using errcode = '23514';
  end if;

  -- MED-3対策: パスは自分のフォルダ×対象tracking_number×seqに完全一致（他人詐称・別配達の使い回し・
  --   seq偽装のいずれも同時に封じる。left()による前方一致ではなく厳密一致にした）。
  v_expected_path := v_driver || '/' || p_tracking_number || '/' || p_seq || '.jpg';
  if p_photo_path <> v_expected_path then
    raise exception '写真パスは % である必要があります（実際: %）', v_expected_path, p_photo_path
      using errcode = '42501';
  end if;

  -- 対象: この問合番号の最新の delivery_results 行を行ロックして取得
  -- （tracking_number に一意制約は無い＝日内再訪で複数行あり得るため最新を対象にする。
  --   delivery_result_v0/README「delivery_results に一意制約はあえて付けない」を参照）
  select id, driver_id into v_result_id, v_owner
  from public.delivery_results
  where tracking_number = p_tracking_number
  order by id desc
  limit 1
  for update;

  if not found then
    raise exception '対象の配達実績が見つかりません（問合番号=%）', p_tracking_number using errcode = 'P0002';
  end if;
  if v_owner is distinct from v_driver then
    raise exception 'この配達実績の担当ではありません' using errcode = '42501';
  end if;

  -- 冪等 / 上書き判定: 同一result_id×seqの既存行を見る
  select photo_path into v_existing_path
  from public.delivery_photos
  where result_id = v_result_id and seq = p_seq;

  if found then
    if v_existing_path = p_photo_path then
      -- 冪等: 同一パスの再送（アップロード成功→attach失敗からの再試行等）は無害
      return jsonb_build_object('result','already','tracking_number',p_tracking_number,'seq',p_seq,'photo_path',v_existing_path);
    end if;
    -- 既に別の写真がこの枠にある＝上書きしない（明示エラー。23505等の制約違反コードは使わない）
    raise exception 'この枠（seq=%）には既に別の写真が記録されています（問合番号=%）', p_seq, p_tracking_number
      using errcode = 'P0001';
  end if;

  -- 上限3枚（seqの check制約とunique(result_id,seq)で既に事実上担保されるが、明示エラーで守る）
  select count(*) into v_count from public.delivery_photos where result_id = v_result_id;
  if v_count >= 3 then
    raise exception '1配達につき写真は最大3枚までです（問合番号=%）', p_tracking_number using errcode = 'P0001';
  end if;

  insert into public.delivery_photos (result_id, tracking_number, driver_id, seq, photo_path, created_by)
  values (v_result_id, p_tracking_number, v_driver, p_seq, p_photo_path, v_uid);

  return jsonb_build_object('result','recorded','tracking_number',p_tracking_number,'seq',p_seq,'photo_path',p_photo_path);
end $$;

revoke execute on function public.attach_delivery_photo(text, integer, text) from public;
grant  execute on function public.attach_delivery_photo(text, integer, text) to authenticated;
comment on function public.attach_delivery_photo(text, integer, text) is
  '置き配写真(POD)の記録口。driver本人限定・パスは{driver_id}/{tracking_number}/{seq}.jpgに厳密一致必須（MED-3対応）・'
  '対象delivery_results行の所有者一致必須・1配達最大3枚・冪等（同一パス再送は無害）・別写真への上書きは拒否。'
  'SECURITY DEFINER・search_path固定';


-- =============================================================
-- ⑤ 記録口 clear_delivery_photos（日内再訪＝2回目訪問の写真入れ替え専用）
--   【LOL確定2026-07-18】不在→再配達で完了/不在を記録し直すとき、前回の写真参照をクリアして
--   新規3枠にする。パス（{driver_id}/{tracking_number}/{seq}.jpg）はtracking_number単位で決定的
--   （result_id非依存）なため、旧オブジェクトを消さないまま同じパスへ再アップロードすると
--   upsert:falseで衝突する（＝アプリは「既に成功済み」と誤認して古い写真を残したままにしてしまう）。
--   これを避けるため、旧写真（Storageオブジェクト＋delivery_photos行）を先に消す専用口を用意する。
--
--   ★Storage DELETEは通常ポリシーとしては付与しない（改ざん耐性維持）。本関数（SECURITY DEFINER・
--   本人限定）経由でのみ、対象tracking_numberの自分の写真だけを消せる。
--
--   ★安全装置: 呼べるのは対象荷物が現在「不在」のときだけに限定した。完了済みの配達の証跡を
--   ドライバー自身が勝手に消せてしまう（改ざん）ことを防ぐため。日内再訪フロー以外では使えない。
--
--   ★既知の制約（SQLレベルの限界・README「6ヶ月保存の運用」節にも記載）: storage.objectsの行を
--   直接DELETEするのはメタデータ削除であり、Supabase Storageの実バックエンド（S3互換オブジェクト
--   ストレージ）上の実ファイルが同時に消える保証はSQL単体では担保できない（本来はStorage REST API
--   経由のDELETEが実体削除も伴う）。本v0はメタデータ削除により「同一パスへの再アップロードを
--   ブロックしない」効果（実用上のクリア）を狙う設計とし、実ファイルの完全消去保証が必要な場合は
--   次弾でEdge Function等からStorage REST APIを呼ぶ設計に切り替えることをREADMEに明記する。
-- =============================================================
create or replace function public.clear_delivery_photos(
  p_tracking_number text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_driver    text := public.my_driver();
  v_status    text;
  v_owner     text;
  v_prefix    text;
  v_objects   integer;
  v_rows      integer;
begin
  -- 認可: driver本人のみ
  if v_uid is null or public.my_role() <> 'driver' or v_driver is null then
    raise exception '置き配写真をクリアできるのは担当ドライバーのみです' using errcode = '42501';
  end if;

  -- 対象荷物を行ロックして確認（deliveries が正＝現在の担当・状態）
  select status, driver_id into v_status, v_owner
  from public.deliveries
  where tracking_number = p_tracking_number
  for update;

  if not found then
    raise exception '対象の荷物が見つかりません（問合番号=%）', p_tracking_number using errcode = 'P0002';
  end if;
  if v_owner is distinct from v_driver then
    raise exception 'この荷物の担当ではありません' using errcode = '42501';
  end if;

  -- 安全装置: 日内再訪（不在→再配達）フロー以外での証跡クリアを禁止
  if v_status <> '不在' then
    raise exception '写真のクリアは不在からの再配達時のみ可能です（現在のstatus=%）', coalesce(v_status,'(null)')
      using errcode = '42501';
  end if;

  v_prefix := v_driver || '/' || p_tracking_number || '/';

  -- Storageオブジェクト（メタデータ行）を削除。★実体削除の限界は本ファイル冒頭コメント参照。
  delete from storage.objects
  where bucket_id = 'delivery-photos'
    and name like v_prefix || '%';
  get diagnostics v_objects = row_count;

  -- delivery_photos の履歴行も削除（旧パスと整合しない行を残さない）
  delete from public.delivery_photos
  where tracking_number = p_tracking_number
    and driver_id = v_driver;
  get diagnostics v_rows = row_count;

  return jsonb_build_object('result','cleared','tracking_number',p_tracking_number,
    'objects_deleted', v_objects, 'rows_deleted', v_rows);
end $$;

revoke execute on function public.clear_delivery_photos(text) from public;
grant  execute on function public.clear_delivery_photos(text) to authenticated;
comment on function public.clear_delivery_photos(text) is
  '日内再訪（不在→再配達）時の写真入れ替え専用口。driver本人限定・対象荷物が現在「不在」の時のみ許可'
  '（完了済み配達の証跡改ざん防止）。Storageオブジェクト（メタデータ）とdelivery_photos行を削除し新規3枠にする。'
  'SECURITY DEFINER・search_path固定。実ファイル削除の保証範囲はREADME参照';


-- =============================================================
-- ⑥ 確認（postgres で実行＝RLSバイパス。範囲外拒否の完全な実証は実機で＝確認結果メモ.md参照）
-- =============================================================
-- 6-1) 旧列(photo_path)が無く、新テーブルがあるか
select count(*) as "旧photo_path列が残っていない(0期待)" from information_schema.columns
where table_schema='public' and table_name='delivery_results' and column_name='photo_path';

select column_name, data_type from information_schema.columns
where table_schema='public' and table_name='delivery_photos'
order by ordinal_position;
-- 期待: id/result_id/tracking_number/driver_id/seq/photo_path/recorded_at/created_by の8列

-- 6-2) delivery_photos のRLSポリシーが1件（SELECTのみ）か
select policyname, cmd from pg_policies
where schemaname='public' and tablename='delivery_photos';
-- 期待: 1行（delivery_photos_table_select・SELECT）。INSERT/UPDATE/DELETEポリシーが無いこと

-- 6-3) バケットは private・想定どおりの制限か
select id, public, file_size_limit, allowed_mime_types
from storage.buckets where id = 'delivery-photos';
-- 期待: public=false・file_size_limit=15728640・allowed_mime_types に image/jpeg 等

-- 6-4) ポリシーが2つ（insert/select）とも helper関数を含むか（bucket_id単独の緩い許可が無いか）
select policyname, cmd,
       case when qual is null then '(insert)' else 'using: ' || qual end     as using_expr,
       coalesce('check: ' || with_check, '-')                                as check_expr
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
  and policyname in ('delivery_photos_insert','delivery_photos_select')
order by policyname;
-- 期待: 2行。insert=storage_own_driver_folder(name) を含む／select=storage_driver_visible(name) を含む
--   UPDATE/DELETE版が無いこと＝写真の後日差し替え・通常経路での削除が不可な設計どおり

select count(*) as loose_policies
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
  and (qual like '%delivery-photos%' or with_check like '%delivery-photos%')
  and qual not like '%storage_own_driver_folder%' and qual not like '%storage_driver_visible%'
  and (with_check is null or with_check not like '%storage_own_driver_folder%');
-- 期待: 0（delivery-photos に対する bucket_id 単独の緩い許可が残っていない）
