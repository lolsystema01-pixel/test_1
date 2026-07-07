// 横断：簡易レート制限（インメモリ・固定ウィンドウ）。チャネル受け口の濫用抑止。
//   キー例：`line:<userId>` `sms:<phone>` `phone:<op>`。$env非依存＝テスト可能。
type Bucket = { count: number; reset: number };
const buckets = new Map<string, Bucket>();

export function rateLimit(
  key: string,
  limit = 20,
  windowMs = 60_000,
  now: number = Date.now()
): { ok: boolean; remaining: number; retryAfterMs: number } {
  const b = buckets.get(key);
  if (!b || b.reset <= now) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    return { ok: true, remaining: limit - 1, retryAfterMs: 0 };
  }
  if (b.count >= limit) {
    return { ok: false, remaining: 0, retryAfterMs: b.reset - now };
  }
  b.count += 1;
  return { ok: true, remaining: limit - b.count, retryAfterMs: 0 };
}

export function __resetRateLimit(): void {
  buckets.clear();
}
