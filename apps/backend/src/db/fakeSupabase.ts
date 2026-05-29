import { AuthError, createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

type QueryResult<T = unknown> = {
    data: T | null;
    error: null;
    count?: number | null;
};

type BookmarkRow = {
    id: string;
    user_id: string;
    status: string;
    title?: string;
    ai_title?: string | null;
    description?: string | null;
    url?: string;
    chrome_id?: string;
    content_hash?: string;
};

type SharedLinkRow = {
    id: string;
    url: string;
    title?: string | null;
    description?: string | null;
    vector?: number[] | null;
};

type ClusterRow = {
    id: string;
    user_id: string;
    name?: string;
    parent_id?: string | null;
};

type AssignmentRow = {
    cluster_id?: string;
    bookmark_id: string;
    user_id: string;
    clusters?: { user_id: string };
    bookmarks?: {
        title?: string;
        ai_title?: string | null;
        description?: string | null;
        url?: string;
        chrome_id?: string;
    };
};

type SnapshotRow = {
    id: string;
    user_id: string;
    name: string;
    created_at: string;
    snapshot_clusters: Array<{
        id: string;
        snapshot_assignments: Array<{ count: number }>;
    }>;
};

const state = {
    users: new Map<string, { id: string; is_premium: boolean }>([
        ['status-user', { id: 'status-user', is_premium: false }],
        ['premium-user', { id: 'premium-user', is_premium: true }],
    ]),
    sharedLinks: new Map<string, SharedLinkRow>(),
    bookmarks: [
        { id: 'pending-1', user_id: 'status-user', status: 'pending' },
        { id: 'enriched-1', user_id: 'status-user', status: 'enriched' },
        {
            id: 'embedded-1',
            user_id: 'status-user',
            status: 'embedded',
            title: 'Embedded One',
            ai_title: 'AI Embedded One',
            description: 'Fixture bookmark',
            url: 'https://example.com/embedded-one',
            chrome_id: 'chrome-embedded-1',
        },
        { id: 'embedded-2', user_id: 'status-user', status: 'embedded' },
        { id: 'error-1', user_id: 'status-user', status: 'error' },
    ] as BookmarkRow[],
    clusters: [
        { id: 'cluster-1', user_id: 'status-user', name: 'Fixture Cluster', parent_id: null },
    ] as ClusterRow[],
    assignments: [
        {
            cluster_id: 'cluster-1',
            bookmark_id: 'embedded-1',
            user_id: 'status-user',
            clusters: { user_id: 'status-user' },
            bookmarks: {
                title: 'Embedded One',
                ai_title: 'AI Embedded One',
                description: 'Fixture bookmark',
                url: 'https://example.com/embedded-one',
                chrome_id: 'chrome-embedded-1',
            },
        },
    ] as AssignmentRow[],
    snapshots: [
        {
            id: 'snapshot-1',
            user_id: 'status-user',
            name: 'Fixture Snapshot',
            created_at: '2026-05-29T00:00:00.000Z',
            snapshot_clusters: [
                { id: 'snapshot-cluster-1', snapshot_assignments: [{ count: 1 }] },
            ],
        },
    ] as SnapshotRow[],
    controls: new Map<string, {
        user_id: string;
        is_cancelled: boolean;
        job_generation: number;
        updated_at: string;
    }>(),
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

    async single() {
        return this.maybeSingle();
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
            state.snapshots = state.snapshots.filter((row) => !matches(row));
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

        if (this.table === 'shared_links') {
            for (const [id, row] of Array.from(state.sharedLinks.entries())) {
                if (matches(row as unknown as Record<string, unknown>)) {
                    state.sharedLinks.set(id, { ...row, ...this.updateValues });
                }
            }
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

        if (this.table === 'shared_links') {
            return Array.from(state.sharedLinks.values()).filter((row) => this.matches(row));
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

        if (this.table === 'structure_snapshots') {
            return state.snapshots.filter((row) => this.matches(row));
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

class FakeUpsertBuilder {
    private selected = false;

    constructor(private readonly table: string, private readonly row: Record<string, unknown>) {}

    select() {
        this.selected = true;
        return this;
    }

    async single() {
        const result = this.applyUpsert();
        return {
            data: result,
            error: null,
        };
    }

    then<TResult1 = QueryResult, TResult2 = never>(
        onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
    ) {
        const data = this.applyUpsert();
        const result: QueryResult = {
            data: this.selected ? data : null,
            error: null,
        };
        return Promise.resolve(result).then(onfulfilled, onrejected);
    }

    private applyUpsert() {
        if (this.table === 'users' && this.row?.id) {
            const existing = state.users.get(String(this.row.id));
            state.users.set(String(this.row.id), {
                id: String(this.row.id),
                is_premium: existing?.is_premium ?? false,
            });
            return state.users.get(String(this.row.id)) ?? null;
        }

        if (this.table === 'shared_links' && this.row?.id) {
            const id = String(this.row.id);
            const existing = state.sharedLinks.get(id);
            const next = {
                ...existing,
                id,
                url: String(this.row.url ?? existing?.url ?? ''),
                title: this.row.title as string | null | undefined,
                description: this.row.description as string | null | undefined,
                vector: this.row.vector as number[] | null | undefined ?? existing?.vector ?? null,
            };
            state.sharedLinks.set(id, next);
            return next;
        }

        if (this.table === 'bookmarks') {
            const userId = String(this.row.user_id ?? '');
            const chromeId = String(this.row.chrome_id ?? '');
            const existingIndex = state.bookmarks.findIndex((item) =>
                item.user_id === userId && item.chrome_id === chromeId
            );
            const next: BookmarkRow = {
                ...(existingIndex >= 0 ? state.bookmarks[existingIndex] : {}),
                id: existingIndex >= 0 ? state.bookmarks[existingIndex].id : randomUUID(),
                user_id: userId,
                chrome_id: chromeId,
                url: String(this.row.url ?? ''),
                title: String(this.row.title ?? ''),
                content_hash: String(this.row.content_hash ?? ''),
                status: String(this.row.status ?? 'pending'),
                description: this.row.description as string | null | undefined,
            };

            if (existingIndex >= 0) {
                state.bookmarks[existingIndex] = next;
            } else {
                state.bookmarks.push(next);
            }

            return next;
        }

        if (this.table === 'user_pipeline_controls' && this.row?.user_id) {
            state.controls.set(String(this.row.user_id), {
                user_id: String(this.row.user_id),
                is_cancelled: Boolean(this.row.is_cancelled),
                job_generation: Number(this.row.job_generation ?? 0),
                updated_at: String(this.row.updated_at),
            });
            return state.controls.get(String(this.row.user_id)) ?? null;
        }

        return null;
    }
}

function buildFakeSupabase() {
    const client = createClient(
        process.env.SUPABASE_URL ?? 'https://e2e-fake.supabase.co',
        process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'e2e-fake-service-role-key',
        {
            auth: {
                persistSession: false,
                autoRefreshToken: false,
                detectSessionInUrl: false,
            },
        }
    );

    client.auth.getUser = async (jwt?: string) => {
        if (!jwt) {
            return {
                data: { user: null },
                error: new AuthError('Missing token', 401),
            };
        }

        return {
            data: { user: { id: jwt } as User },
            error: null,
        };
    };

    client.from = ((table: string) =>
        ({
            select: (columns?: string, options?: { count?: string; head?: boolean }) =>
                new FakeQueryBuilder(table).select(columns, options),
            delete: () => new FakeQueryBuilder(table).delete(),
            update: (values: Record<string, unknown>) => new FakeQueryBuilder(table).update(values),
            upsert: (row: Record<string, unknown>) => new FakeUpsertBuilder(table, row),
            insert: async () => ({ data: null, error: null }),
        }) as unknown as ReturnType<typeof client.from>) as typeof client.from;

    client.rpc = (async (fn: string, args?: Record<string, unknown>) => {
        if (fn === 'create_structure_snapshot') {
            const userId = String(args?.p_user_id ?? '');
            const snapshotId = `snapshot-${state.snapshots.length + 1}`;
            state.snapshots.unshift({
                id: snapshotId,
                user_id: userId,
                name: String(args?.p_snapshot_name ?? 'Backup'),
                created_at: new Date().toISOString(),
                snapshot_clusters: [],
            });
            return { data: snapshotId, error: null };
        }

        if (fn === 'restore_structure_snapshot') {
            const userId = String(args?.p_user_id ?? '');
            const snapshotId = String(args?.p_snapshot_id ?? '');
            const snapshot = state.snapshots.find((item) => item.id === snapshotId && item.user_id === userId);
            return snapshot
                ? { data: null, error: null }
                : { data: null, error: { message: 'Snapshot not found' } };
        }

        return { data: null, error: null };
    }) as unknown as typeof client.rpc;

    return client;
}

export const fakeSupabase: SupabaseClient = buildFakeSupabase();
