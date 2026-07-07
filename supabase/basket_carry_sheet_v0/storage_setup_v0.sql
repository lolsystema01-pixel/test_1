-- =============================================================
-- 指示書: かご持出表PDF v0 — 手順 3/3：Supabase Storage バケット＋ポリシー
--   対応: 6.9（かご持出表PDFをStorageに保存・Phase1はGドライブ併用）。
-- 実行: Supabase SQL Editor（postgres）。※Storageは Supabase 専用（ローカルpglite対象外）。
-- =============================================================
-- ・かご持出表PDFの保存先バケット。private（公開しない）。配車表PDFと同じ導線。
-- ・パス運用: `<office_code>/<delivery_date>/<driver_id>.pdf`（営業所別に整理）。
-- ・v0は authenticated にバケット内の読み書きを許可（最小）。営業所単位の厳密制限は後続で
--   パスprefix（office_code）＋ profiles 連携のポリシーに強化する。
-- =============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('carry-sheets', 'carry-sheets', false, 52428800, array['application/pdf'])  -- 上限50MB・PDFのみ
on conflict (id) do update set
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists carry_sheets_insert on storage.objects;
create policy carry_sheets_insert on storage.objects
  for insert to authenticated
  with check ( bucket_id = 'carry-sheets' );

drop policy if exists carry_sheets_select on storage.objects;
create policy carry_sheets_select on storage.objects
  for select to authenticated
  using ( bucket_id = 'carry-sheets' );

-- 確認 ---------------------------------------------------------------
select id, public from storage.buckets where id = 'carry-sheets';
-- 期待: carry-sheets / public=false
