-- =============================================================
-- 指示書: 住所正規化・共通ID判定 v0.2  【AI】手順1: 正規化＋下準備
--   対応: 6.2 全国配分（住所→共通ID）/ 第3章用語 / 第10章（郵便番号補助）
-- 実行: SQL Editor。前提=全国Master/ZonePlan読込済み・荷物取込済み。
-- =============================================================

-- ① 住所正規化関数（荷物側・Master側に同一適用する）------------
--   v0ルール: 空白除去(全角/半角) / 全角数字→半角 / ハイフン類→'-'
--   ※番地以降は判定で前方一致するため実質無視される。
--   ※丁目の漢数字（一丁目 等）は反復対象（今回のダミーには無い）。
create or replace function public.normalize_addr(p text)
returns text
language sql
immutable
as $$
  select case when p is null then null else
    translate(
      translate(
        regexp_replace(p, '[[:space:]　]', '', 'g'),  -- 空白(半角＋全角U+3000)除去
        '０１２３４５６７８９', '0123456789'             -- 全角数字→半角
      ),
      '‐‑–—―−ー－ｰ', '---------'                       -- ハイフン類9種→'-'
    )
  end
$$;
comment on function public.normalize_addr(text) is 'v0住所正規化（空白除去・全角数字半角化・ハイフン統一）。荷物/Master両側に適用';


-- ② 未登録住所テーブル（判定不能の記録先）--------------------
--   要件9.1: 問合番号・住所・対応区分・対応済み・メモ
create table if not exists public.unregistered_addresses (
  tracking_number    text primary key references public.deliveries(tracking_number) on delete cascade,
  address            text,
  normalized_address text,
  reason             text,                         -- 対応区分（判定不能の理由）
  resolved           boolean not null default false, -- 対応済み
  note               text,
  created_at         timestamptz not null default now()
);
comment on table public.unregistered_addresses is '判定不能住所の記録（修正フローへ。荷物は保留）';


-- ③ 郵便番号補助（第10章）：日本郵便データの参照先スタブ ------
--   本番は日本郵便の郵便番号データを読み込む。検証ではスタブ＋少量サンプル。
--   荷物に郵便番号があれば自治体・町名を補完/照合、無ければ町名マッチにフォールバック。
--   ※今回のダミー荷物に郵便番号列は無いため、実際の判定は町名マッチで行う。
create table if not exists public.postal_master (
  postal_code  text primary key,   -- 郵便番号（ハイフンなし正規化想定）
  prefecture   text,
  municipality text,
  town         text
);
comment on table public.postal_master is '郵便番号→自治体・町名（正規化補助。日本郵便データのスタブ）';

insert into public.postal_master (postal_code, prefecture, municipality, town) values
  ('4440000','愛知県','岡崎市','箱柳町'),   -- ダミー
  ('4710000','愛知県','豊田市','西町')      -- ダミー
on conflict (postal_code) do nothing;


-- ④ 正規化の自己テスト（表記ゆれが揃うか）--------------------
select tracking_number, address, public.normalize_addr(address) as normalized
from public.deliveries
where tracking_number in ('287477461927','281361685974','275726265038')  -- 通常/全角スペース/全角ハイフン+建物
order by tracking_number;
