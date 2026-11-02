/** Supabase returns at most 1000 rows per request: read every page. The query needs a stable order (end on a unique column). */
export const PAGE_ROWS = 1000;

export async function allRows<T, E = unknown>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: E | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE_ROWS) {
    const { data, error } = await page(from, from + PAGE_ROWS - 1);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < PAGE_ROWS) return out;
  }
}

/** The same, as a { data, error } result for code that checks errors itself. */
export function allRowsResult<T, E = unknown>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: E | null }>,
): Promise<{ data: T[] | null; error: E | null }> {
  return allRows(page).then(
    (data) => ({ data, error: null }),
    (error: unknown) => ({ data: null, error: error as E }),
  );
}
