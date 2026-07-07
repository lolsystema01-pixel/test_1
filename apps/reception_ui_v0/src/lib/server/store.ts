// =============================================================
// ダミーバックエンド（サーバ専用・$lib/server ＝クライアントへ出ない）。
//   本番DB・本番キー・GAS/Sheetsには接続しない（指示書A）。すべてアプリ内のダミー。
//   ・DELIVERIES … 問合番号→荷物（PIIはサーバ内のみ。クライアントへはマスク値しか返さない）
//   ・OTP … 失敗回数/ロック（N-3）
//   ・TOKENS … 認証通過トークン（N-3）
//   ・RECEPTIONS … 受付済み（N-4 登録・N-5 二重受付・N-6 状態）
//   ※ インメモリ（dev再起動で消える）。検証用途として十分。
// =============================================================
import { maskTracking } from '../mask';

export type DummyDelivery = {
  tracking_number: string;
  recipient_name: string; // PII（サーバ内のみ）
  contact: string; // PII
  address: string; // PII
  municipality: string; // 非PII（市レベル）
  status: string; // 6.10：未配車/配車済/仕分済/配送中/完了/不在
};

// ダミー荷物（問合番号は受付仕様どおり半角英数8〜20桁）。不在票から来る想定＝不在中心。
const DELIVERIES: Record<string, DummyDelivery> = {
  '900000000001': { tracking_number: '900000000001', recipient_name: '田中太郎', contact: '090-1111-2222', address: '岡崎市箱柳町12-3', municipality: '岡崎市', status: '不在' },
  '900000000002': { tracking_number: '900000000002', recipient_name: '佐藤花子', contact: 'hanako@example.com', address: '岡崎市小美町4-5', municipality: '岡崎市', status: '不在' },
  '900000000003': { tracking_number: '900000000003', recipient_name: '山田次郎', contact: '080-3333-4444', address: '豊田市西町6-7', municipality: '豊田市', status: '配送中' },
  '900000000009': { tracking_number: '900000000009', recipient_name: '鈴木一郎', contact: '070-5555-6666', address: '東海市加木屋町8-9', municipality: '東海市', status: '完了' }
};

export function findDelivery(tn: string): DummyDelivery | null {
  return DELIVERIES[(tn ?? '').trim()] ?? null;
}

// ---- N-3 OTP（ダミー：正コードは固定）----
export const DUMMY_OTP = '123456';
export const MAX_ATTEMPTS = 5;
type OtpState = { attempts: number; locked: boolean; issuedAt: number };
const OTP = new Map<string, OtpState>();

// OTP発行（荷物の存在チェックは呼び出し側＝lookupDelivery で実施）。SMS/メール送信は範囲外＝devCodeで代替。
export function issueOtp(tn: string): { ok: boolean; devCode?: string } {
  OTP.set(tn, { attempts: 0, locked: false, issuedAt: Date.now() });
  return { ok: true, devCode: DUMMY_OTP };
}

export function verifyOtp(tn: string, code: string): { ok: boolean; token?: string; locked?: boolean; remaining?: number; reason?: string } {
  const st = OTP.get(tn);
  if (!st) return { ok: false, reason: 'expired' }; // OTP未発行/期限切れ
  if (st.locked) return { ok: false, locked: true };
  if ((code ?? '').trim() === DUMMY_OTP) {
    OTP.delete(tn);
    const token = newToken(tn);
    return { ok: true, token };
  }
  st.attempts += 1;
  if (st.attempts >= MAX_ATTEMPTS) st.locked = true;
  OTP.set(tn, st);
  return { ok: false, locked: st.locked, remaining: Math.max(0, MAX_ATTEMPTS - st.attempts) };
}

// ---- 認証トークン（N-3）----
type TokenState = { tracking_number: string; exp: number };
const TOKENS = new Map<string, TokenState>();
const TOKEN_TTL_MS = 30 * 60 * 1000;

function newToken(tn: string): string {
  const token = (globalThis.crypto?.randomUUID?.() ?? `tok_${Date.now()}_${Math.floor(Math.random() * 1e9)}`);
  TOKENS.set(token, { tracking_number: tn, exp: Date.now() + TOKEN_TTL_MS });
  return token;
}

export function trackingFromToken(token: string | undefined | null): string | null {
  if (!token) return null;
  const st = TOKENS.get(token);
  if (!st) return null;
  if (st.exp < Date.now()) {
    TOKENS.delete(token);
    return null;
  }
  return st.tracking_number;
}

// ---- N-4 受付登録 / N-5 二重受付 / N-6 状態 ----
export type Reception = {
  receiptNo: string;
  tracking_number: string;
  type: string; // 再配達/置き配/時間変更
  desiredDate?: string;
  timeSlot?: string;
  dropPlace?: string;
  memo?: string;
  acceptedAt: number;
};
const RECEPTIONS = new Map<string, Reception>(); // key=tracking_number

export function existingReception(tn: string): Reception | null {
  return RECEPTIONS.get(tn) ?? null;
}

export function registerReception(
  tn: string,
  payload: Omit<Reception, 'receiptNo' | 'tracking_number' | 'acceptedAt'>,
  overwrite = false
): { ok: boolean; duplicate?: boolean; receiptNo?: string; existing?: { receiptNo: string; type: string } } {
  const prev = RECEPTIONS.get(tn);
  if (prev && !overwrite) {
    // N-5：二重受付。上書き許可がない限り警告を返す。
    return { ok: false, duplicate: true, existing: { receiptNo: prev.receiptNo, type: prev.type } };
  }
  const receiptNo = genReceiptNo();
  RECEPTIONS.set(tn, { receiptNo, tracking_number: tn, acceptedAt: Date.now(), ...payload });
  return { ok: true, receiptNo };
}

function genReceiptNo(): string {
  const t = Date.now().toString(36).toUpperCase();
  const r = Math.floor(Math.random() * 1296).toString(36).toUpperCase().padStart(2, '0');
  return `R-${t}-${r}`;
}

// N-6：受付後の状態（荷物の市レベル＋受付内容のサマリ。PIIは返さない）。
export function statusByTracking(tn: string): {
  tracking_number_masked: string;
  delivery_status: string | null;
  municipality: string | null;
  reception: Reception | null;
} | null {
  const d = findDelivery(tn);
  if (!d) return null;
  return {
    tracking_number_masked: maskTracking(tn),
    delivery_status: d.status,
    municipality: d.municipality,
    reception: RECEPTIONS.get(tn) ?? null
  };
}

// テスト用：状態を初期化（インメモリ）。
export function __resetForTest(): void {
  OTP.clear();
  TOKENS.clear();
  RECEPTIONS.clear();
}
