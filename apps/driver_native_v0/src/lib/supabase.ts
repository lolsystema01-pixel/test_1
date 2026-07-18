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

const supabaseUrl = extra.supabaseUrl && extra.supabaseUrl.trim() ? extra.supabaseUrl.trim() : null;
const supabaseAnonKey =
  extra.supabaseAnonKey && extra.supabaseAnonKey.trim() ? extra.supabaseAnonKey.trim() : null;

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
