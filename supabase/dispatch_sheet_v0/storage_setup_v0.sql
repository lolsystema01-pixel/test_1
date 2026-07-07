-- =============================================================
-- 指示書: 配車表PDF v0 — 手順 4/4：Supabase Storage バケット＋ポリシー
--   対応: 6.9（配車表PDFをStorageに保存・Phase1はGドライブ併用）。
-- 実行: Supabase SQL Editor（postgres）。※Storageは Supabase 専用（ローカルpglite対象外）。
-- =============================================================
-- ・配車表PDFの保存先バケット。private（公開しない）。
-- ・パス運用: `<office_code>/<delivery_date>/<mode>_<driver>.pdf` を推奨（営業所別に整理）。
-- ・v0は authenticated にバケット内の読み書きを許可（最小）。営業所単位の厳密制限は後続で
--   パスprefix（office_code）＋ profiles 連携のポリシーに強化する。
-- =============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('dispatch-sheets', 'dispatch-sheets', false, 52428800, array['application/pdf'])  -- 上限50MB・PDFのみ
on conflict (id) do update set
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists dispatch_sheets_insert on storage.objects;
create policy dispatch_sheets_insert on storage.objects
  for insert to authenticated
  with check ( bucket_id = 'dispatch-sheets' );

drop policy if exists dispatch_sheets_select on storage.objects;
create policy dispatch_sheets_select on storage.objects
  for select to authenticated
  using ( bucket_id = 'dispatch-sheets' );

-- 確認 ---------------------------------------------------------------
select id, public from storage.buckets where id = 'dispatch-sheets';
-- 期待: dispatch-sheets / public=false
