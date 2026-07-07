-- =============================================================
-- Claude API PoC（配送状況の自動応答）v0 — PIIマスキングを担うDB関数
--   対応: 要件定義 7.4（問合番号→状況・配達予定）/ 11.3・11（AI入力のPIIマスキング）/ 6.10（ステータス）
-- 実行: Supabase SQL Editor。前提=配車v0.5＋採番一式v0.5（deliveries に status・delivery_date・time_window 等）。
-- =============================================================
-- ★本質: AIに渡してよいのは「状況回答に必要な非個人情報」だけ。
--   この SECURITY DEFINER 関数は **氏名・詳細住所・連絡先を一切返さない**。
--   返すのは status・delivery_date・time_window・delivery_order・市レベル(municipality) のみ。
--   ＝サーバ(Cloud Run/Hono)も Claude もPIIを受け取らない（マスキングを源流で強制）。
-- ・問合番号は荷受人が未認証で照会する想定（PoC）。本番は簡易認証(7.1)を前段に付ける。
-- ・service_role を使わずに済むよう、関数経由でのみ非PII状況を引けるようにする。
-- =============================================================

create or replace function public.delivery_status_public(p_tracking_number text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'tracking_number', d.tracking_number,
    'status',          d.status,             -- 6.10: 未配車/配車済/仕分済/配送中/完了/不在
    'delivery_date',   d.delivery_date,      -- 配達予定日
    'time_window',     d.time_window,        -- 時間帯
    'delivery_order',  d.delivery_order,     -- 配達順（おおよその順番）
    'municipality',    (select am.municipality          -- 市レベルのみ（詳細住所は返さない）
                          from public.address_master am
                          where am.common_id = d.common_id
                          limit 1)
  )
  from public.deliveries d
  where d.tracking_number = p_tracking_number
  limit 1
$$;
--   ↑ recipient_name（氏名）・address（詳細住所）・連絡先 は **意図的に SELECT しない**。
--   存在しない問合番号は 0 行 → 関数は NULL を返す（サーバ側で 404 統一エラーにする）。

comment on function public.delivery_status_public(text) is
  'Claude API PoC用: 問合番号→非個人情報の配送状況(status/予定日/時間帯/配達順/市)。氏名・詳細住所・連絡先は返さない（PIIマスキング源流）';

-- 実行権限：未認証(anon)＋認証(authenticated)。既定の PUBLIC 実行権は剥がす。
revoke execute on function public.delivery_status_public(text) from public;
grant  execute on function public.delivery_status_public(text) to anon, authenticated;


-- 確認（任意）-------------------------------------------------------
-- select public.delivery_status_public('900000000001');   -- 非PIIのjsonbが返る
-- select public.delivery_status_public('NOTEXIST');        -- NULL
