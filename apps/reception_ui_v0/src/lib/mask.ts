// =============================================================
// N-10：エラー・ログのPIIマスキング。ログに氏名・連絡先・住所・問合番号の全桁を残さない。
//   ・log(): マスキング済みでサーバコンソールへ。例外時もこれを通す。
//   ・maskTracking(): 問合番号は末尾4桁のみ。maskField(): 任意文字列を伏せる。
// =============================================================

export function maskTracking(tn: string | undefined | null): string {
  const s = (tn ?? '').trim();
  if (!s) return '(空)';
  if (s.length <= 4) return '*'.repeat(s.length);
  return '*'.repeat(s.length - 4) + s.slice(-4);
}

// 氏名・住所・置き配場所・メモ等の自由記述：長さだけ残して内容は伏せる。
export function maskField(v: string | undefined | null): string {
  const s = (v ?? '').toString();
  if (!s) return '(空)';
  return `***(${s.length}字)`;
}

// 連絡先（電話/メール）：種別と末尾少しだけ。
export function maskContact(v: string | undefined | null): string {
  const s = (v ?? '').trim();
  if (!s) return '(空)';
  return s.length <= 3 ? '***' : '***' + s.slice(-3);
}

// PIIを含み得るオブジェクトをマスキングしてからログへ。
const PII_KEYS = new Set(['tracking_number', 'trackingNumber', 'name', 'recipient_name', 'address', 'contact', 'phone', 'email', 'dropPlace', 'memo', 'authCode']);

export function maskObject(obj: unknown): unknown {
  if (obj == null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(maskObject);
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(obj as Record<string, unknown>)) {
    if (!PII_KEYS.has(k)) {
      out[k] = typeof val === 'object' ? maskObject(val) : val;
      continue;
    }
    if (k === 'tracking_number' || k === 'trackingNumber') out[k] = maskTracking(String(val));
    else if (k === 'contact' || k === 'phone' || k === 'email') out[k] = maskContact(String(val));
    else if (k === 'authCode') out[k] = '******';
    else out[k] = maskField(String(val));
  }
  return out;
}

// サーバ側ログ（PIIを伏せて出す）。例外時もメッセージのみ＋マスク済みコンテキスト。
export function logMasked(tag: string, context?: unknown): void {
  if (context === undefined) console.log(`[reception] ${tag}`);
  else console.log(`[reception] ${tag}`, JSON.stringify(maskObject(context)));
}
