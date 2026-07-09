import { supabase } from "../../db";

const CLUSTER_ASSIGNMENT_BATCH_SIZE = 500;
/** Hard cap on bookmarks loaded into memory during clustering fetch. */
export const MAX_BOOKMARKS = 50_000;

export interface BookmarkVectorRow {
  id: string;
  shared_links?: unknown;
}

export type FetchBookmarkVectorsResult =
  | { status: "ok"; rows: BookmarkVectorRow[] }
  | { status: "error"; error: unknown }
  | { status: "cancelled" };

export const fetchUserBookmarkVectorRows = async (
  userId: string,
  shouldCancel: () => Promise<boolean>,
  log: (msg: string) => void,
): Promise<FetchBookmarkVectorsResult> => {
  let userBookmarks: BookmarkVectorRow[] = [];
  let from = 0;
  const size = 1000;

  while (true) {
    log(`Fetching bookmarks range ${from}-${from + size - 1}...`);
    const { data: chunk, error } = await supabase
      .from("bookmarks")
      .select(
        `
                id,
                shared_links!content_hash (vector)
            `,
      )
      .eq("user_id", userId)
      .order("id", { ascending: true })
      .range(from, from + size - 1);

    if (error) {
      log(`DB Error ${JSON.stringify(error)}`);
      return { status: "error", error };
    }

    if (!chunk || chunk.length === 0) break;

    userBookmarks = userBookmarks.concat(chunk as BookmarkVectorRow[]);

    if (userBookmarks.length > MAX_BOOKMARKS) {
      const error = new Error(
        `too many bookmarks (${userBookmarks.length} exceeds limit of ${MAX_BOOKMARKS})`,
      );
      log(`[CLUSTERING] ${error.message} for user ${userId}`);
      return { status: "error", error };
    }

    if (chunk.length < size) break;
    from += size;

    if (await shouldCancel()) {
      log(`[CLUSTERING] Cancelled during fetch for user ${userId}`);
      return { status: "cancelled" };
    }
  }

  return { status: "ok", rows: userBookmarks };
};

/** Bookmark ids whose folder placement was manually confirmed and must be
 * left out of this run's clustering — the algorithm never sees or moves them. */
export const fetchPinnedBookmarkIds = async (
  userId: string,
  log: (msg: string) => void,
): Promise<Set<string>> => {
  const pinned = new Set<string>();
  let from = 0;
  const size = 1000;

  while (true) {
    const { data, error } = await supabase
      .from("cluster_assignments")
      .select("bookmark_id, bookmarks!inner(user_id)")
      .eq("is_pinned", true)
      .eq("bookmarks.user_id", userId)
      .range(from, from + size - 1);

    if (error) {
      log(`Error fetching pinned bookmark ids: ${JSON.stringify(error)}`);
      throw error;
    }

    if (!data || data.length === 0) break;

    for (const row of data as Array<{ bookmark_id: string }>) {
      pinned.add(row.bookmark_id);
    }

    if (data.length < size) break;
    from += size;
  }

  return pinned;
};

/** Clears assignments for everything except pinned bookmarks, then prunes
 * clusters left with zero assignments — a scoped version of the old
 * clear_user_ingest_structure that leaves pinned placements untouched. */
export const clearUnpinnedAssignmentsAndPruneClusters = async (
  userId: string,
  log: (msg: string) => void,
): Promise<boolean> => {
  const { error } = await supabase.rpc("clear_unpinned_cluster_assignments", {
    p_user_id: userId,
  });

  if (error) {
    log(
      `Error clearing unpinned cluster assignments: ${JSON.stringify(error)}`,
    );
    return false;
  }

  return true;
};

export const createCluster = async (
  userId: string,
  parentId: string | null,
  name: string,
  keywords: string[],
  log: (msg: string) => void,
): Promise<string | null> => {
  const { data: newCluster, error } = await supabase
    .from("clusters")
    .insert({
      user_id: userId,
      name,
      parent_id: parentId,
      keywords: keywords.length > 0 ? keywords : null,
    })
    .select("id")
    .single();

  if (error || !newCluster?.id) {
    log(`Error creating cluster: ${JSON.stringify(error)}`);
    return null;
  }

  return newCluster.id;
};

export type AssignBookmarksFailedBatch = {
  from: number;
  to: number;
  bookmarkIds: string[];
  error: unknown;
};

export type AssignBookmarksResult = {
  success: boolean;
  total: number;
  inserted: number;
  failed: number;
  failedBatches: AssignBookmarksFailedBatch[];
};

export const assignBookmarksToCluster = async (
  bookmarkIds: string[],
  clusterId: string,
  log: (msg: string) => void,
  distanceById?: Map<string, number>,
): Promise<AssignBookmarksResult> => {
  const uniqueBookmarkIds = Array.from(new Set(bookmarkIds));

  if (uniqueBookmarkIds.length === 0) {
    return {
      success: true,
      total: 0,
      inserted: 0,
      failed: 0,
      failedBatches: [],
    };
  }

  let inserted = 0;
  const failedBatches: AssignBookmarksFailedBatch[] = [];

  for (
    let from = 0;
    from < uniqueBookmarkIds.length;
    from += CLUSTER_ASSIGNMENT_BATCH_SIZE
  ) {
    const batchBookmarkIds = uniqueBookmarkIds.slice(
      from,
      from + CLUSTER_ASSIGNMENT_BATCH_SIZE,
    );
    const assignments = batchBookmarkIds.map((bookmarkId) => ({
      cluster_id: clusterId,
      bookmark_id: bookmarkId,
      ...(distanceById?.has(bookmarkId)
        ? { distance_to_centroid: distanceById.get(bookmarkId) }
        : {}),
    }));

    const { error } = await supabase
      .from("cluster_assignments")
      .insert(assignments);

    if (error) {
      const to = from + batchBookmarkIds.length - 1;
      log(
        `Batch insert error for cluster ${clusterId}, assignments ${from}-${to}: ${JSON.stringify(error)}`,
      );
      failedBatches.push({
        from,
        to,
        bookmarkIds: batchBookmarkIds,
        error,
      });
      continue;
    }

    inserted += batchBookmarkIds.length;
  }

  const failed = failedBatches.reduce(
    (sum, batch) => sum + batch.bookmarkIds.length,
    0,
  );

  return {
    success: failed === 0,
    total: uniqueBookmarkIds.length,
    inserted,
    failed,
    failedBatches,
  };
};
