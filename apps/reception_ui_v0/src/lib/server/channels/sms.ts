// N-8 SMS：送信アダプタ（OTP・通知）。検証環境ではスタブ（ログ）。
//   ・プロバイダ（Twilio等）のキーは環境変数。SMS_PROVIDER_* があれば実送信を試みる枠。
//   ・荷受人の電話番号は PII（deliveries）で anon 読み取りでは取得不可 → 検証では devCode をログ表示で代替。
//   ・本番接続なし（検証・ダミー）。
import { env } from '$env/dynamic/private';
import { logMasked } from '../../mask';

function configured(): boolean {
  return !!(env.SMS_PROVIDER_SID && env.SMS_PROVIDER_TOKEN && env.SMS_FROM);
}

// 任意のSMS送信（通知等）。to は PII のためログにはマスクされる。
export async function sendSms(to: string, body: string, kind = 'notice'): Promise<{ sent: boolean; stub: boolean }> {
  if (!configured()) {
    logMasked('sms/stub', { kind, phone: to, len: body.length });
    return { sent: false, stub: true };
  }
  // 実プロバイダ送信の枠（検証環境では到達しない）。実装はプロバイダ仕様に合わせる。
  logMasked('sms/send', { kind, phone: to });
  return { sent: true, stub: false };
}

// OTP送信（チャネル横断で利用）。検証では devCode をログ表示（実SMSはプロバイダ設定時）。
export async function sendOtp(trackingNumber: string, code: string | undefined, channel: string): Promise<void> {
  logMasked('otp/dispatch', { channel, trackingNumber, viaSms: configured() });
  // 実SMSは「電話番号の取得（PII）」が必要＝別途。検証では code は会話側で devCode 表示。
}
