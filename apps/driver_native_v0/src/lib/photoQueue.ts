import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, AppStateStatus } from 'react-native';
import { supabase } from './supabase';

// 置き配写真(POD)の取りこぼし防止キュー。queue.ts（完了/不在の記録）と対になる存在だが、
// 完了記録とは独立して動く：①Storageへのアップロード → ②attach_delivery_photo rpc で
// delivery_results.photo_path に紐付け、の2段階のいずれで失敗しても AsyncStorage に積んで
// 次回のforeground復帰・次アクション時に再送する。
//
// 「完了/不在」の記録自体は写真の成否に関わらず成立させる（設計書§10.5・撮影は必須にしない）。
// 置き配写真が無い場合はこのキューに何も積まれない（呼び出し側で分岐）。
//
// エラーコードの扱いは queue.ts と非対称にしている点に注意：
//   attach_delivery_photo の P0002（対象 delivery_results 行が無い）は、
//   「まだ record_delivery_result の送信が完了(queued)のまま」というレースの可能性が高いため
//   恒久エラーにせず再送対象にする（completion側のキューが先に片付けば次回attachが通る）。
//   42501（他人/パス偽装）・23514（値域）・P0001（既に別の写真がある）のみ恒久エラー。

const QUEUE_KEY = 'driver_native_v0:pending_delivery_photos';
const PERMANENT_RPC_ERROR_CODES = new Set(['42501', '23514', 'P0001']);
const BUCKET = 'delivery-photos';

export interface PendingPhoto {
  trackingNumber: string;
  driverId: string;
  localUri: string; // launchCameraAsync が返すローカルファイルURI
  path: string; // `${driverId}/${trackingNumber}.jpg`（Storageの保存先）
  uploaded: boolean; // Storageアップロードまで完了済みか（attach待ちのみ残る状態を区別）
  at: string; // 記録試行時刻（ISO・診断用）
}

export interface PhotoOutcome {
  outcome: 'ok' | 'permanent' | 'queued';
  message?: string;
}

async function readQueue(): Promise<PendingPhoto[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as PendingPhoto[]) : [];
  } catch {
    return [];
  }
}

async function writeQueue(items: PendingPhoto[]): Promise<void> {
  try {
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(items));
  } catch {
    // AsyncStorage書き込み失敗は静かに諦める（次回の操作時に再度積み直される）
  }
}

async function enqueue(item: PendingPhoto): Promise<void> {
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

function rpcErrorCode(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

// upsert:false でのアップロードが「既に存在する」で失敗した場合＝前回試行が実際には
// 成功していた可能性が高い（レスポンスが届く前に通信が切れた等）ので、成功扱いにして
// 次段（attach）へ進む。Supabase Storageは重複時 statusCode文字列 '409' もしくは
// メッセージに "already exists" を含めて返す（実装のバージョン差を両対応で吸収）。
function isAlreadyExistsError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { statusCode?: unknown; message?: unknown; status?: unknown };
  if (typeof e.statusCode === 'string' && e.statusCode === '409') return true;
  if (typeof e.status === 'number' && e.status === 409) return true;
  if (typeof e.message === 'string' && e.message.toLowerCase().includes('already exists')) return true;
  return false;
}

async function uploadPhoto(item: PendingPhoto): Promise<'ok' | 'permanent' | 'retry'> {
  if (!supabase) return 'retry';
  try {
    const res = await fetch(item.localUri);
    const blob = await res.blob();
    const { error } = await supabase.storage.from(BUCKET).upload(item.path, blob, {
      contentType: 'image/jpeg',
      upsert: false, // あえて上書きしない（証跡の後日差し替え防止。README参照）
    });
    if (!error) return 'ok';
    if (isAlreadyExistsError(error)) return 'ok'; // 前回試行が実は成功していたとみなす
    return 'retry'; // ネットワーク断・一時的なサーバエラー等
  } catch {
    return 'retry';
  }
}

async function attachPhoto(item: PendingPhoto): Promise<'ok' | 'permanent' | 'retry'> {
  if (!supabase) return 'retry';
  try {
    const { error } = await supabase.rpc('attach_delivery_photo', {
      p_tracking_number: item.trackingNumber,
      p_photo_path: item.path,
    });
    if (!error) return 'ok'; // recorded/already いずれも成功扱い
    const code = rpcErrorCode(error);
    if (code && PERMANENT_RPC_ERROR_CODES.has(code)) return 'permanent';
    return 'retry'; // P0002（未存在＝completion側の反映待ちの可能性）含め再送対象
  } catch {
    return 'retry';
  }
}

async function attemptSend(item: PendingPhoto): Promise<{ status: 'ok' | 'permanent' | 'retry'; uploaded: boolean }> {
  let uploaded = item.uploaded;
  if (!uploaded) {
    const uploadStatus = await uploadPhoto(item);
    if (uploadStatus !== 'ok') return { status: uploadStatus, uploaded: false };
    uploaded = true;
  }
  const attachStatus = await attachPhoto(item);
  return { status: attachStatus, uploaded };
}

// 置き配写真の記録本体：即時送信を試み、失敗（一時エラー）ならキューへ積んで次回に回す。
export async function submitDeliveryPhoto(
  trackingNumber: string,
  driverId: string,
  localUri: string
): Promise<PhotoOutcome> {
  const item: PendingPhoto = {
    trackingNumber,
    driverId,
    localUri,
    path: `${driverId}/${trackingNumber}.jpg`,
    uploaded: false,
    at: new Date().toISOString(),
  };
  const { status, uploaded } = await attemptSend(item);
  if (status === 'ok') {
    await dequeue(trackingNumber);
    return { outcome: 'ok' };
  }
  if (status === 'permanent') {
    await dequeue(trackingNumber);
    return { outcome: 'permanent', message: '写真を記録できませんでした' };
  }
  await enqueue({ ...item, uploaded });
  return { outcome: 'queued' };
}

let flushInFlight = false;

// 保留分の再送。アップロードのみ完了しattachだけ残っている場合はその状態をキューに保存し直す
// （次回はアップロードからやり直さない）。
export async function flushPhotoQueue(): Promise<void> {
  if (flushInFlight) return;
  flushInFlight = true;
  try {
    const items = await readQueue();
    for (const item of items) {
      const { status, uploaded } = await attemptSend(item);
      if (status === 'ok' || status === 'permanent') {
        await dequeue(item.trackingNumber);
      } else if (uploaded !== item.uploaded) {
        await enqueue({ ...item, uploaded });
      }
    }
  } finally {
    flushInFlight = false;
  }
}

// アプリforeground復帰時に自動フラッシュ。戻り値のクリーンアップ関数でリスナー解除。
export function startPhotoQueueAutoFlush(): () => void {
  void flushPhotoQueue();
  const handleChange = (state: AppStateStatus) => {
    if (state === 'active') void flushPhotoQueue();
  };
  const sub = AppState.addEventListener('change', handleChange);
  return () => sub.remove();
}
