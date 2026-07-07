-- =============================================================
-- 指示書: GoDoor用CSV出力 v0.2 — 手順 3/3：Supabase Storage バケット＋ポリシー
--   対応: 6.9（GoDoor用CSVをStorageに保存・日付サブフォルダ・Phase1はGドライブ併用）。
-- 実行: Supabase SQL Editor（postgres）。※Storageは Supabase 専用（ローカルpglite対象外）。
-- =============================================================
-- ・GoDoor用CSVの保存先バケット。private。配車表PDF/かご持出表と同じ導線。
-- ・パス運用: `<office_code>/<delivery_date>/<yyyyMMdd>_GODOOR_<全体|ドライバー名>.csv`。
-- ・v0は authenticated にバケット内の読み書きを許可（最小）。営業所単位の厳密制限は後続。
-- =============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('godoor-csv', 'godoor-csv', false, 52428800,
        array['text/csv','text/csv;charset=utf-8','application/vnd.ms-excel'])  -- 上限50MB・CSV
on conflict (id) do update set
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists godoor_csv_insert on storage.objects;
create policy godoor_csv_insert on storage.objects
  for insert to authenticated
  with check ( bucket_id = 'godoor-csv' );

drop policy if exists godoor_csv_select on storage.objects;
create policy godoor_csv_select on storage.objects
  for select to authenticated
  using ( bucket_id = 'godoor-csv' );

-- 確認 ---------------------------------------------------------------
select id, public from storage.buckets where id = 'godoor-csv';
-- 期待: godoor-csv / public=false
