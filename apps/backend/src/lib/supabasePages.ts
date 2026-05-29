export const SUPABASE_PAGE_SIZE = 1000;

export const fetchAllPages = async <T>(
    fetchPage: (from: number, to: number) => any
) => {
    const allRows: T[] = [];
    let from = 0;

    while (true) {
        const to = from + SUPABASE_PAGE_SIZE - 1;
        const { data, error } = await fetchPage(from, to);

        if (error) throw error;

        const rows = data ?? [];
        allRows.push(...rows);

        if (rows.length < SUPABASE_PAGE_SIZE) break;
        from += SUPABASE_PAGE_SIZE;
    }

    return allRows;
};
