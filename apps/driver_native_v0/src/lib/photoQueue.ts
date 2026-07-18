import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, AppStateStatus } from 'react-native';
// legacy API（readAsStringAsync）を使用。expo-file-system v19(SDK54)は新API(File/Directory)が
// メインエントリになったため、旧来の文字列読み取り関数は '/legacy' サブパスに移動している。
import * as FileSystem from 'expo-file-system/legacy';
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

// base64文字→6bit値のルックアップ（atob非依存の自前デコード用）
const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_LOOKUP: Record<string, number> = {};
for (let i = 0; i < BASE64_CHARS.length; i++) BASE64_LOOKUP[BASE64_CHARS[i]] = i;

// base64文字列 → Uint8Array。React NativeのHermesにatobが無い環境があるため、
// グローバルのatob/Bufferに頼らず手書きでデコードする（依存追加もしない）。
function base64ToUint8Array(base64: string): Uint8Array {
  const clean = base64.replace(/[\r\n]/g, '');
  const len = clean.length;
  if (len === 0 || len % 4 !== 0) return new Uint8Array(0);
  let padding = 0;
  if (clean.endsWith('==')) padding = 2;
  else if (clean.endsWith('=')) padding = 1;
  const outLen = (len / 4) * 3 - padding;
  const bytes = new Uint8Array(outLen);
  let p = 0;
  for (let i = 0; i < len; i += 4) {
    const c0 = clean[i];
    const c1 = clean[i + 1];
    const c2 = clean[i + 2];
    const c3 = clean[i + 3];
    const e1 = BASE64_LOOKUP[c0] ?? 0;
    const e2 = BASE64_LOOKUP[c1] ?? 0;
    const e3 = c2 === '=' ? 0 : BASE64_LOOKUP[c2] ?? 0;
    const e4 = c3 === '=' ? 0 : BASE64_LOOKUP[c3] ?? 0;
    const triple = (e1 << 18) | (e2 << 12) | (e3 << 6) | e4;
    if (p < outLen) bytes[p++] = (triple >> 16) & 0xff;
    if (p < outLen) bytes[p++] = (triple >> 8) & 0xff;
    if (p < outLen) bytes[p++] = triple & 0xff;
  }
  return bytes;
}

// ローカルファイルURIの拡張子からMIMEタイプを決める。delivery-photosバケットの
// allowed_mime_types（image/jpeg・image/jpg・image/png）に合わせ、不明な拡張子は
// launchCameraAsync の既定であるJPEGとして扱う。
function contentTypeFromUri(uri: string): string {
  const match = /\.([a-zA-Z0-9]+)(?:\?.*)?$/.exec(uri);
  const ext = match ? match[1].toLowerCase() : '';
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  return 'image/jpeg'; // 既定（quality指定のlaunchCameraAsyncは通常jpg）
}

// Storageアップロードの恒久エラー判定：サイズ超過・MIME拒否・権限エラー等は
// 再送しても直らないため恒久扱いにしてキューから除去する。@supabase/storage-jsの
// StorageApiError は status(number)・statusCode(string) の両方を持ち得るためどちらも見る。
const PERMANENT_STORAGE_STATUS = new Set([400, 403, 413, 415]);
const PERMANENT_STORAGE_MESSAGE_PATTERN =
  /size|too large|payload|mime type|not allowed|invalid|permission|forbidden/i;

function isPermanentStorageError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { status?: unknown; statusCode?: unknown; message?: unknown };
  if (typeof e.status === 'number' && PERMANENT_STORAGE_STATUS.has(e.status)) return true;
  if (typeof e.statusCode === 'string') {
    const n = Number(e.statusCode);
    if (Number.isFinite(n) && PERMANENT_STORAGE_STATUS.has(n)) return true;
  }
  if (typeof e.message === 'string' && PERMANENT_STORAGE_MESSAGE_PATTERN.test(e.message)) return true;
  return false;
}

// RNの fetch(localUri).blob() は既知の不具合として0バイトのBlobを生成することがある
// （特にAndroidのfile://URIで顕著）。これを避けるため expo-file-system で直接
// base64文字列としてファイル本体を読み、自前デコードでArrayBuffer化してからアップロードする。
async function uploadPhoto(item: PendingPhoto): Promise<'ok' | 'permanent' | 'retry'> {
  if (!supabase) return 'retry';
  try {
    const base64 = await FileSystem.readAsStringAsync(item.localUri, { encoding: 'base64' });
    const bytes = base64ToUint8Array(base64);
    if (bytes.length === 0) return 'retry'; // 読み取り自体が空＝一時的な失敗として再送
    const { error } = await supabase.storage.from(BUCKET).upload(item.path, bytes, {
      contentType: contentTypeFromUri(item.localUri),
      upsert: false, // あえて上書きしない（証跡の後日差し替え防止。README参照）
    });
    if (!error) return 'ok';
    if (isAlreadyExistsError(error)) return 'ok'; // 前回試行が実は成功していたとみなす
    if (isPermanentStorageError(error)) return 'permanent'; // サイズ超過・MIME拒否・権限エラー等は再送しても直らない
    return 'retry'; // ネットワーク断・一時的なサーバエラー等
  } catch {
    return 'retry'; // ファイル読み取り失敗（ローカルURI消失等）も含め一時扱いで再送
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
