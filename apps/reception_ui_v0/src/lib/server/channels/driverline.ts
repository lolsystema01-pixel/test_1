// ドライバー向けLINE QR返信：番号パーサ・返信組み立て（純関数・$env非依存＝テスト可能）。
//   入力＝問合番号のKAZより後ろの数字（KAZは打たせない・打たれても許容）。
//   正準値＝「KAZ＋数字」。QRの中身＝伝票の送り状番号と同値（実伝票QRデコードで裏取り済み）。
//   受理桁数は可変（既定10〜14桁）。実データで確定後に絞る（引数で変更可）。

export const MIN_DIGITS = 10;
export const MAX_DIGITS = 14;

// 全角英数→半角、空白（半角/全角）・ハイフン類（‐‑‒–—―ー ｰ −等）を除去
export function normalizeDriverInput(raw: string): string {
  let s = (raw ?? '').trim();
  s = s.replace(/[Ａ-Ｚａ-ｚ０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
  s = s.replace(/[\s　]/g, '');
  s = s.replace(/[-‐‑‒–—―ーｰ−]/g, '');
  return s;
}

// 数字（min〜max桁）なら正準値「KAZ＋数字」を返す。範囲外・非数字は null（＝対象外）。
export function parseDriverNumber(raw: string, min: number = MIN_DIGITS, max: number = MAX_DIGITS): string | null {
  let s = normalizeDriverInput(raw);
  s = s.replace(/^kaz/i, ''); // KAZ付き入力も許容（除去して補完し直す）
  if (!/^[0-9]+$/.test(s)) return null;
  if (s.length < min || s.length > max) return null;
  return `KAZ${s}`;
}

export function buildQrUrl(baseUrl: string, canonical: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/qr/${canonical}.png`;
}

export const GUIDE_MESSAGE =
  '伝票のKAZより後ろの数字を送ってください（KAZの入力は不要・数字10〜14桁）。例：90000000001';

export type LineReplyMessage =
  | { type: 'text'; text: string }
  | { type: 'image'; originalContentUrl: string; previewImageUrl: string };

// テキスト1通 → 返信メッセージ列。受理＝QR画像＋案内文、対象外＝ガイド文のみ。
export function buildDriverReply(
  rawText: string,
  baseUrl: string
): { messages: LineReplyMessage[]; canonical: string | null } {
  const canonical = parseDriverNumber(rawText);
  if (!canonical) return { canonical: null, messages: [{ type: 'text', text: GUIDE_MESSAGE }] };
  const url = buildQrUrl(baseUrl, canonical);
  return {
    canonical,
    messages: [
      { type: 'image', originalContentUrl: url, previewImageUrl: url },
      { type: 'text', text: `「${canonical}」のQRコードです。画面を明るくしてスキャナにかざしてください。` }
    ]
  };
}
