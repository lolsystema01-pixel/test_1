// FSM に注入する実サービス束（読み取り＝lookup／認証・登録＝store／OTP送信＝sms）。
//   ＝既存の読み取り(SECURITY DEFINER関数)・N-3認証・N-4登録を流用（本書では作らない）。
import { lookupDelivery } from '../lookup';
import { issueOtp, verifyOtp, registerReception } from '../store';
import { sendOtp } from './sms';
import type { FsmServices } from './fsm';

export const fsmServices: FsmServices = {
  lookup: (tn) => lookupDelivery(tn),
  issueOtp: (tn) => issueOtp(tn),
  verifyOtp: (tn, code) => verifyOtp(tn, code),
  register: (tn, payload, overwrite) => registerReception(tn, payload, overwrite),
  sendOtp: (tn, code, channel) => sendOtp(tn, code, channel),
  today: () => new Date().toISOString().slice(0, 10)
};
