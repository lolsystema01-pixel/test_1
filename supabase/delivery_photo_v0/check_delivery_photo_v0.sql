-- =============================================================
-- 置き配写真POD v0 確認SQL — 主張=検証 1:1 ／ 範囲外拒否の実証
-- 実行: delivery_photo_v0.sql の適用後。各ブロックを個別に実行（SQL Editor・postgres）。
-- 前提: rls_v0/seed_accounts_v0.sql 適用済み（下記ダミーUUIDが profiles に存在）。
--   hq='00000000-0000-0000-0000-000000000001'
--   depot D01='00000000-0000-0000-0000-0000000000e1'
--   area A01='00000000-0000-0000-0000-0000000000a1'
--   shipper SHIP01='00000000-0000-0000-0000-0000000000f1'
--   driver DRV001='00000000-0000-0000-0000-0000000000d1'
--   driver DRV002='00000000-0000-0000-0000-0000000000d2'（DRV001と同じA01の他ドライバー・存在しない場合は
--     rls_v0/seed_accounts_v0.sql 側でDRV002用アカウントの用意が必要。無ければ④のみ他モジュール実データで代替可）
--
-- 本ファイルは begin…rollback で完結させる（永続データを残さない）。
--   ①②はスキーマ確認（postgresのまま・RLSバイパス）。③以降はロール切替での機能確認。
-- =============================================================


-- ① 表・バケット設定の確認 ------------------------------------------------
select count(*) as "旧photo_path列が残っていない(0期待)" from information_schema.columns
where table_schema='public' and table_name='delivery_results' and column_name='photo_path';

select column_name, data_type from information_schema.columns
where table_schema='public' and table_name='delivery_photos' order by ordinal_position;
-- 期待: id/result_id/tracking_number/driver_id/seq/photo_path/recorded_at/created_by の8列

select policyname, cmd from pg_policies
where schemaname='public' and tablename='delivery_photos';
-- 期待: 1行（SELECTのみ）。INSERT/UPDATE/DELETEポリシーが無いこと

select id, public, file_size_limit, allowed_mime_types
from storage.buckets where id = 'delivery-photos';
-- 期待: 1行・public=false・file_size_limit=15728640・allowed_mime_types に image/jpeg 等

select policyname, cmd from pg_policies
where schemaname='storage' and tablename='objects'
  and policyname in ('delivery_photos_insert','delivery_photos_select')
order by policyname;
-- 期待: 2行（delivery_photos_insert=INSERT／delivery_photos_select=SELECT）。
--   UPDATE/DELETE版が無いこと＝写真の後日差し替え・通常経路での削除が不可な設計どおり（意図的にdefault-deny）


-- ② 主張=検証1:1：rpcを begin…rollback 内で自己完結的に検証（本番データを汚さない）--
-- 対象は本チェック専用のダミー問合番号（900000000901）。deliveries→delivery_results を
-- このトランザクション内だけで作り、rollbackで消す。

begin;
  -- 下準備（postgresとして直接INSERT。delivery_results/delivery_photos への書込みRLSは無い＝関数一本化のため
  -- postgresの直接INSERTのみがここで可能。この工程はテスト内の下準備であり、
  -- 本番運用での通常経路ではない＝record_delivery_result 経由が正）
  insert into public.deliveries (tracking_number, delivery_date, address, common_id, depot_code, office_code,
    driver_id, delivery_order, basket_code, status, time_window, shipper_id, import_batch_id)
  values ('900000000901', current_date, '愛知県岡崎市箱柳町9-1', 'OKZ_C_01_08', 'D01', 'A01',
    'DRV001', 1, 'Z', '完了', '午前', 'SHIP01', 'CHECK-DELIVERY-PHOTO-V0')
  on conflict (tracking_number) do nothing;
  insert into public.delivery_results (tracking_number, driver_id, result, created_by)
  values ('900000000901', 'DRV001', '完了', '00000000-0000-0000-0000-0000000000d1')
  on conflict do nothing;

  -- ②a DRV001本人が自分のフォルダ×自分のtracking_number×seq=1のパスをattach → recorded
  set local request.jwt.claims = '{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000000d1"}';
  set local role authenticated;
  select public.attach_delivery_photo('900000000901', 1, 'DRV001/900000000901/1.jpg') as "期待: result=recorded";

  -- ②b 同一パスの再送 → already（冪等）
  select public.attach_delivery_photo('900000000901', 1, 'DRV001/900000000901/1.jpg') as "期待: result=already";

  -- ②c 2枚目・3枚目もattachできる（最大3枚）
  select public.attach_delivery_photo('900000000901', 2, 'DRV001/900000000901/2.jpg') as "期待: result=recorded(seq2)";
  select public.attach_delivery_photo('900000000901', 3, 'DRV001/900000000901/3.jpg') as "期待: result=recorded(seq3)";

  reset role;
  select seq, photo_path from public.delivery_photos where tracking_number='900000000901' order by seq;
  -- 期待: 3行（seq1〜3・それぞれのpath）
