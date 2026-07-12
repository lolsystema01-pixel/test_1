// =============================================================
// 受付登録の窓口（アプリ側ファサード・N-4/N-5）。lookup.ts と同型：
//   live … PUBLIC_SUPABASE_URL/PUBLIC_SUPABASE_ANON_KEY 設定時、anonキーで
//          supabase/reception_write_v0 の SECURITY DEFINER 関数を呼ぶ
//          （register_reception＝登録、get_reception_public＝非PIIサマリ照会）。
//   fallback … 未設定時は店頭のインメモリ実装（store.ts）へフォールバック
//          （既存挙動と完全一致。store.ts が業務仕様の正）。
//   RPCエラー（ネットワーク/PostgREST）時はフォールバックしない＝ok:falseを返す
//   （silent fallbackで書き込み先がDBとインメモリに割れるのを防ぐ）。
// =============================================================
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { registerReception as storeRegister, existingReception as storeExisting } from './store';

export type SubmitResult = {
  ok: boolean;
  duplicate?: boolean;
  receiptNo?: string;
  existing?: { receiptNo: string; type: string };
};

// register_reception の jsonb 戻り値（reception_write_v0.sql §3 準拠）
type RpcResult = {
  result: 'created' | 'duplicate' | 'overwritten' | 'unchanged' | 'format_error' | 'not_found';
  receipt_no: string | null;
  band_key: string | null;
  verified: boolean | null;
  existing_receipt_no: string | null;
  existing_type: string | null;
};

// get_reception_public の jsonb 戻り値（非PIIサマリ。§4準拠）
type RpcPublicView = {
  receipt_no?: string;
  type?: string;
  desired_date?: string;
  time_slot?: string;
  drop_place?: string;
  status?: string;
};

let _client: SupabaseClient | null | undefined;

// テスト専用フック（store.__resetForTest と同型）：client() の解決結果を差し替える。
//   ネットワークを介さず RPC 応答のマッピング（6-way switch／エラー時）を検証するための注入口。
//   undefined を渡すと解除＝次回 client() 呼び出し時に通常解決（$env → フォールバック）へ戻る。
export function __setClientForTest(c: unknown): void {
  _client = c as SupabaseClient | null | undefined;
}

async function client(): Promise<SupabaseClient | null> {
  if (_client !== undefined) return _client;

  let env;
  try {
    // $env/dynamic/public は SvelteKit/Vite の仮想モジュール。
    // プレーンなテストランナー（node --test。Viteを介さない）ではモジュール解決自体が失敗するため、
    // importのみをtry/catchでラップ。import失敗時はフォールバック（未設定と同じ扱い）にする。
    const m = await import('$env/dynamic/public');
    env = m.env;
  } catch {
    _client = null;
    return _client;
  }

  const url = env.PUBLIC_SUPABASE_URL;
  const key = env.PUBLIC_SUPABASE_ANON_KEY;
  // env vars が未設定ならフォールバック。設定済みで createClient がエラーなら、
  // 例外をpropagateして caller に知らせる（silent fallback で書き込み先がDB/インメモリに割れるのを防ぐ）。
  _client = url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
  return _client;
}

// 受付登録（N-4）。二重受付（N-5）は overwrite 指定がない限り duplicate を返す。
export async function submitReception(
  tn: string,
  payload: { type: string; desiredDate?: string; timeSlot?: string; dropPlace?: string },
  opts?: { overwrite?: boolean; channel?: 'web' | 'line' | 'sms' | 'phone' | 'ai_phone'; callerPhone?: string }
): Promise<SubmitResult> {
  const c = await client();
  if (!c) {
    // フォールバック：アプリ内ダミー（env未設定時・テスト時。既存挙動と完全一致）
    return storeRegister(tn, payload, opts?.overwrite ?? false);
  }

  const { data, error } = await c.rpc('register_reception', {
    p_tracking_number: tn,
    p_type: payload.type,
    p_desired_date: payload.desiredDate ?? null,
    p_time_slot: payload.timeSlot ?? null,
    p_drop_place: payload.dropPlace ?? null,
    p_channel: opts?.channel ?? 'web',
    p_caller_phone: opts?.callerPhone ?? null,
    p_overwrite: opts?.overwrite ?? false
  });
  if (error || !data) {
    // RPCエラー時はフォールバックしない（書き込み先がDB/インメモリに割れるのを防ぐ）
    return { ok: false };
  }

  const j = data as RpcResult;
  switch (j.result) {
    case 'created':
    case 'overwritten':
    case 'unchanged':
      return { ok: true, receiptNo: j.receipt_no ?? undefined };
    case 'duplicate':
      return {
        ok: false,
        duplicate: true,
        existing:
          j.existing_receipt_no && j.existing_type
            ? { receiptNo: j.existing_receipt_no, type: j.existing_type }
            : undefined
      };
    case 'format_error':
    case 'not_found':
    default:
      return { ok: false };
  }
}

// 受付状態の照会（N-6）。活性な受付が無ければ null
// （live path: RPC側で status='受付済' のみ返す／fallback: 登録の有無）。
// N-6表示（reception/done）は種別に加え希望日・時間帯・置き配場所も表示するため、
// get_reception_public の非PII項目（desired_date/time_slot/drop_place）もあわせて返す
// （caller_phone・memo等のPII/範囲外項目は源流でSELECTしない＝§4のマスキング設計どおり）。
export async function getReception(tn: string): Promise<{
  receiptNo: string;
  type: string;
  desiredDate?: string;
  timeSlot?: string;
  dropPlace?: string;
} | null> {
  const c = await client();
  if (!c) {
    const r = storeExisting(tn);
    return r
      ? { receiptNo: r.receiptNo, type: r.type, desiredDate: r.desiredDate, timeSlot: r.timeSlot, dropPlace: r.dropPlace }
      : null;
  }

  const { data, error } = await c.rpc('get_reception_public', { p_tracking_number: tn });
  if (error || !data) return null;
  const j = data as RpcPublicView;
  if (!j.receipt_no || !j.type) return null;
  return {
    receiptNo: j.receipt_no,
    type: j.type,
    desiredDate: j.desired_date,
    timeSlot: j.time_slot,
    dropPlace: j.drop_place
  };
}
