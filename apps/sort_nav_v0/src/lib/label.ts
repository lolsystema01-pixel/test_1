// =============================================================
// ラベル印刷ブリッジ v0.4 — ラベル内容の組み立て（純関数・DB/PDF非依存＝単体テスト可能）。
//   ★ラベル内容は確定（数字のみ）：大＝かご記号＋配達順 / 小＝問合番号。住所・氏名は載せない。
//   ・バーコードは既定OFF（枠のみ）。配送伝票に問合番号バーコードがあるため通常は刷らない。
//   ・機種非依存ペイロード＝かご記号・配達順・問合番号 のみ（b-PAC/Brother の具体は外注ブリッジ側）。
// =============================================================

// label_payload ビューの1行（機種非依存ペイロード）。氏名・住所は含まない。
export type LabelPayload = {
  office_code: string | null;
  delivery_date: string | null;
  driver_id: string | null;
  tracking_number: string;
  basket_code: string | null;
  delivery_order: number | null;
};

export const LABEL_HEIGHT_MM = 30; // 高さ約30mm（サンプル見本準拠）

// 大ラベル（かご記号＋配達順）／小ラベル（問合番号）。
export function toLabelText(p: LabelPayload): { large: string; small: string } {
  const basket = (p.basket_code ?? '').trim();
  const order = p.delivery_order == null ? '' : String(p.delivery_order);
  const large = `${basket} ${order}`.trim(); // 例「西-5 1」（本DBでは「A 1」「M01 2」等）
  return { large, small: p.tracking_number };
}

// バーコードに載せる値（既定OFF。ON時のみ枠内に問合番号を描く。シンボロジーは外注/将来確定）。
export function barcodeValue(p: LabelPayload): string {
  return p.tracking_number;
}

// record_prints(jsonb) に渡す履歴項目を組み立てる。
export type PrintKind = 'print' | 'reprint' | 'pdf';
export function toPrintItems(
  payloads: LabelPayload[],
  kind: PrintKind,
  terminalId: string | null
): Record<string, unknown>[] {
  return payloads.map((p) => ({
    tracking_number: p.tracking_number,
    basket_code: p.basket_code,
    delivery_order: p.delivery_order,
    office_code: p.office_code,
    kind,
    terminal_id: terminalId ?? null
  }));
}
