import { supabase } from '../../db';

const CLUSTER_ASSIGNMENT_BATCH_SIZE = 500;

export interface BookmarkVectorRow {
    id: string;
    shared_links?: unknown;
}

export type FetchBookmarkVectorsResult =
    | { status: 'ok'; rows: BookmarkVectorRow[] }
    | { status: 'error'; error: unknown }
    | { status: 'cancelled' };

export const fetchUserBookmarkVectorRows = async (
    userId: string,
    shouldCancel: () => Promise<boolean>,
    log: (msg: string) => void
): Promise<FetchBookmarkVectorsResult> => {
    let userBookmarks: BookmarkVectorRow[] = [];
    let from = 0;
    const size = 1000;

    while (true) {
        log(`Fetching bookmarks range ${from}-${from + size - 1}...`);
        const { data: chunk, error } = await supabase
            .from('bookmarks')
            .select(
                `
                id,
                shared_links!content_hash (vector)
            `
            )
            .eq('user_id', userId)
            .range(from, from + size - 1);

        if (error) {
            log(`DB Error ${JSON.stringify(error)}`);
            return { status: 'error', error };
        }

        if (!chunk || chunk.length === 0) break;

        userBookmarks = userBookmarks.concat(chunk as BookmarkVectorRow[]);

        if (chunk.length < size) break;
        from += size;

        if (await shouldCancel()) {
            log(`[CLUSTERING] Cancelled during fetch for user ${userId}`);
            return { status: 'cancelled' };
        }
    }

    return { status: 'ok', rows: userBookmarks };
};

export const createCluster = async (
    userId: string,
    parentId: string | null,
    name: string,
    log: (msg: string) => void
): Promise<string | null> => {
    const { data: newCluster, error } = await supabase
        .from('clusters')
        .insert({
            user_id: userId,
            name,
            parent_id: parentId
        })
        .select('id')
        .single();

    if (error || !newCluster?.id) {
        log(`Error creating cluster: ${JSON.stringify(error)}`);
        return null;
    }

    return newCluster.id;
};

export const assignBookmarksToCluster = async (
    bookmarkIds: string[],
    clusterId: string,
    log: (msg: string) => void
) => {
    if (bookmarkIds.length === 0) return;

    for (
        let from = 0;
        from < bookmarkIds.length;
        from += CLUSTER_ASSIGNMENT_BATCH_SIZE
    ) {
        const batchBookmarkIds = bookmarkIds.slice(
            from,
            from + CLUSTER_ASSIGNMENT_BATCH_SIZE
        );
        const assignments = batchBookmarkIds.map((bookmarkId) => ({
            cluster_id: clusterId,
            bookmark_id: bookmarkId
        }));

        const { error } = await supabase
            .from('cluster_assignments')
            .insert(assignments);

        if (error) {
            log(
                `Batch insert error for cluster ${clusterId}, assignments ${from}-${from + batchBookmarkIds.length - 1}: ${JSON.stringify(error)}`
            );
            throw error;
        }
    }
};
