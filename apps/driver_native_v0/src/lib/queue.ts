import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, AppStateStatus } from 'react-native';
import { supabase } from './supabase';

// 取りこぼし防止キュー：record_delivery_result rpc の呼び出しが失敗したとき、
// AsyncStorage に積んでおいて、次のアプリforeground復帰・次アクション時に再送する。
// 「押した完了/不在が消えない」ことがMVPの命綱。
//
// 42501（権限/他人）・23514（値域）・P0002（不存在）は恒久エラーとして再送しない
// （キューから除去してトースト表示）。それ以外（ネットワーク断・一時エラー等）は再送対象。

const QUEUE_KEY = 'driver_native_v0:pending_delivery_results';
const PERMANENT_ERROR_CODES = new Set(['42501', '23514', 'P0002']);

export type DeliveryResultValue = '完了' | '不在';

export interface PendingResult {
  trackingNumber: string;
  result: DeliveryResultValue;
  lat: number | null;
  lng: number | null;
  at: string; // 記録試行時刻（ISO・診断用）
}

export interface RecordOutcome {
  outcome: 'ok' | 'permanent' | 'queued';
  message?: string;
}

async function readQueue(): Promise<PendingResult[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as PendingResult[]) : [];
  } catch {
    return [];
  }
}

async function writeQueue(items: PendingResult[]): Promise<void> {
  try {
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(items));
  } catch {
    // AsyncStorage書き込み失敗は静かに諦める（次回の操作時に再度積み直される）
  }
}

async function enqueue(item: PendingResult): Promise<void> {
  const items = await readQueue();
  // 同一問合番号の古い保留は最新のもので上書き（二重送信を防ぐ）
  const next = items.filter((i) => i.trackingNumber !== item.trackingNumber);
  next.push(item);
  await writeQueue(next);
}

async function dequeue(trackingNumber: string): Promise<void> {
  const items = await readQueue();
  const next = items.filter((i) => i.trackingNumber !== trackingNumber);
  if (next.length !== items.length) await writeQueue(next);
}

function errorCode(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

async function attemptSend(item: PendingResult): Promise<'ok' | 'permanent' | 'retry'> {
  if (!supabase) return 'retry';
  try {
    const { error } = await supabase.rpc('record_delivery_result', {
      p_tracking_number: item.trackingNumber,
      p_result: item.result,
      p_lat: item.lat,
      p_lng: item.lng,
    });
    if (!error) return 'ok'; // recorded/already いずれも成功扱い
    const code = errorCode(error);
    if (code && PERMANENT_ERROR_CODES.has(code)) return 'permanent';
    return 'retry';
  } catch {
    return 'retry'; // ネットワーク断など
  }
}

// 完了/不在の記録本体：即時送信を試み、失敗（一時エラー）ならキューへ積んで次回に回す。
export async function recordDeliveryResult(
  trackingNumber: string,
  result: DeliveryResultValue,
  lat: number | null,
  lng: number | null
): Promise<RecordOutcome> {
  const item: PendingResult = { trackingNumber, result, lat, lng, at: new Date().toISOString() };
  const status = await attemptSend(item);
  if (status === 'ok') {
    await dequeue(trackingNumber);
    return { outcome: 'ok' };
  }
  if (status === 'permanent') {
    await dequeue(trackingNumber);
    return { outcome: 'permanent', message: '記録できませんでした（権限または入力値エラー）' };
  }
  await enqueue(item);
  return { outcome: 'queued' };
}

// サインアウト前の点検用：未送信の保留件数（セキュリティレビューMED対応・
// 端末再割当時に前ドライバーの保留が次ドライバーのセッションで送られるのを防ぐ）
export async function countPendingResults(): Promise<number> {
  return (await readQueue()).length;
}

// サインアウト時の明示破棄（ユーザーが確認ダイアログで同意した場合のみ呼ぶ）
export async function clearAllPendingResults(): Promise<void> {
  try {
    await AsyncStorage.removeItem(QUEUE_KEY);
  } catch {
    // 削除失敗時は次回サインイン者のflushでサーバ側42501拒否→恒久破棄される（多層防御）
  }
}

// flushQueue の多重起動ガード（foreground復帰の連打・アプリ内複数箇所からの呼び出しが重ならないように）。
// enqueue側の「同一問合番号は上書き」方針はそのまま維持し、ここでは実行の直列化のみ行う。
let flushInFlight = false;

// 保留分の再送。'retry' はキューに残す（次回フラッシュで再試行）。
export async function flushQueue(): Promise<void> {
  if (flushInFlight) return;
  flushInFlight = true;
  try {
    const items = await readQueue();
    for (const item of items) {
      const status = await attemptSend(item);
      if (status === 'ok' || status === 'permanent') {
        await dequeue(item.trackingNumber);
      }
    }
  } finally {
    flushInFlight = false;
  }
}

// アプリforeground復帰時に自動フラッシュ。戻り値のクリーンアップ関数でリスナー解除。
export function startQueueAutoFlush(): () => void {
  void flushQueue();
  const handleChange = (state: AppStateStatus) => {
    if (state === 'active') void flushQueue();
  };
  const sub = AppState.addEventListener('change', handleChange);
  return () => sub.remove();
}
