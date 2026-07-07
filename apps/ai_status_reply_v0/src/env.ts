// 環境変数の解決（サーバ専用）。秘密はここから読むだけ。ログには出さない。
import 'dotenv/config';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`環境変数 ${name} が未設定です（.env を確認）。`);
  return v;
}

export const env = {
  // Claude API キー（サーバ専用・フロント/レスポンス/ログに出さない）
  ANTHROPIC_API_KEY: required('ANTHROPIC_API_KEY'),
  ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL ?? 'claude-opus-4-8',
  // Supabase（anon）。非PII状況は SECURITY DEFINER 関数経由。
  SUPABASE_URL: required('SUPABASE_URL'),
  SUPABASE_ANON_KEY: required('SUPABASE_ANON_KEY'),
  PORT: Number(process.env.PORT ?? 8787)
};
