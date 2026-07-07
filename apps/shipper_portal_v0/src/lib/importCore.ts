// =============================================================
// 取込の前処理（純関数・DB非依存＝単体テスト可能）。
//  ・CSV取込 v0.2（import_v0）準拠：問合番号で重複排除・status=未配車・取込バッチID。
//  ・実際の書込みは DB の SECURITY DEFINER 関数 shipper_import_deliveries が行い、
//    shipper_id は関数内で my_shipper() に固定する＝ここでは shipper_id を扱わない
//    （CSVの荷主列は信用しない／service_role も書込みRLSも使わない）。
//  ・未一致行（問合番号/住所が無い）はエラー行として弾く（取りこぼしを件数で可視化）。
// =============================================================

export type CanonicalRow = {
  tracking_number?: string;
  recipient_name?: string;
  address?: string;
  request_date?: string;
  note?: string;
};

// 関数(RPC)へ渡す行。shipper_id / status / batch は DB 側（関数）が付与する。
export type ImportRow = {
  tracking_number: string;
  delivery_date: string | null;
  address: string;
  recipient_name: string | null;
};

export type PreImportCounts = {
  csv_rows: number;
  valid_rows: number;
  unique_in_csv: number;
  csv_internal_dup_excluded: number;
};

export type ImportError = { row_index: number; tracking_number: string | null; reason: string };

export type PreImportResult = {
  rows: ImportRow[];
  counts: PreImportCounts;
  errors: ImportError[];
};

// 依頼日（生文字列）→ ISO日付。'2026年6月8日（月）' / '2026-06-08' に対応。それ以外/空は null。
export function parseRequestDate(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const s = raw.trim();
  const jp = s.match(/^(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/);
  if (jp) {
    const [, y, m, d] = jp;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    const [, y, m, d] = iso;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return null;
}

// CSV正準行 → 検証・CSV内重複排除して RPC へ渡す行を組み立てる。
//   既存(DB)との重複排除は関数側の ON CONFLICT に委ねる（inserted は RPC の戻りで判る）。
export function preprocessImport(rows: CanonicalRow[]): PreImportResult {
  const errors: ImportError[] = [];
  const valid: { tn: string; row: CanonicalRow }[] = [];

  rows.forEach((row, i) => {
    const tn = (row.tracking_number ?? '').trim();
    const address = (row.address ?? '').trim();
    if (!tn) {
      errors.push({ row_index: i, tracking_number: null, reason: '問合番号が空です' });
      return;
    }
    if (!address) {
      errors.push({ row_index: i, tracking_number: tn, reason: '配送先住所が空です' });
      return;
    }
    valid.push({ tn, row });
  });

  // CSV内の重複排除（問合番号で最初の行を採用）
  const seen = new Set<string>();
  const unique: { tn: string; row: CanonicalRow }[] = [];
  for (const v of valid) {
    if (seen.has(v.tn)) continue;
    seen.add(v.tn);
    unique.push(v);
  }

  const out: ImportRow[] = unique.map((v) => ({
    tracking_number: v.tn,
    delivery_date: parseRequestDate(v.row.request_date),
    address: (v.row.address ?? '').trim(),
    recipient_name: (v.row.recipient_name ?? '').trim() || null
  }));

  const counts: PreImportCounts = {
    csv_rows: rows.length,
    valid_rows: valid.length,
    unique_in_csv: unique.length,
    csv_internal_dup_excluded: valid.length - unique.length
  };

  return { rows: out, counts, errors };
}
