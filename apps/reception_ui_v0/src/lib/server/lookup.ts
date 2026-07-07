// =============================================================
// 配送状況の読み取り（実接続）。検証Supabase の SECURITY DEFINER 関数
//   delivery_status_public(p_tracking_number) を anon キーで呼ぶ（非PII：status・市レベル等）。
//   ・PUBLIC_SUPABASE_URL / PUBLIC_SUPABASE_ANON_KEY が未設定なら アプリ内ダミーへフォールバック。
//   ・荷受人＝匿名のため RLS のかかった deliveries は直接読めない → 関数(anon可)経由で読む。
//   ・書き込み（受付登録）は本接続では行わない（読み取りのみ・指示書の範囲＋ユーザー判断）。
// =============================================================
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/public';
import { findDelivery } from './store';

let _client: SupabaseClient | null | undefined;
function client(): SupabaseClient | null {
  if (_client !== undefined) return _client;
  const url = env.PUBLIC_SUPABASE_URL;
  const key = env.PUBLIC_SUPABASE_ANON_KEY;
  _client = url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
  return _client;
}

export function isLive(): boolean {
  return client() !== null;
}

export type StatusView = { status: string | null; municipality: string | null };

// 問合番号 → 非PIIの状況。存在しなければ null。
export async function lookupDelivery(tn: string): Promise<StatusView | null> {
  const c = client();
  if (!c) {
    // フォールバック：アプリ内ダミー（env未設定時・テスト時）
    const d = findDelivery(tn);
    return d ? { status: d.status, municipality: d.municipality } : null;
  }
  const { data, error } = await c.rpc('delivery_status_public', { p_tracking_number: tn });
  if (error || !data) return null;
  const j = data as { status?: string; municipality?: string };
  return { status: j.status ?? null, municipality: j.municipality ?? null };
}
