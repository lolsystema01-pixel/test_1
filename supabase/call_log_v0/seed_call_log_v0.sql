-- =============================================================
-- 通話・対応ログ v0 — ダミー通話 seed
-- 実行: call_log_v0.sql の後。Supabase SQL Editor にコピペして Run。
-- ★ record_call_log 経由（テーブル直INSERTはしない＝記録口一本化の作法をseedでも踏襲）。
--   call_sid の一意制約で自然に冪等（何度Runしても行は増えない＝duplicateが返るだけ）。
-- 正本: docs/shijisho_drafts/shijisho_call_log_v0_1_draft.md の列名（intent/outcome/summary/callback_*）。
-- 前提: ダミー正準規格v1（docs/dummy_data_standard_v1.md）— 9000帯12桁・A01=DRV001/SHIP01・
--        SHIP02＝RLS分離デモ。tracking_number は call_logs にFK無し（ゆるい参照）なので
--        rls_v0/dbschema_v0 未投入でも本seedは単独で動く。
-- =============================================================

-- ① AI完結：状況照会（A01・DRV001圏・SHIP01）------------------------------
select public.record_call_log(
  p_call_sid        := 'CALL-SEED-0001',
  p_caller_phone    := '090-1234-0001',
  p_tracking_number := '900000000001',
  p_band_key        := 'demo9000',
  p_intent          := '状況照会',
  p_summary         := '配達予定日の確認。本日午前中の見込みと回答。',
  p_transcript      := 'お客様: 荷物はいつ届きますか。AI: 本日午前中のお届け予定です。',
  p_recording_url   := 'https://example.com/rec/call-seed-0001.mp3',
  p_outcome         := 'AI完結',
  p_priority        := 0,
  p_channel         := 'ai_phone',
  p_started_at      := '2026-07-15 09:00:00+09',
  p_ended_at        := '2026-07-15 09:01:40+09',
  p_duration_sec    := 100
) as seed_1;

-- ② AI完結：再配達受付につながった（SHIP02圏）------------------------------
select public.record_call_log(
  p_call_sid        := 'CALL-SEED-0002',
  p_caller_phone    := '090-1234-0002',
  p_tracking_number := '900000000002',
  p_band_key        := 'demo9000',
  p_intent          := '再配達',
  p_summary         := '不在のため翌日午前へ再配達希望。受付登録済み。',
  p_transcript      := 'お客様: 不在だったので明日の午前にお願いします。AI: 承知しました、受付番号は…',
  p_recording_url   := 'https://example.com/rec/call-seed-0002.mp3',
  p_outcome         := 'AI完結',
  p_receipt_no      := 'R-DEMO-0002',
  p_priority        := 0,
  p_channel         := 'ai_phone',
  p_started_at      := '2026-07-15 10:12:00+09',
  p_ended_at        := '2026-07-15 10:14:30+09',
  p_duration_sec    := 150
) as seed_2;

-- ③ 折り返し要：時間変更（通常優先度・C01圏）--------------------------------
select public.record_call_log(
  p_call_sid        := 'CALL-SEED-0003',
  p_caller_phone    := '090-1234-0003',
  p_tracking_number := '900000000011',
  p_band_key        := 'demo9000',
  p_intent          := '時間変更',
  p_summary         := '時間帯変更の希望あり。込み入った条件のため担当者から折り返し。',
  p_transcript      := 'お客様: 時間を夜間に変えたいけど条件があって…AI: 担当者より折り返しご連絡します。',
  p_recording_url   := 'https://example.com/rec/call-seed-0003.mp3',
  p_outcome         := '折り返し要',
  p_priority        := 0,
  p_channel         := 'ai_phone',
  p_started_at      := '2026-07-15 11:05:00+09',
  p_ended_at        := '2026-07-15 11:07:10+09',
  p_duration_sec    := 130
) as seed_3;

-- ④ 折り返し要：クレーム（優先度高＝engine側で優先度を上げる想定のデモ）------
select public.record_call_log(
  p_call_sid        := 'CALL-SEED-0004',
  p_caller_phone    := '080-9999-0004',
  p_tracking_number := null,
  p_band_key        := null,
  p_intent          := 'クレーム',
  p_summary         := '配達時の対応についてお怒りの様子。至急担当者から折り返し希望。',
  p_transcript      := 'お客様: さっきのドライバーの対応はひどい！AI: 大変申し訳ございません。至急担当より折り返します。',
  p_recording_url   := 'https://example.com/rec/call-seed-0004.mp3',
  p_outcome         := '折り返し要',
  p_priority        := 9,
  p_channel         := 'ai_phone',
  p_started_at      := '2026-07-15 13:20:00+09',
  p_ended_at        := '2026-07-15 13:22:45+09',
  p_duration_sec    := 165
) as seed_4;

-- ⑤ 転送済：置き配の相談でオペレーター転送（SHIP02圏）------------------------
select public.record_call_log(
  p_call_sid        := 'CALL-SEED-0005',
  p_caller_phone    := '090-1234-0005',
  p_tracking_number := '900000000012',
  p_band_key        := 'demo9000',
  p_intent          := '置き配',
  p_summary         := '置き配可否の複雑な条件でオペレーターへ転送。',
  p_transcript      := 'お客様: 置き配の場所について相談したいのですが…AI: オペレーターにおつなぎします。',
  p_recording_url   := 'https://example.com/rec/call-seed-0005.mp3',
  p_outcome         := '転送済',
  p_priority        := 0,
  p_channel         := 'ai_phone',
  p_started_at      := '2026-07-15 14:40:00+09',
  p_ended_at        := '2026-07-15 14:41:20+09',
  p_duration_sec    := 80
) as seed_5;

-- ⑥ いたずら：非通知・即切断 --------------------------------------------
select public.record_call_log(
  p_call_sid        := 'CALL-SEED-0006',
  p_caller_phone    := null,
  p_intent          := 'いたずら',
  p_summary         := '無言・いたずら通話と判定し切断。',
  p_outcome         := 'いたずら',
  p_priority        := 0,
  p_channel         := 'ai_phone',
  p_started_at      := '2026-07-15 15:00:00+09',
  p_ended_at        := '2026-07-15 15:00:08+09',
  p_duration_sec    := 8
) as seed_6;

-- ⑦ 中断：通話が途中で切れた --------------------------------------------
select public.record_call_log(
  p_call_sid        := 'CALL-SEED-0007',
  p_caller_phone    := '090-1234-0007',
  p_intent          := 'その他',
  p_summary         := '通話途中で切断。用件未確定。',
  p_outcome         := '中断',
  p_priority        := 0,
  p_channel         := 'ai_phone',
  p_started_at      := '2026-07-15 16:30:00+09',
  p_ended_at        := '2026-07-15 16:30:35+09',
  p_duration_sec    := 35
) as seed_7;

-- 確認（件数）------------------------------------------------------------
select outcome, count(*) from public.call_logs where call_sid like 'CALL-SEED-%' group by outcome order by outcome;
-- 期待: AI完結2・折り返し要2・転送済1・いたずら1・中断1（計7）
