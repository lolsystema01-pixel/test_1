-- =============================================================
-- ラベル印刷ブリッジ v0.4 — ラベルペイロード（機種非依存）＋印刷履歴＋記録関数
--   対応: 要件定義 6.8 ラベル印刷（生成→Brother TD-2350へb-PAC送信〔機種抽象化〕／再印刷／履歴）。
-- 実行: Supabase SQL Editor。前提=配車v0.5＋採番一式v0.5（deliveries に driver_id・basket_code・delivery_order）。
-- =============================================================
-- ★ラベル内容は確定（数字のみ）：大＝かご記号＋配達順 / 小＝問合番号。住所・氏名は載せない。
--  ・ペイロードは「機種非依存」＝かご記号・配達順・問合番号 だけ。b-PAC/Brother の具体は外注ブリッジ側。
--  ・area RLS（自営業所のみ）を security_invoker で継承。
--  ・印刷履歴の書込みは SECURITY DEFINER 関数 record_prints 経由＝service_role不要・書込みRLSポリシー不要。
-- =============================================================


-- ① ラベルペイロード（ドライバー確定＋かご記号確定の荷物。1荷物=1ラベル）-----
create or replace view public.label_payload
with (security_invoker = on) as
select
  d.office_code,
  d.delivery_date,
  d.driver_id,
  d.tracking_number,   -- 小ラベル＝問合番号（数字のみ）
  d.basket_code,       -- 大ラベル前半＝かご記号
  d.delivery_order     -- 大ラベル後半＝配達順
from public.deliveries d
where d.driver_id is not null
  and d.basket_code is not null;   -- 採番済（印刷対象）

comment on view public.label_payload is
  'ラベル印刷の機種非依存ペイロード：かご記号・配達順・問合番号（住所/氏名は含まない）。area RLS';

grant select on public.label_payload to authenticated;


-- ② 印刷履歴 print_history（何を・いつ・誰が・どの端末で）------------------
create table if not exists public.print_history (
  id              bigint generated always as identity primary key,
  printed_at      timestamptz not null default now(),
  printed_by      uuid,                         -- auth.uid()
  office_code     text,
  tracking_number text,
  basket_code     text,
  delivery_order  integer,
  kind            text not null default 'print'  -- print / reprint / pdf
                  check (kind in ('print','reprint','pdf')),
  terminal_id     text,                          -- 端末別ON/OFFの識別（任意）
  payload         jsonb                          -- 機種非依存ペイロードのスナップショット
);
comment on table public.print_history is 'ラベル印刷履歴（再印刷の元）。書込みは record_prints 関数経由';

create index if not exists idx_print_history_office_date
  on public.print_history (office_code, printed_at desc);

-- RLS：SELECT は hq=全 / area=自営業所。書込みポリシーは置かない（関数経由のみ）。
alter table public.print_history enable row level security;
grant select on public.print_history to authenticated;

drop policy if exists print_history_hq   on public.print_history;
drop policy if exists print_history_area on public.print_history;
create policy print_history_hq   on public.print_history for select to authenticated
  using ( public.my_role() = 'hq' );
create policy print_history_area on public.print_history for select to authenticated
  using ( public.my_role() = 'area' and office_code = public.my_office() );


-- ③ 記録関数 record_prints（SECURITY DEFINER）----------------------------
--   ・印刷/再印刷/PDF出力を履歴に記録。printed_by=auth.uid() に固定。
--   ・area は自営業所(my_office())に固定＝他営業所の履歴は作れない。
--   ・書込みRLSポリシーを足さずに「自分の分だけ記録できる」を実現（shipper取込と同じ作法）。
create or replace function public.record_prints(p_items jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_office text := public.my_office();   -- area の所属営業所（hq等は NULL → items の office_code 採用）
  v_n      int;
begin
  if v_uid is null then
    raise exception '認証が必要です。' using errcode = '42501';
  end if;

  with ins as (
    insert into public.print_history
      (printed_by, office_code, tracking_number, basket_code, delivery_order, kind, terminal_id, payload)
    select
      v_uid,
      coalesce(v_office, r->>'office_code'),          -- ★area は自営業所に固定
      r->>'tracking_number',
      r->>'basket_code',
      nullif(r->>'delivery_order','')::int,
      coalesce(nullif(r->>'kind',''), 'print'),
      nullif(r->>'terminal_id',''),
      r
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as r
    returning 1
  )
  select count(*) into v_n from ins;
  return v_n;
end $$;

revoke execute on function public.record_prints(jsonb) from public;
grant  execute on function public.record_prints(jsonb) to authenticated;

comment on function public.record_prints(jsonb) is
  'ラベル印刷履歴の記録。printed_by=auth.uid()・area は my_office() に固定（書込みRLS不要・service_role不要）';


-- 確認（当日・営業所別のラベル対象件数）---------------------------------
select office_code, count(distinct driver_id) as drivers, count(*) as labels
from public.label_payload
where delivery_date = current_date
group by office_code order by office_code;
