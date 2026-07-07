// =============================================================
// Supabase(PostgREST)の「1クエリ最大1000行」を超えて全件取得する共通ヘルパ。
//   ・build(from, to) に .range(from,to) 付きのクエリを渡す。1000件ずつページングして集約。
//   ・安定ページングのため、呼び出し側は一意なキー（tracking_number 等）で order すること。
// =============================================================
export async function fetchAllRows<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<{ rows: T[]; error: string | null }> {
  const size = 1000;
  let from = 0;
  const rows: T[] = [];
  for (;;) {
    const { data, error } = await build(from, from + size - 1);
    if (error) return { rows, error: error.message };
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < size) break;
    from += size;
  }
  return { rows, error: null };
}
