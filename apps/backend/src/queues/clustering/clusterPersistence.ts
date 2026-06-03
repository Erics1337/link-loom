import { supabase } from '../../db';

export interface BookmarkVectorRow {
    id: string;
    shared_links?: unknown;
}

export const fetchUserBookmarkVectorRows = async (
    userId: string,
    shouldCancel: () => Promise<boolean>,
    log: (msg: string) => void
): Promise<BookmarkVectorRow[] | null> => {
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
            return null;
        }

        if (!chunk || chunk.length === 0) break;

        userBookmarks = userBookmarks.concat(chunk as BookmarkVectorRow[]);

        if (chunk.length < size) break;
        from += size;

        if (await shouldCancel()) {
            log(`[CLUSTERING] Cancelled during fetch for user ${userId}`);
            return null;
        }
    }

    return userBookmarks;
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

    const assignments = bookmarkIds.map((bookmarkId) => ({
        cluster_id: clusterId,
        bookmark_id: bookmarkId
    }));

    const { error } = await supabase
        .from('cluster_assignments')
        .insert(assignments);

    if (error) {
        log(`Batch insert error: ${JSON.stringify(error)}`);
    }
};
