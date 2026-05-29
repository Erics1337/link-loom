type QueryResult<T = unknown> = {
    data: T | null;
    error: null;
    count?: number | null;
};

type BookmarkRow = {
    id: string;
    user_id: string;
    status: string;
};

type ClusterRow = {
    id: string;
    user_id: string;
};

type AssignmentRow = {
    bookmark_id: string;
    user_id: string;
};

const state = {
    users: new Map<string, { id: string; is_premium: boolean }>([
        ['status-user', { id: 'status-user', is_premium: false }],
    ]),
    bookmarks: [
        { id: 'pending-1', user_id: 'status-user', status: 'pending' },
        { id: 'enriched-1', user_id: 'status-user', status: 'enriched' },
        { id: 'embedded-1', user_id: 'status-user', status: 'embedded' },
        { id: 'embedded-2', user_id: 'status-user', status: 'embedded' },
        { id: 'error-1', user_id: 'status-user', status: 'error' },
    ] as BookmarkRow[],
    clusters: [
        { id: 'cluster-1', user_id: 'status-user' },
    ] as ClusterRow[],
    assignments: [
        { bookmark_id: 'embedded-1', user_id: 'status-user' },
    ] as AssignmentRow[],
    controls: new Map<string, { user_id: string; is_cancelled: boolean; updated_at: string }>(),
};

class FakeQueryBuilder {
    private operation: 'select' | 'delete' | 'update' | null = null;
    private filters: Array<{ column: string; value: unknown }> = [];
    private inFilters: Array<{ column: string; values: unknown[] }> = [];
    private selectedColumns = '*';
    private selectOptions: { count?: string; head?: boolean } = {};
    private updateValues: Record<string, unknown> = {};

    constructor(private readonly table: string) {}

    select(columns = '*', options: { count?: string; head?: boolean } = {}) {
        this.operation = 'select';
        this.selectedColumns = columns;
        this.selectOptions = options;
        return this;
    }

    delete() {
        this.operation = 'delete';
        return this;
    }

    update(values: Record<string, unknown>) {
        this.operation = 'update';
        this.updateValues = values;
        return this;
    }

    eq(column: string, value: unknown) {
        this.filters.push({ column, value });
        return this;
    }

    in(column: string, values: unknown[]) {
        this.inFilters.push({ column, values });
        return this;
    }

    order() {
        return this;
    }

    range() {
        return this;
    }

    async maybeSingle() {
        const result = await this.execute();
        const rows = Array.isArray(result.data) ? result.data : [];
        return {
            data: rows[0] ?? null,
            error: null,
        };
    }

    then<TResult1 = QueryResult, TResult2 = never>(
        onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
    ) {
        return this.execute().then(onfulfilled, onrejected);
    }

    private async execute(): Promise<QueryResult> {
        switch (this.operation) {
            case 'delete':
                return this.executeDelete();
            case 'update':
                return this.executeUpdate();
            case 'select':
            default:
                return this.executeSelect();
        }
    }

    private executeSelect(): QueryResult {
        const rows = this.getRows();
        const data = this.selectOptions.head ? null : rows;
        return {
            data,
            error: null,
            count: this.selectOptions.count === 'exact' ? rows.length : null,
        };
    }

    private executeDelete(): QueryResult {
        const matches = (row: Record<string, unknown>) => this.matches(row);

        if (this.table === 'bookmarks') {
            state.bookmarks = state.bookmarks.filter((row) => !matches(row));
        }

        if (this.table === 'clusters') {
            state.clusters = state.clusters.filter((row) => !matches(row));
        }

        if (this.table === 'structure_snapshots') {
            return { data: null, error: null };
        }

        return { data: null, error: null };
    }

    private executeUpdate(): QueryResult {
        const matches = (row: Record<string, unknown>) => this.matches(row);

        if (this.table === 'bookmarks') {
            state.bookmarks = state.bookmarks.map((row) =>
                matches(row) ? { ...row, ...this.updateValues } as BookmarkRow : row
            );
        }

        return { data: null, error: null };
    }

    private getRows() {
        if (this.table === 'users') {
            return Array.from(state.users.values()).filter((row) => this.matches(row));
        }

        if (this.table === 'bookmarks') {
            return state.bookmarks.filter((row) => this.matches(row));
        }

        if (this.table === 'clusters') {
            return state.clusters.filter((row) => this.matches(row));
        }

        if (this.table === 'cluster_assignments') {
            return state.assignments.filter((row) => this.matches(row));
        }

        if (this.table === 'user_pipeline_controls') {
            return Array.from(state.controls.values()).filter((row) => this.matches(row));
        }

        return [];
    }

    private matches(row: Record<string, unknown>) {
        for (const filter of this.filters) {
            const column = filter.column === 'clusters.user_id' ? 'user_id' : filter.column;
            if (row[column] !== filter.value) return false;
        }

        for (const filter of this.inFilters) {
            if (!filter.values.includes(row[filter.column])) return false;
        }

        return true;
    }
}

export const fakeSupabase = {
    auth: {
        getUser: async (token: string) => ({
            data: {
                user: token ? { id: token } : null,
            },
            error: token ? null : { message: 'Missing token' },
        }),
    },
    from: (table: string) => ({
        select: (columns?: string, options?: { count?: string; head?: boolean }) =>
            new FakeQueryBuilder(table).select(columns, options),
        delete: () => new FakeQueryBuilder(table).delete(),
        update: (values: Record<string, unknown>) => new FakeQueryBuilder(table).update(values),
        upsert: async (row: any) => {
            if (table === 'users' && row?.id) {
                const existing = state.users.get(row.id);
                state.users.set(row.id, { id: row.id, is_premium: existing?.is_premium ?? false });
            }

            if (table === 'user_pipeline_controls' && row?.user_id) {
                state.controls.set(row.user_id, row);
            }

            return { data: null, error: null };
        },
        insert: async () => ({ data: null, error: null }),
    }),
    rpc: async () => ({ data: null, error: null }),
};
