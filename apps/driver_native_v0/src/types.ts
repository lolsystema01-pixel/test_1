export type StopStatus = '未処理' | '完了' | '不在';

export interface Stop {
  seq: number;
  trackingNumber: string; // 問合番号（12桁・デモは9000帯）
  prefectureWard: string; // 例: 東京都世田谷区
  ward: string; // 例: 世田谷区
  town: string; // 例: 桜新町
  banchi: string; // 例: 2-10-5
  recipient: string; // 例: 田中 一郎（「—」は氏名不明のダミー）
  window: string; // 時間帯 例: 10:30〜12:00
  status: StopStatus;
  lat: number;
  lng: number;
  packageCount: number; // 荷物個数
  basketCode: string; // かご記号（例: A-03）
  memo?: string; // 配達メモ（置き配希望 等・空の場合あり）
}

export type HandoffMethod = '手渡し' | '置き配';

export type TabKey = 'delivery' | 'map' | 'today';

export interface Counts {
  done: number;
  absent: number;
  processed: number;
  total: number;
  remaining: number;
  rate: number; // 0-100
}

export interface ToastState {
  id: number;
  message: string;
}
