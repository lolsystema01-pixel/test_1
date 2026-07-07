// =============================================================
// D章＋N-2：バリデーション仕様（検証ルールの「正」はここ。UIはこれに従って表示するだけ）。
//   7項目：問合番号・認証コード・受付種別・希望日・時間帯・置き配場所・メモ。
//   純関数（DB/UI非依存）＝単体テスト可能。エラーメッセージはD章の例に準拠。
// =============================================================

export type ReceptionType = '再配達' | '置き配' | '時間変更';
export const RECEPTION_TYPES: ReceptionType[] = ['再配達', '置き配', '時間変更'];

// 時間帯の選択肢（N-4/N-6 提供値の代理。ダミー）
export const TIME_SLOTS = ['午前', '14-16', '16-18', '18-20', '19-21'] as const;
export type TimeSlot = (typeof TIME_SLOTS)[number];

// 問合番号：必須・半角英数（指定桁数）。本DBのダミーは英数＋記号(DSP-...)も使うが、
//   受付仕様(D章)は「半角英数・桁数」なので、UI入力は英数字 8〜20 桁を許容する。
export const TRACKING_MIN = 8;
export const TRACKING_MAX = 20;

// メモ上限
export const MEMO_MAX = 200;

export type FormValue = {
  trackingNumber?: string;
  authCode?: string;
  receptionType?: string;
  desiredDate?: string; // YYYY-MM-DD
  timeSlot?: string;
  dropPlace?: string;
  memo?: string;
};

// 各項目の単項目チェック（OKなら null、NGならメッセージ）。
export function vTracking(v: string | undefined): string | null {
  const s = (v ?? '').trim();
  if (!s) return '問合番号を正しく入力してください';
  if (!/^[0-9A-Za-z]+$/.test(s)) return '問合番号を正しく入力してください';
  if (s.length < TRACKING_MIN || s.length > TRACKING_MAX) return '問合番号を正しく入力してください';
  return null;
}

export function vAuthCode(v: string | undefined): string | null {
  const s = (v ?? '').trim();
  if (!s) return '認証コードは6桁の数字です';
  if (!/^[0-9]{6}$/.test(s)) return '認証コードは6桁の数字です';
  return null;
}

export function vReceptionType(v: string | undefined): string | null {
  if (!v) return '受付種別を選んでください';
  if (!RECEPTION_TYPES.includes(v as ReceptionType)) return '受付種別を選んでください';
  return null;
}

// 希望日：必須・今日以降。today は 'YYYY-MM-DD'（呼び出し側がローカル日付を渡す）。
export function vDesiredDate(v: string | undefined, today: string): string | null {
  const s = (v ?? '').trim();
  if (!s) return '受け取り可能な日付を選んでください';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '受け取り可能な日付を選んでください';
  if (s < today) return '受け取り可能な日付を選んでください';
  return null;
}

export function vTimeSlot(v: string | undefined): string | null {
  if (!v) return '時間帯を選んでください';
  if (!TIME_SLOTS.includes(v as TimeSlot)) return '時間帯を選んでください';
  return null;
}

// 置き配場所：置き配選択時のみ必須。
export function vDropPlace(v: string | undefined, type: string | undefined): string | null {
  if (type !== '置き配') return null;
  if (!(v ?? '').trim()) return '置き配場所を入力してください';
  return null;
}

export function vMemo(v: string | undefined): string | null {
  if ((v ?? '').length > MEMO_MAX) return '200文字以内で入力してください';
  return null;
}

// 受付種別による分岐：再配達/時間変更→希望日時、置き配→置き配場所。
export function needsDateTime(type: string | undefined): boolean {
  return type === '再配達' || type === '時間変更';
}
export function needsDropPlace(type: string | undefined): boolean {
  return type === '置き配';
}

// 画面（ステップ）ごとの検証。OKなら {} 、NGなら {field: message}。
export function validateTracking(f: FormValue): Record<string, string> {
  const e: Record<string, string> = {};
  const m = vTracking(f.trackingNumber);
  if (m) e.trackingNumber = m;
  return e;
}
export function validateAuth(f: FormValue): Record<string, string> {
  const e: Record<string, string> = {};
  const m = vAuthCode(f.authCode);
  if (m) e.authCode = m;
  return e;
}
export function validateType(f: FormValue): Record<string, string> {
  const e: Record<string, string> = {};
  const m = vReceptionType(f.receptionType);
  if (m) e.receptionType = m;
  return e;
}
export function validateDateTime(f: FormValue, today: string): Record<string, string> {
  const e: Record<string, string> = {};
  const d = vDesiredDate(f.desiredDate, today);
  if (d) e.desiredDate = d;
  const t = vTimeSlot(f.timeSlot);
  if (t) e.timeSlot = t;
  return e;
}
export function validatePlace(f: FormValue): Record<string, string> {
  const e: Record<string, string> = {};
  const p = vDropPlace(f.dropPlace, f.receptionType);
  if (p) e.dropPlace = p;
  const m = vMemo(f.memo);
  if (m) e.memo = m;
  return e;
}

// 送信時の総合検証（分岐に応じて必要な項目だけ）。
export function validateAll(f: FormValue, today: string): Record<string, string> {
  const e: Record<string, string> = {
    ...validateType(f)
  };
  if (needsDateTime(f.receptionType)) Object.assign(e, validateDateTime(f, today));
  if (needsDropPlace(f.receptionType)) Object.assign(e, validatePlace(f));
  return e;
}

export function isEmpty(e: Record<string, string>): boolean {
  return Object.keys(e).length === 0;
}
