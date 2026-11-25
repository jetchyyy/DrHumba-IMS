/**
 * Supabase/PostgREST caps every response at 1000 rows (db max-rows). This fetches all
 * rows by paging: the first page also returns the exact total count, then the remaining
 * pages are requested in parallel.
 *
 * `build` must return a fresh query with `{ count: 'exact' }` on its select/rpc call
 * and a deterministic `.order(...)` (otherwise pages can overlap or skip rows).
 */
const PAGE_SIZE = 1000;

export async function fetchAllRows<T = any>(
  build: () => any,
  pageSize = PAGE_SIZE
): Promise<{ data: T[]; error: any }> {
  const first = await build().range(0, pageSize - 1);
  if (first.error) return { data: [], error: first.error };

  const rows: T[] = first.data || [];
  if (rows.length < pageSize) return { data: rows, error: null };

  const total: number | null = typeof first.count === 'number' ? first.count : null;

  if (total !== null) {
    const offsets: number[] = [];
    for (let from = pageSize; from < total; from += pageSize) offsets.push(from);
    const pages = await Promise.all(offsets.map(from => build().range(from, from + pageSize - 1)));
    for (const page of pages) {
      if (page.error) return { data: [], error: page.error };
      rows.push(...(page.data || []));
    }
    return { data: rows, error: null };
  }

  // No count available: fall back to sequential paging.
  for (let from = pageSize; ; from += pageSize) {
    const page = await build().range(from, from + pageSize - 1);
    if (page.error) return { data: [], error: page.error };
    rows.push(...(page.data || []));
    if (!page.data || page.data.length < pageSize) break;
  }
  return { data: rows, error: null };
}
