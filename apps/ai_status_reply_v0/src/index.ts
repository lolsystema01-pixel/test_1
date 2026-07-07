// =============================================================
// Cloud Run（Hono+TS）— Claude API PoC（配送状況の自動応答）v0
//   POST /api/v1/ai/delivery-status-reply  { tracking_number, question? }
//   1) 問合番号で非PIIの配送状況を引く（SECURITY DEFINER 関数・PIIマスキング源流）
//   2) マスク済みデータを Claude に渡し、状況＋配達予定を日本語自然文で回答
//   3) 該当なしは 404 ＋統一エラー形式（API契約v0：code/message）
//   ※ PoC：荷受人の認証ゲートは範囲外（本番は問合番号＋簡易認証=7.1 を前段に）。
// =============================================================
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import type { Context } from 'hono';
import { env } from './env.js';
import { fetchMaskedDelivery } from './supabase.js';
import { generateReply } from './claude.js';

const app = new Hono();

// 統一エラー（API契約v0 1.5）: { error: { code, message } }
function fail(c: Context, code: string, message: string, status: number) {
  return c.json({ error: { code, message } }, status as 400 | 401 | 404 | 422 | 500);
}

app.get('/health', (c) => c.json({ ok: true }));

app.post('/api/v1/ai/delivery-status-reply', async (c) => {
  // 入力
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return fail(c, 'VALIDATION_ERROR', 'JSON ボディを解釈できませんでした。', 400);
  }
  const tn = String((body as { tracking_number?: unknown })?.tracking_number ?? '').trim();
  if (!tn) {
    return fail(c, 'VALIDATION_ERROR', 'tracking_number（問合番号）は必須です。', 400);
  }
  const qRaw = (body as { question?: unknown })?.question;
  const question = typeof qRaw === 'string' ? qRaw : undefined;
  console.log(`[req] tracking_number=${tn} → Supabase照会…`);

  // 非PIIの配送状況を取得（PIIはここに来ない）
  let masked;
  try {
    masked = await fetchMaskedDelivery(tn);
  } catch (e) {
    console.error('[err] Supabase照会失敗:', e instanceof Error ? e.message : e);
    return fail(c, 'INTERNAL_ERROR', '配送状況の照会に失敗しました。時間をおいて再度お試しください。', 500);
  }
  console.log(`[req] 照会OK status=${masked?.status ?? '(該当なし)'} → Claude呼び出し…`);
  if (!masked) {
    return fail(
      c,
      'NOT_FOUND',
      `問合番号「${tn}」の配送情報が見つかりませんでした。番号をご確認のうえ、もう一度お試しください。`,
      404
    );
  }

  // Claude で自然文回答（マスク済みデータのみ渡す）
  let reply: string;
  try {
    reply = await generateReply(masked, question);
  } catch (e) {
    console.error('[err] Claude呼び出し失敗:', e instanceof Error ? e.message : e);
    return fail(c, 'INTERNAL_ERROR', 'AI応答の生成に失敗しました。時間をおいて再度お試しください。', 500);
  }
  console.log('[req] Claude応答OK → 返却');
  if (!reply) {
    return fail(c, 'INTERNAL_ERROR', 'AI応答が空でした。時間をおいて再度お試しください。', 500);
  }

  return c.json({
    data: {
      tracking_number: masked.tracking_number,
      status: masked.status,
      reply
    }
  });
});

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  // ★ APIキーは出さない。起動URLのみ。
  console.log(`ai_status_reply_v0 listening on http://localhost:${info.port}`);
  console.log(`POST http://localhost:${info.port}/api/v1/ai/delivery-status-reply`);
});

export { app };
