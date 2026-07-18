import { supabase } from './supabase';
import { Stop, StopStatus } from '../types';

// 当日ルート取得（LIVEモード）。
// driver_id は明示フィルタしない＝RLS委譲（deliveries_driver ポリシーが自担当分のみに絞る）。
// 「今日」はJST基準（UTC日付バグを持ち込まない）。

export interface DeliveryRow {
  tracking_number: string;
  address: string | null;
  recipient_name: string | null;
  status: string;
  delivery_order: number | null;
  basket_code: string | null;
  time_window: string | null;
}

// 一覧に出すステータス（保留/未配車/配車済は出さない）
const VISIBLE_STATUSES = new Set(['仕分済', '配送中', '完了', '不在']);

export function jstTodayISO(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' });
}

// 住所を表示用に2行へ分割する簡易ヒューリスティック（完全な分解は不要）。
// 「愛知県岡崎市箱柳町4-1」→ 1行目「愛知県岡崎市箱柳町」／2行目「4-1」
function splitAddress(address: string | null): { line1: string; line2: string } {
  const a = (address ?? '').trim();
  if (!a) return { line1: '', line2: '' };
  const m = a.match(/^(.*?)([0-9０-９].*)$/);
  if (m && m[1]) return { line1: m[1], line2: m[2] };
  return { line1: a, line2: '' };
}

// 表示用の決定的な座標（本番の地図実装＝ゼンリンAPIは8.4・本計画の範囲外）。
// tracking_number から再現性のある分布を作るだけの表示用ダミー（愛知エリア中心）。
const BASE_LAT = 35.0;
const BASE_LNG = 137.17;

function pseudoCoord(seed: string, index: number, total: number): { lat: number; lng: number } {
  const angle = (index / Math.max(total, 1)) * Math.PI * 2;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  const jitter = (hash % 11) / 11 - 0.5;
  const lat = BASE_LAT + Math.sin(angle) * 0.05 + jitter * 0.02;
  const lng = BASE_LNG + Math.cos(angle) * 0.06 + jitter * 0.024;
  return { lat, lng };
}

function toStopStatus(status: string): StopStatus {
  if (status === '完了' || status === '不在') return status;
  return '未処理'; // 仕分済・配送中は未処理扱い
}

export function mapRowsToStops(rows: DeliveryRow[]): Stop[] {
  const visible = rows.filter((r) => VISIBLE_STATUSES.has(r.status));
  return visible.map((row, i) => {
    const { line1, line2 } = splitAddress(row.address);
    const { lat, lng } = pseudoCoord(row.tracking_number, i, visible.length);
    const recipient = row.recipient_name && row.recipient_name.trim() ? row.recipient_name.trim() : '—';
    return {
      seq: i + 1,
      trackingNumber: row.tracking_number,
      prefectureWard: line1,
      ward: line1,
      town: line2,
      banchi: '',
      recipient,
      window: row.time_window && row.time_window.trim() ? row.time_window : '指定なし',
      status: toStopStatus(row.status),
      lat,
      lng,
      packageCount: 1, // DBに個数列なし（8.11最小スライスの範囲外）。表示上の既定値
      basketCode: row.basket_code ?? '—',
      memo: undefined, // DBにメモ列なし（範囲外）
    };
  });
}

export async function fetchTodayRoute(): Promise<Stop[]> {
  if (!supabase) return [];
  const today = jstTodayISO();
  const { data, error } = await supabase
    .from('deliveries')
    .select('tracking_number, address, recipient_name, status, delivery_order, basket_code, time_window')
    .eq('delivery_date', today)
    .order('delivery_order', { ascending: true, nullsFirst: false });
  if (error) throw error;
  return mapRowsToStops((data ?? []) as DeliveryRow[]);
}
