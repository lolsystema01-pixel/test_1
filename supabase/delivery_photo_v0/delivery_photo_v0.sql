-- =============================================================
-- 指示書(ドライバーMVP 第1.5弾): 置き配写真POD v0
--   — delivery_results.photo_path 列 ＋ Storage delivery-photos バケット ＋ 記録口 attach_delivery_photo
--   対応: 要件定義 8.5（撮影ガイド文言）／設計書 §10.5（2026-07-17 管理側要望）
--     管理要望「置き配がどこに置かれたか見たい」。GPS精度5〜15mでは2件並びの識別は不可能＝
--     隣家識別の証拠は写真のみ、という結論に基づく。
-- 実行: Supabase SQL Editor（ブロック単位）。
-- 前提: dbschema_v0・rls_v0（profiles/my_*ヘルパ）・status_log_v0・delivery_result_v0
--       （delivery_results 表・record_delivery_result・my_depot_drivers() が適用済みであること）。
-- =============================================================


-- =============================================================
-- ① delivery_results に photo_path 列を追加
-- =============================================================
alter table public.delivery_results add column if not exists photo_path text;
comment on column public.delivery_results.photo_path is
  '機微: 置き配写真(POD)のStorageパス（delivery-photosバケット内・{driver_id}/{tracking_number}.jpg）。'
  '書込みは attach_delivery_photo 経由のみ（このテーブルにUPDATEのRLSポリシーは無い）';


-- =============================================================
-- ② Storage バケット delivery-photos（private）
--   quality 0.4 のJPEGを想定（アプリ側 launchCameraAsync）。上限15MB・画像のみ。
-- =============================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('delivery-photos', 'delivery-photos', false, 15728640, array['image/jpeg','image/jpg','image/png'])
on conflict (id) do update set
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;


-- =============================================================
-- ③ Storage RLS（既存パターン踏襲: auth_rls_remaining_v1/storage_rls_all_buckets_v0.sql の
--    storage_office_allowed(object名の先頭フォルダ×my_*) を driver_id 版に置き換えたもの）
--   パス運用: <driver_id>/<tracking_number>.jpg → 先頭フォルダ = driver_id。
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
  '置き配写真Storageの書込スコープ：object名の先頭フォルダ(driver_id)が呼び出しドライバー本人か（driver以外は常にfalse）';
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
-- =============================================================
create or replace function public.attach_delivery_photo(
  p_tracking_number text,
  p_photo_path      text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_driver   text := public.my_driver();
  v_prefix   text;
  v_id       bigint;
  v_owner    text;
  v_existing text;
begin
  -- 認可: driver本人のみ（record_delivery_result と同じ形）
  if v_uid is null or public.my_role() <> 'driver' or v_driver is null then
    raise exception '置き配写真を記録できるのは担当ドライバーのみです' using errcode = '42501';
  end if;

  -- 入力検証: 空・長さ超過（300文字）は拒否
  if p_photo_path is null or length(p_photo_path) = 0 or length(p_photo_path) > 300 then
    raise exception '写真パスが不正です（空または300文字超）' using errcode = '23514';
  end if;

  -- 他人のフォルダのパスを紐付けさせない（自分の driver_id プレフィックス必須）
  v_prefix := v_driver || '/';
  if left(p_photo_path, length(v_prefix)) <> v_prefix then
    raise exception '写真パスは自分のフォルダ（%）配下である必要があります', v_prefix using errcode = '42501';
  end if;

  -- 対象行: この問合番号の最新の delivery_results 行を行ロックして取得
  -- （tracking_number に一意制約は無い＝将来の再配達で複数行あり得るため最新を対象にする。
  --   delivery_result_v0/README「delivery_results に一意制約はあえて付けない」を参照）
  select id, driver_id, photo_path into v_id, v_owner, v_existing
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

  -- 冪等: 同一パスの再送（アップロード成功→attach失敗からの再試行等）は無害
  if v_existing is not null and v_existing = p_photo_path then
    return jsonb_build_object('result','already','tracking_number',p_tracking_number,'photo_path',v_existing);
  end if;

  -- 既に別の写真が記録済み＝上書きしない（明示エラー。23505等の制約違反コードは使わない）
  if v_existing is not null then
    raise exception 'この配達実績には既に別の写真が記録されています（問合番号=%）', p_tracking_number using errcode = 'P0001';
  end if;

  update public.delivery_results set photo_path = p_photo_path where id = v_id;

  return jsonb_build_object('result','recorded','tracking_number',p_tracking_number,'photo_path',p_photo_path);
end $$;

revoke execute on function public.attach_delivery_photo(text, text) from public;
grant  execute on function public.attach_delivery_photo(text, text) to authenticated;
comment on function public.attach_delivery_photo(text, text) is
  '置き配写真(POD)の記録口。driver本人限定・自フォルダのパスのみ・対象delivery_results行の所有者一致必須・'
  '冪等（同一パス再送は無害）・別写真への上書きは拒否。SECURITY DEFINER・search_path固定';


-- =============================================================
-- ⑤ 確認（postgres で実行＝RLSバイパス。範囲外拒否の完全な実証は実機で＝確認結果メモ.md参照）
-- =============================================================
-- 5-1) 列が追加されたか
select column_name, data_type from information_schema.columns
where table_schema='public' and table_name='delivery_results' and column_name='photo_path';
-- 期待: 1行（photo_path / text）

-- 5-2) バケットは private・想定どおりの制限か
select id, public, file_size_limit, allowed_mime_types
from storage.buckets where id = 'delivery-photos';
-- 期待: public=false・file_size_limit=15728640・allowed_mime_types に image/jpeg 等

-- 5-3) ポリシーが2つ（insert/select）とも helper関数を含むか（bucket_id単独の緩い許可が無いか）
select policyname, cmd,
       case when qual is null then '(insert)' else 'using: ' || qual end     as using_expr,
       coalesce('check: ' || with_check, '-')                                as check_expr
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
  and policyname in ('delivery_photos_insert','delivery_photos_select')
order by policyname;
-- 期待: 2行。insert=storage_own_driver_folder(name) を含む／select=storage_driver_visible(name) を含む

select count(*) as loose_policies
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
  and (qual like '%delivery-photos%' or with_check like '%delivery-photos%')
  and qual not like '%storage_own_driver_folder%' and qual not like '%storage_driver_visible%'
  and (with_check is null or with_check not like '%storage_own_driver_folder%');
-- 期待: 0（delivery-photos に対する bucket_id 単独の緩い許可が残っていない）
