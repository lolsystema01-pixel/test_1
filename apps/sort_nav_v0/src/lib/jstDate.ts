// =============================================================
// 日付ヘルパ（JST固定）
//  ・サーバ(Cloud Run=UTC)とブラウザ(任意TZ)で「今日」がズレると、
//    既定日が前日になったり、前日/今日/翌日クイックが二重点灯する。
//  ・業務日は日本時間(Asia/Tokyo)基準なので、実行環境のTZに依らずJSTで解決する。
// =============================================================

/** 実行環境のTZに依らず「JSTの今日」を YYYY-MM-DD で返す */
export const todayJst = (now: Date = new Date()): string =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(now);

/** YYYY-MM-DD に日数を加減（TZ非依存のカレンダー演算） */
export const shiftDate = (base: string, days: number): string => {
  const d = new Date(base + 'T00:00:00Z'); // UTC正午ではなく0時。以降もUTCで加減するのでズレない
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
