-- =============================================================
-- 検証用: テストユーザーを「荷主(shipper)」に昇格する
--   荷主ポータル v0 の検証準備（7.2）。本部発行（オンボーディング）相当の昇格SQL。
--   前提:
--     ・荷主マスタ v0（shippers_master_v0）実機実行済み（shippers に SHIP01/SHIP02）。
--     ・RLS v0.2（rls_v0/）実行済み（profiles＋shipper RLS）。
--     ・テスト用メールで荷主ポータルに一度ログイン済み
--       → auth.users と profiles(role=NULL) が出来ている状態。
--   実行: Supabase SQL Editor（管理者＝RLS無視で更新できる）。
--   ※ Supabase SQL Editor は psql ではないため \set 変数は使えません。直接埋め込みます。
-- =============================================================
-- ★ テストアカウントのメール: §2・§3 で 'lolsystem.a01@gmail.com' を使用（必要なら2か所差替え）。
--   ※ このメールが Google等で作成済み＝パスワード未設定なら、ポータルは「マジックリンク」でログインする。
-- =============================================================

-- 0) 荷主マスタの存在確認（無ければ shippers_master_v0 を先に実行）------
do $$
begin
  if not exists (select 1 from public.shippers where shipper_id in ('SHIP01','SHIP02')) then
    raise exception '荷主マスタ未投入: 先に supabase/shippers_master_v0/shippers_v0.sql を実行してください。';
  end if;
end $$;

-- 1) 検証用の自社荷物 seed（冪等）------------------------------------
--    SHIP01=自社2件 / SHIP02=他社1件（RLSで荷主SHIP01には見えないことを実証）。
--    12桁デモ問合番号（9000… 帯・実CSV値と衝突しない）。delivery_date=当日。
insert into public.deliveries
  (tracking_number, delivery_date, address, common_id, depot_code, office_code, status, time_window, shipper_id, import_batch_id) values
  ('900000000051', current_date, '愛知県岡崎市箱柳町10-1', 'OKZ_C_01_08', 'D01', 'A01', '未配車', '午前', 'SHIP01', 'BATCH-SHIPSEED'),
  ('900000000052', current_date, '愛知県豊田市西町20-2', 'TYT_C_25_36', 'D01', 'A01', '配車済', '午後', 'SHIP01', 'BATCH-SHIPSEED'),
  ('900000000053', current_date, '愛知県東海市南柴田町30-3', 'TKI_C_03_07', 'D02', 'C01', '未配車', '夜間', 'SHIP02', 'BATCH-SHIPSEED')
  on conflict (tracking_number) do nothing;

-- 2) テストユーザーを shipper(SHIP01) に昇格（role / 帰属を付与）--------
update public.profiles p
set role        = 'shipper',
    shipper_id  = 'SHIP01',
    depot_code  = null,
    office_code = null,
    driver_id   = null
from auth.users u
where u.id = p.user_id
  and u.email = 'shipper01@test.local';   -- ★ テスト用メール

-- 3) 確認：昇格できたか --------------------------------------------------
select u.email, p.role, p.shipper_id
from public.profiles p
join auth.users u on u.id = p.user_id
where u.email = 'shipper01@test.local';   -- ★ 同じメール
-- 期待: role=shipper / shipper_id=SHIP01

-- 4) 期待される可視件数（ポータル状況確認の答え合わせ用）----------------
--    ・自社(SHIP01)の荷物 = この seed 2件 ＋ 既存の SHIP01 荷物（荷主マスタ取込16件 等）
--    ・他社(SHIP02)の 900000000053 は RLS(deliveries_shipper) により 0件で見えない
--    ・荷主名称 'HACHI EXPRESS' は shippers から表示（shipper RLS=自社行のみ）
