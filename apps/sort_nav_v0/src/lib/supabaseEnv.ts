// 公開環境変数（PUBLIC_*）を1か所で解決する。
// $env/dynamic/public は値を string|undefined で返すため、ここで明示的に文字列化する。
// 未設定なら空文字 → Supabaseクライアント生成時に「URL/キーが必要」で明確に落ちる。
import { env } from '$env/dynamic/public';

export const PUBLIC_SUPABASE_URL: string = env.PUBLIC_SUPABASE_URL ?? '';
export const PUBLIC_SUPABASE_ANON_KEY: string = env.PUBLIC_SUPABASE_ANON_KEY ?? '';
