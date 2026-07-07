// Supabase クライアント（anonキー）。問合番号→非PII状況は SECURITY DEFINER 関数経由。
//   service_role は使わない（関数が非PIIのみ返す＝強い鍵をサーバに置かない）。
import { createClient } from '@supabase/supabase-js';
import { env } from './env.js';
import type { MaskedDelivery } from './prompt.js';

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

// 問合番号→非PIIの配送状況。見つからなければ null。
export async function fetchMaskedDelivery(trackingNumber: string): Promise<MaskedDelivery | null> {
  const { data, error } = await supabase.rpc('delivery_status_public', {
    p_tracking_number: trackingNumber
  });
  if (error) throw new Error(`status lookup failed: ${error.message}`);
  return (data as MaskedDelivery | null) ?? null;
}
