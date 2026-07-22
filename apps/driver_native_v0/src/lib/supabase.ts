import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';

// Supabase配線（検証環境）。anonキーのみ使用（service_roleキーは絶対に使わない）。
// 行の可視範囲はRLSに委譲する＝ここではクエリに driver_id 等の絞り込みを書かない。
//
// env未設定（.envを設定していないローカル/デモ端末）のときは LIVE を有効化せず、
// アプリ全体がモックモード（従来のプロトタイプ動作）にフォールバックする。
// これにより「デモが壊れない」を保証する。

interface SupabaseExtra {
  supabaseUrl?: string | null;
  supabaseAnonKey?: string | null;
}

const extra = (Constants.expoConfig?.extra ?? {}) as SupabaseExtra;

// 設定注入の境界＝信用できない。string以外（null/undefined/数値/オブジェクト等）が来ても
// 決して .trim() で落とさず、静かに null＝DEMOモードへ落とす（「デモが壊れない」原則）。
const readConfigString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const supabaseUrl = readConfigString(extra.supabaseUrl);
const supabaseAnonKey = readConfigString(extra.supabaseAnonKey);

export const isLiveMode = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase: SupabaseClient | null = isLiveMode
  ? createClient(supabaseUrl as string, supabaseAnonKey as string, {
      auth: {
        storage: AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    })
  : null;
