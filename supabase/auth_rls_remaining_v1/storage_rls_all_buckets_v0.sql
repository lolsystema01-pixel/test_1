-- =============================================================
-- 指示書: 認証・権限 残課題 v1.1 — ① Storage の営業所別prefix制限
--   対応: 3バケット（carry-sheets / dispatch-sheets / godoor-csv）を
--         object名の office_code prefix × profiles(my_*) で自営業所のみに制限。
--         HQ=全office ／ 拠点(depot)=配下営業所 ／ area=自営業所 ／ その他=拒否。
--         読取(select)・書込(insert/update) とも強制。
-- 実行: Supabase SQL Editor（postgres）。3つの storage_setup_v0.sql（バケット作成）実行後。
-- =============================================================
-- 【現状の問題】
--   既存ポリシーは `bucket_id = '<bucket>'` のみ＝authenticated なら
--   他営業所のパスも読める／書ける（バケット単位の許可）。
--
-- 【パス運用（フロント実装と一致・改修不要）】
--   carry-sheets   : <office_code>/<delivery_date>/all.pdf        （carry/+page.svelte）
--   dispatch-sheets: <office_code>/<delivery_date>/<mode>.pdf     （sheet/+page.svelte）
--   godoor-csv     : <office_code>/<delivery_date>/<batch_key>    （godoor/+page.svelte）
--   → 先頭フォルダ = office_code。`(storage.foldername(name))[1]` で取り出す。
--
-- 【UPDATE を足す理由】
--   フロントは `upload(..., { upsert: true })`。同日同パスの再保存は UPDATE になるため、
--   insert ポリシーだけでは上書き保存が失敗する（既存の潜在バグ）。書込＝insert＋update を強制する。
--   DELETE は付与しない（default-deny のまま）。
-- =============================================================


-- =============================================================
-- §1. スコープ判定ヘルパ（3バケット共通）
--   object名の先頭フォルダ(office_code)が、呼び出しユーザーの可視営業所に含まれるか。
--   ※ my_role()/my_office()/my_depot_offices() は SECURITY DEFINER（profiles/offices を跨ぐ）。
--      本関数は DEFINER 不要（呼び出しユーザーの auth.uid() がそのまま効く）。
-- =============================================================
create or replace function public.storage_office_allowed(object_name text)
returns boolean
language sql
stable
as $$
  select case public.my_role()
    when 'hq'    then true                                                                  -- 本部/管理者=全office
    when 'depot' then (storage.foldername(object_name))[1] in (select public.my_depot_offices())  -- 拠点=配下営業所
    when 'area'  then (storage.foldername(object_name))[1] = public.my_office()             -- 営業所=自営業所のみ
    else false                                                                              -- driver/shipper/未設定=拒否
  end
$$;

comment on function public.storage_office_allowed(text) is
  '帳票Storageのスコープ判定：object名の先頭フォルダ(office_code)が自分の可視営業所か（hq=全/depot=配下/area=自営業所/他=拒否）';

grant execute on function public.storage_office_allowed(text) to authenticated;


-- =============================================================
-- §2. carry-sheets（かご持出表PDF）
-- =============================================================
drop policy if exists carry_sheets_select on storage.objects;
create policy carry_sheets_select on storage.objects
  for select to authenticated
  using ( bucket_id = 'carry-sheets' and public.storage_office_allowed(name) );

drop policy if exists carry_sheets_insert on storage.objects;
create policy carry_sheets_insert on storage.objects
  for insert to authenticated
  with check ( bucket_id = 'carry-sheets' and public.storage_office_allowed(name) );

drop policy if exists carry_sheets_update on storage.objects;
create policy carry_sheets_update on storage.objects
  for update to authenticated
  using      ( bucket_id = 'carry-sheets' and public.storage_office_allowed(name) )
  with check ( bucket_id = 'carry-sheets' and public.storage_office_allowed(name) );


-- =============================================================
-- §3. dispatch-sheets（配車表PDF）
-- =============================================================
drop policy if exists dispatch_sheets_select on storage.objects;
create policy dispatch_sheets_select on storage.objects
  for select to authenticated
  using ( bucket_id = 'dispatch-sheets' and public.storage_office_allowed(name) );

drop policy if exists dispatch_sheets_insert on storage.objects;
create policy dispatch_sheets_insert on storage.objects
  for insert to authenticated
  with check ( bucket_id = 'dispatch-sheets' and public.storage_office_allowed(name) );

drop policy if exists dispatch_sheets_update on storage.objects;
create policy dispatch_sheets_update on storage.objects
  for update to authenticated
  using      ( bucket_id = 'dispatch-sheets' and public.storage_office_allowed(name) )
  with check ( bucket_id = 'dispatch-sheets' and public.storage_office_allowed(name) );


-- =============================================================
-- §4. godoor-csv（GoDoor CSV）
-- =============================================================
drop policy if exists godoor_csv_select on storage.objects;
create policy godoor_csv_select on storage.objects
  for select to authenticated
  using ( bucket_id = 'godoor-csv' and public.storage_office_allowed(name) );

drop policy if exists godoor_csv_insert on storage.objects;
create policy godoor_csv_insert on storage.objects
  for insert to authenticated
  with check ( bucket_id = 'godoor-csv' and public.storage_office_allowed(name) );

drop policy if exists godoor_csv_update on storage.objects;
create policy godoor_csv_update on storage.objects
  for update to authenticated
  using      ( bucket_id = 'godoor-csv' and public.storage_office_allowed(name) )
  with check ( bucket_id = 'godoor-csv' and public.storage_office_allowed(name) );


-- =============================================================
-- §5. 確認（postgres で実行＝RLSバイパス。範囲外0件の証明は実機ログインで）
-- =============================================================
-- 5-1) 3バケットのポリシーが prefix 制限に差し替わったか
select policyname, cmd,
       case when qual is null then '(insert)' else 'using: ' || qual end            as using_expr,
       coalesce('check: ' || with_check, '-')                                        as check_expr
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
  and policyname in ('carry_sheets_select','carry_sheets_insert','carry_sheets_update',
                     'dispatch_sheets_select','dispatch_sheets_insert','dispatch_sheets_update',
                     'godoor_csv_select','godoor_csv_insert','godoor_csv_update')
order by policyname;
-- 期待: 9行。すべて storage_office_allowed(name) を含む（bucket_id だけの許可が残っていない）

-- 5-2) バケット単位の緩い許可が残っていないか（NGなら旧ポリシーの消し漏れ）
select count(*) as loose_policies
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
  and qual is not null
  and qual like '%bucket_id%'
  and qual not like '%storage_office_allowed%';
-- 期待: 0

-- 5-3) バケットは private のまま
select id, public from storage.buckets
where id in ('carry-sheets','dispatch-sheets','godoor-csv') order by id;
-- 期待: 3行すべて public=false


-- =============================================================
-- §6. 実機での証明（SQL Editor は postgres＝RLSバイパスのため必須）
--   ・area/IT01 でログイン → /carry /sheet /godoor で保存が成功（自営業所パス）。
--   ・area/IT01 で他営業所パス（例 'A01/2026-07-08/all.pdf'）を download → 失敗/0件。
--   ・hq は全office、depot は配下営業所のみ読める。
--   → verify_rls_scope_checklist_v0.md に記録。
-- =============================================================
