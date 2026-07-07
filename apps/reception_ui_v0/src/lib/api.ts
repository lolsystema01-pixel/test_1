// クライアント→内製API の薄いラッパ。成功は data、失敗は {code,message,status} を throw。
export class ApiError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function handle(res: Response): Promise<unknown> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* 本文なし */
  }
  if (res.ok) return (body as { data?: unknown })?.data ?? null;
  const err = (body as { error?: { code?: string; message?: string } })?.error;
  throw new ApiError(err?.code ?? 'INTERNAL_ERROR', err?.message ?? '通信に失敗しました。', res.status);
}

export async function apiPost(path: string, body: unknown, token?: string): Promise<unknown> {
  const res = await fetch(path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(body ?? {})
  });
  return handle(res);
}

export async function apiGet(path: string, token?: string): Promise<unknown> {
  const res = await fetch(path, {
    headers: token ? { authorization: `Bearer ${token}` } : {}
  });
  return handle(res);
}
