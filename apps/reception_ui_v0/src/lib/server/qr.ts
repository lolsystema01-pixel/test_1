// QR画像のオンザフライ生成（qrcodeラッパ・DB非接触）。
//   ルートパラメータは「KAZ+数字(10〜14桁).png」の正準形式のみ受理（それ以外は400）。
//   誤り訂正M・余白margin4・scale8＝スマホ画面をスキャナで読ませる前提の視認性。
import QRCode from 'qrcode';

const QR_PARAM_RE = /^(KAZ[0-9]{10,14})\.png$/;

export function parseQrParam(param: string): string | null {
  const m = QR_PARAM_RE.exec(param ?? '');
  return m ? m[1] : null;
}

export async function generateQrPng(text: string): Promise<Buffer> {
  return QRCode.toBuffer(text, {
    type: 'png',
    errorCorrectionLevel: 'M',
    margin: 4,
    scale: 8
  });
}
