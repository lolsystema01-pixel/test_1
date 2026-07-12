// FSM に注入する実サービス束（読み取り＝lookup／認証＝store／登録＝ファサード／OTP送信＝sms）。
//   ＝既存の読み取り(SECURITY DEFINER関数)・N-3認証を流用（本書では作らない）。
//   登録（N-4）は reception.ts ファサード経由（live=RPC／fallback=store。既存挙動と完全一致）。
import { lookupDelivery } from '../lookup';
import { issueOtp, verifyOtp } from '../store';
import { submitReception } from '../reception';
import { sendOtp } from './sms';
import type { FsmServices } from './fsm';

export const fsmServices: FsmServices = {
  lookup: (tn) => lookupDelivery(tn),
  issueOtp: (tn) => issueOtp(tn),
  verifyOtp: (tn, code) => verifyOtp(tn, code),
  // channel は呼び出し元（webhook/line・webhook/sms）が newSession('line'|'sms') で設定したものが
  // session.channel 経由でここに渡る。想定外値は 'line' 扱い（register_reception 側もCHECK制約で弾く）。
  register: (tn, payload, overwrite, channel) =>
    submitReception(tn, payload, { overwrite, channel: channel === 'sms' ? 'sms' : 'line' }),
  sendOtp: (tn, code, channel) => sendOtp(tn, code, channel),
  today: () => new Date().toISOString().slice(0, 10)
};