rollback;
-- rollbackにより deliveries/delivery_results/delivery_photos とも本チェックのダミー行は残らない


-- ③ 範囲外拒否の実証（begin…rollbackで各ロールを疑似ログイン）------------
-- ③a 他人のフォルダを指すパス → 42501（DRV001が自分の実績にDRV002名義のパスをattachしようとする）
begin;
  insert into public.deliveries (tracking_number, delivery_date, address, common_id, depot_code, office_code,
    driver_id, delivery_order, basket_code, status, time_window, shipper_id, import_batch_id)
  values ('900000000902', current_date, '愛知県岡崎市箱柳町9-2', 'OKZ_C_01_08', 'D01', 'A01',
    'DRV001', 1, 'Z', '完了', '午前', 'SHIP01', 'CHECK-DELIVERY-PHOTO-V0')
  on conflict (tracking_number) do nothing;
  insert into public.delivery_results (tracking_number, driver_id, result, created_by)
  values ('900000000902', 'DRV001', '完了', '00000000-0000-0000-0000-0000000000d1')
  on conflict do nothing;

  set local request.jwt.claims = '{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000000d1"}';
  set local role authenticated;
  select public.attach_delivery_photo('900000000902', 1, 'DRV002/900000000902/1.jpg');
  -- 期待: ERROR 42501（写真パスは DRV001/900000000902/1.jpg である必要があります）
rollback;

-- ③a' 自分のフォルダだが別tracking_numberを指すパス（誤紐付け・MED-3の核心）→ 42501
begin;
  insert into public.deliveries (tracking_number, delivery_date, address, common_id, depot_code, office_code,
    driver_id, delivery_order, basket_code, status, time_window, shipper_id, import_batch_id)
  values ('900000000903', current_date, '愛知県岡崎市箱柳町9-3', 'OKZ_C_01_08', 'D01', 'A01',
    'DRV001', 1, 'Z', '完了', '午前', 'SHIP01', 'CHECK-DELIVERY-PHOTO-V0')
  on conflict (tracking_number) do nothing;
  insert into public.delivery_results (tracking_number, driver_id, result, created_by)
  values ('900000000903', 'DRV001', '完了', '00000000-0000-0000-0000-0000000000d1')
  on conflict do nothing;

  set local request.jwt.claims = '{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000000d1"}';
  set local role authenticated;
  select public.attach_delivery_photo('900000000903', 1, 'DRV001/900000000902/1.jpg'); -- 自分のフォルダだが902宛のパスを903に紐付けようとする
  -- 期待: ERROR 42501（写真パスは DRV001/900000000903/1.jpg である必要があります）
rollback;

-- ③b anon はGRANT無しで呼べない
begin;
  set local role anon;
  select public.attach_delivery_photo('900000000901', 1, 'x/x/1.jpg');
  -- 期待: ERROR permission denied for function attach_delivery_photo（42501）
rollback;

-- ③c hq/area/shipper は driver専用口を呼べない（hqの例。area/shipperも同様に確認）
begin;
  set local request.jwt.claims = '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000001"}';
  set local role authenticated;
  select public.attach_delivery_photo('900000000901', 1, 'DRV001/900000000901/1.jpg');
  -- 期待: ERROR 42501（置き配写真を記録できるのは担当ドライバーのみです）
rollback;

-- ③d 存在しない問合番号 → P0002
begin;
  set local request.jwt.claims = '{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000000d1"}';
  set local role authenticated;
  select public.attach_delivery_photo('900000000999', 1, 'DRV001/900000000999/1.jpg');
  -- 期待: ERROR P0002（対象の配達実績が見つかりません）
rollback;


-- ④ clear_delivery_photos（日内再訪の写真入れ替え）の確認 -------------------
-- ④a 安全装置：status=完了（不在ではない）の荷物へのclearは拒否
begin;
  insert into public.deliveries (tracking_number, delivery_date, address, common_id, depot_code, office_code,
    driver_id, delivery_order, basket_code, status, time_window, shipper_id, import_batch_id)
  values ('900000000904', current_date, '愛知県岡崎市箱柳町9-4', 'OKZ_C_01_08', 'D01', 'A01',
    'DRV001', 1, 'Z', '完了', '午前', 'SHIP01', 'CHECK-DELIVERY-PHOTO-V0')
  on conflict (tracking_number) do nothing;
  insert into public.delivery_results (tracking_number, driver_id, result, created_by)
  values ('900000000904', 'DRV001', '完了', '00000000-0000-0000-0000-0000000000d1')
  on conflict do nothing;

  set local request.jwt.claims = '{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000000d1"}';
  set local role authenticated;
  select public.clear_delivery_photos('900000000904');
  -- 期待: ERROR 42501（写真のクリアは不在からの再配達時のみ可能です）
rollback;

