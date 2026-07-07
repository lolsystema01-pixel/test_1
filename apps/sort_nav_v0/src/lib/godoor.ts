// =============================================================
// GoDoor Ver4.0 用CSV整形（純関数・DB非依存＝単体テスト可能）。
//   現行GAS 27_godoor_csv_export.js 準拠：21列・ヘッダ行・UTF-8 BOM・CRLF・
//   全フィールドダブルクオート囲み・データ内カンマ/改行はスペース置換・" は "" エスケープ。
//   並び：全体＝担当ドライバー名 昇順 → 配達順 昇順（数値・空は末尾）。
// =============================================================

export type GodoorRow = {
  driver_id: string;
  driver_name: string | null;
  delivery_order: number | null;
  basket_code: string | null;
  tracking_number: string;
  recipient_name: string | null;
  address: string | null;
  time_window: string | null;
};

// 21列ヘッダ（最終列のみ "Ver4.0" マーカー）
export const GODOOR_HEADER = [
  '担当ドライバー', '住所', '部屋番号', 'テナント名', '階層', '伝票番号',
  '届け先名１', '届け先名２', '電話番号', '配達状況', '時間指定', '荷物メモ',
  '梱包', '種類', '色', 'サイズ', '個口数', '代金徴収', '置き配', '宅配BOX', 'Ver4.0'
] as const;

export const GODOOR_MAX_ROWS = 10000;

// 担当ドライバー名（driver_name 優先・無ければ driver_id＝仮ドライバー等）
export function driverLabel(r: Pick<GodoorRow, 'driver_name' | 'driver_id'>): string {
  return (r.driver_name ?? '').trim() || r.driver_id;
}

// 届け先名１＝氏名＋「 様」（末尾が既に様なら付けない／氏名が空なら「様」のみ）
export function recipientName1(recipient_name: string | null): string {
  const n = (recipient_name ?? '').trim();
  if (n === '') return '様';
  if (n.endsWith('様')) return n;
  return `${n} 様`;
}

// 届け先名２＝かご記号＋配達順（区切り無しで連結。例：西-5 と 1 → 西-51）
export function recipientName2(basket_code: string | null, delivery_order: number | null): string {
  const b = (basket_code ?? '').trim();
  const o = delivery_order == null ? '' : String(delivery_order);
  return `${b}${o}`;
}

// 時間指定（空なら「指定なし」）
export function timeWindowOrDefault(time_window: string | null): string {
  const t = (time_window ?? '').trim();
  return t === '' ? '指定なし' : t;
}

// 配達順の数値化（数値はそのまま／空・非数値は末尾）。GASの『N-29』→29 にも対応。
export function deliveryOrderNum(v: number | null): number {
  if (v == null) return Number.POSITIVE_INFINITY;
  if (typeof v === 'number') return Number.isFinite(v) ? v : Number.POSITIVE_INFINITY;
  const m = String(v).match(/(\d+)\s*$/);
  return m ? Number(m[1]) : Number.POSITIVE_INFINITY;
}

// 並び：担当ドライバー名 昇順 → 配達順 昇順（空は末尾）。安定化のため driver_id/伝票で tie-break。
export function sortRows(rows: GodoorRow[]): GodoorRow[] {
  return [...rows].sort((a, b) => {
    const da = driverLabel(a);
    const db = driverLabel(b);
    if (da !== db) return da < db ? -1 : 1;
    const oa = deliveryOrderNum(a.delivery_order);
    const ob = deliveryOrderNum(b.delivery_order);
    if (oa !== ob) return oa - ob;
    return a.tracking_number < b.tracking_number ? -1 : a.tracking_number > b.tracking_number ? 1 : 0;
  });
}

// 1行 → 21要素（生値。クオート前）
export function toGodoorFields(r: GodoorRow): string[] {
  return [
    driverLabel(r),                              // 1 担当ドライバー
    r.address ?? '',                             // 2 住所
    '',                                          // 3 部屋番号
    '',                                          // 4 テナント名
    '',                                          // 5 階層
    r.tracking_number,                           // 6 伝票番号
    recipientName1(r.recipient_name),            // 7 届け先名１
    recipientName2(r.basket_code, r.delivery_order), // 8 届け先名２
    '',                                          // 9 電話番号（deliveriesに電話列なし）
    '配達',                                       // 10 配達状況（固定）
    timeWindowOrDefault(r.time_window),          // 11 時間指定
    '',                                          // 12 荷物メモ
    'ダンボール',                                  // 13 梱包
    '指定なし',                                    // 14 種類
    '茶',                                         // 15 色
    '中',                                         // 16 サイズ
    '1',                                          // 17 個口数
    'なし',                                        // 18 代金徴収
    '不可',                                        // 19 置き配
    '不可',                                        // 20 宅配BOX
    ''                                            // 21 Ver4.0（データ行は空。ヘッダのみ "Ver4.0"）
  ];
}

// フィールドのサニタイズ＋クオート：カンマ(半角/全角)・改行→スペース、" → ""、全体を " で囲む。
export function quoteField(value: string): string {
  const cleaned = value
    .replace(/[\r\n]+/g, ' ')   // 改行 → スペース
    .replace(/[,，]/g, ' ')     // 半角/全角カンマ → スペース
    .replace(/"/g, '""');       // " → ""
  return `"${cleaned}"`;
}

// 行配列 → CSV本文（ヘッダ＋データ・各フィールドquote・CRLF・末尾CRLF）。BOMは付けない（Blob生成時に付与）。
export function buildGodoorCsv(rows: GodoorRow[]): string {
  const sorted = sortRows(rows);
  const lines: string[] = [];
  lines.push(GODOOR_HEADER.map(quoteField).join(','));
  for (const r of sorted) lines.push(toGodoorFields(r).map(quoteField).join(','));
  return lines.join('\r\n') + '\r\n';
}

// ドライバー別にグループ化（担当ドライバー名キー・各内は配達順昇順）。
export function groupByDriver(rows: GodoorRow[]): { label: string; rows: GodoorRow[] }[] {
  const m = new Map<string, GodoorRow[]>();
  for (const r of sortRows(rows)) {
    const k = driverLabel(r);
    (m.get(k) ?? m.set(k, []).get(k)!).push(r);
  }
  return [...m.entries()].map(([label, rs]) => ({ label, rows: rs }));
}
