// 統一レスポンス（API契約v0：成功 {data}／失敗 {error:{code,message}}）。
import { json } from '@sveltejs/kit';

export function ok(data: unknown, status = 200) {
  return json({ data }, { status });
}

export function fail(code: string, message: string, status: number) {
  return json({ error: { code, message } }, { status });
}

// Authorization: Bearer <token> を取り出す。
export function bearer(request: Request): string | null {
  const h = request.headers.get('authorization') ?? '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : null;
}

export function todayLocal(): string {
  return new Date().toISOString().slice(0, 10);
}