-- ④b 本人・不在状態でのclear成功
begin;
  insert into public.deliveries (tracking_number, delivery_date, address, common_id, depot_code, office_code,
    driver_id, delivery_order, basket_code, status, time_window, shipper_id, import_batch_id)
  values ('900000000905', current_date, '愛知県岡崎市箱柳町9-5', 'OKZ_C_01_08', 'D01', 'A01',
    'DRV001', 1, 'Z', '不在', '午前', 'SHIP01', 'CHECK-DELIVERY-PHOTO-V0')
  on conflict (tracking_number) do nothing;
  insert into public.delivery_results (tracking_number, driver_id, result, created_by)
  values ('900000000905', 'DRV001', '不在', '00000000-0000-0000-0000-0000000000d1')
  on conflict do nothing;
  insert into storage.objects (bucket_id, name) values
    ('delivery-photos','DRV001/900000000905/1.jpg') on conflict do nothing;
  insert into public.delivery_photos (result_id, tracking_number, driver_id, seq, photo_path, created_by)
  select id, '900000000905', 'DRV001', 1, 'DRV001/900000000905/1.jpg', '00000000-0000-0000-0000-0000000000d1'
  from public.delivery_results where tracking_number='900000000905' order by id desc limit 1
  on conflict do nothing;

  set local request.jwt.claims = '{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000000d1"}';
  set local role authenticated;
  select public.clear_delivery_photos('900000000905') as "期待: result=cleared・objects_deleted=1・rows_deleted=1";
  reset role;
  select count(*) as "clear後delivery_photos(0期待)" from public.delivery_photos where tracking_number='900000000905';
  select count(*) as "clear後storage.objects(0期待)" from storage.objects
    where bucket_id='delivery-photos' and name like 'DRV001/900000000905/%';
rollback;


-- =============================================================
-- ⑤ Storage RLS（実機でのみ完全に証明可能。SQL Editor上のロール切替で分かる範囲）-------
--   ★重要: storage.objects への直接INSERTはSQL Editorからでも可能だが、それは実際の
--   Supabase Storage API（マルチパートアップロード・ファイル本体の保存）を経由しないため
--   「本物のアップロード権限」の証明にはならない。ここでは行わない。
--   実機証明は 確認結果メモ.md の「実機確認手順」節を参照（アプリ or REST APIから
--   実際に write/read してポリシーの効き目を見る）。
-- =============================================================
-- ⑤a ポリシー定義の中身が正しいヘルパー関数を指しているか（再掲・目視確認用）
select policyname, cmd,
       case when qual is null then '(insert)' else 'using: ' || qual end     as using_expr,
       coalesce('check: ' || with_check, '-')                                as check_expr
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
  and policyname in ('delivery_photos_insert','delivery_photos_select')
order by policyname;

-- ⑤b storage.objects 全ポリシーの緩さ横断検査（このモジュール以外の分も含む）
--   目的: delivery_photos_insert/select 個別の中身確認（⑤a）だけでなく、storage.objects上に
--   存在する「全ての」PERMISSIVEポリシーの中に (a) to public（未認証含む全ロールに公開）のもの、
--   または (b) qual（using）／with_check に bucket_id での絞り込みを含まない＝バケット横断で
--   緩い許可、が無いことを確認する。他モジュール（他バケット）のポリシー設定ミスの検出も兼ねる。
select schemaname, tablename, policyname, permissive, roles, cmd,
       qual       as using_expr,
       with_check as check_expr
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
  and permissive = 'PERMISSIVE'
  and (
        'public' = any(roles)                                                -- to public（未認証含む）
        or (qual is not null and qual not ilike '%bucket_id%')                -- using に bucket_id 条件が無い
        or (with_check is not null and with_check not ilike '%bucket_id%')    -- with_check に bucket_id 条件が無い
      );
-- 期待: 0行。
--   ⚠ 1行でも出た場合: そのポリシーがバケットを問わず（または未認証に対して）意図せず広い
--   範囲の読み書きを許可している可能性が高い。delivery_photos_insert/delivery_photos_select
--   自身は bucket_id='delivery-photos' 条件を持つため、ここに出るのは他モジュールのポリシーの
--   疑いが強い＝policyname 列で特定してモジュール側を修正すること。

-- =============================================================
-- 合格条件との対応
--   ・旧photo_path列が残っていない・delivery_photos表が想定どおり               … ①
--   ・delivery-photos バケットがprivate・容量/MIME制限どおり                    … ①
--   ・Storageポリシーが2件（insert/select）でUPDATE/DELETEが無い                … ①
--   ・attach_delivery_photo: 本人紐付けOK・最大3枚・冪等                        … ②
--   ・attach_delivery_photo: 他人フォルダ拒否/誤紐付け拒否/anon拒否/非driver拒否/未存在拒否 … ③
--   ・clear_delivery_photos: 不在時のみ許可・他人拒否・成功時に行/オブジェクトが消える     … ④
--   ・Storageポリシーの実効性（実オブジェクトのINSERT/SELECT）                  … ⑤（実機必須・確認結果メモ.md参照）
--   ・storage.objects上に to public／bucket_id条件無しの緩い許可ポリシーが0件   … ⑤b
-- =============================================================
