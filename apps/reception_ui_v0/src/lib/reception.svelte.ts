// 受付フローの画面間状態（クライアント・sessionStorage 永続）。
//   ・PIIになり得る入力（置き配場所・メモ）も含むため sessionStorage（タブ内・閉じれば消える）。
//   ・token は N-3 で取得した認証トークン。受付登録/状態取得のヘッダに使う。
import { browser } from '$app/environment';

const KEY = 'reception_v0';

export type Flow = {
  trackingNumber: string;
  token: string;
  devCode: string; // ダミーOTPのヒント（検証用）
  receptionType: string;
  desiredDate: string;
  timeSlot: string;
  dropPlace: string;
  memo: string;
  receiptNo: string;
};

function blank(): Flow {
  return {
    trackingNumber: '',
    token: '',
    devCode: '',
    receptionType: '',
    desiredDate: '',
    timeSlot: '',
    dropPlace: '',
    memo: '',
    receiptNo: ''
  };
}

function load(): Flow {
  if (!browser) return blank();
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? { ...blank(), ...JSON.parse(raw) } : blank();
  } catch {
    return blank();
  }
}

export const flow = $state<Flow>(load());

export function save(): void {
  if (!browser) return;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(flow));
  } catch {
    /* 保存失敗は致命ではない */
  }
}

export function reset(): void {
  Object.assign(flow, blank());
  if (browser) sessionStorage.removeItem(KEY);
}
