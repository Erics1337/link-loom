import { BookmarkNode } from '../components/BookmarkTree';
import { BookmarkRootTitle, ROOT_TITLES } from './bookmarkImport';
import { countDuplicateAssignments, StructureAssignment } from './bookmarkStructure';

type RawStructureData = {
    clusters: any[];
    assignments: any[];
};

export type PreviewOverflowBookmark = {
    id: string;
    url: string;
    title: string;
};

type BuildStructurePreviewInput = {
    data: RawStructureData;
    availableRoots: BookmarkRootTitle[];
    bookmarkRootMap: Record<string, BookmarkRootTitle>;
    bookmarkPreferredRootMap: Record<string, BookmarkRootTitle>;
    overflowBookmarks: PreviewOverflowBookmark[];
    originalTree: any[];
    defaultRootTitle: BookmarkRootTitle;
};

const isBookmarkRootTitle = (value: string): value is BookmarkRootTitle =>
    ROOT_TITLES.includes(value as BookmarkRootTitle);

const resolvePreviewRoot = (
    chromeId: string,
    availableRoots: BookmarkRootTitle[],
    actualRootMap: Record<string, BookmarkRootTitle>,
    preferredRootMap: Record<string, BookmarkRootTitle>,
    defaultRootTitle: BookmarkRootTitle
): BookmarkRootTitle => {
    const actualRoot = actualRootMap[chromeId] ?? defaultRootTitle;
    const preferredRoot = preferredRootMap[chromeId] ?? actualRoot;

    if (preferredRoot === 'Mobile Bookmarks' && !availableRoots.includes('Mobile Bookmarks')) {
        return 'Other Bookmarks';
    }

    return preferredRoot;
};

export const buildStructurePreview = ({
    data,
    availableRoots,
    bookmarkRootMap,
    bookmarkPreferredRootMap,
    overflowBookmarks,
    originalTree,
    defaultRootTitle,
}: BuildStructurePreviewInput) => {
    const clusterDefinitions = new Map<string, { id: string; name: string; parentId: string | null }>();
    const childClusterIds = new Map<string | null, string[]>();
    const assignmentSummaries: StructureAssignment[] = [];
    const bookmarksByRootAndCluster = new Map<BookmarkRootTitle, Map<string, BookmarkNode[]>>();

    data.clusters.forEach((cluster: any) => {
        clusterDefinitions.set(cluster.id, {
            id: cluster.id,
            name: cluster.name,
            parentId: cluster.parent_id ?? null,
        });
        const parentKey = cluster.parent_id ?? null;
        const siblings = childClusterIds.get(parentKey);
        if (siblings) {
            siblings.push(cluster.id);
        } else {
            childClusterIds.set(parentKey, [cluster.id]);
        }
    });

    data.assignments.forEach((assignment: any) => {
        const rawUrl = assignment.bookmarks?.url;
        const chromeId = assignment.bookmarks?.chrome_id;
        if (typeof rawUrl !== 'string' || typeof chromeId !== 'string' || !rawUrl || !chromeId) {
            return;
        }

        const rootTitle = resolvePreviewRoot(
            chromeId,
            availableRoots,
            bookmarkRootMap,
            bookmarkPreferredRootMap,
            defaultRootTitle
        );
        assignmentSummaries.push({
            bookmarkId: assignment.bookmark_id,
            chromeId,
            url: rawUrl,
            rootTitle,
        });

        const rootAssignments = bookmarksByRootAndCluster.get(rootTitle) ?? new Map<string, BookmarkNode[]>();
        const clusterBookmarks = rootAssignments.get(assignment.cluster_id) ?? [];
        clusterBookmarks.push({
            id: `bookmark-${assignment.bookmark_id}`,
            title: assignment.bookmarks.ai_title || assignment.bookmarks.title,
            originalTitle: assignment.bookmarks.title,
            url: rawUrl,
            chromeId,
            nodeType: 'bookmark',
            rootTitle,
        });
        rootAssignments.set(assignment.cluster_id, clusterBookmarks);
        bookmarksByRootAndCluster.set(rootTitle, rootAssignments);
    });

    const buildClusterNodeForRoot = (clusterId: string, rootTitle: BookmarkRootTitle): BookmarkNode | null => {
        const cluster = clusterDefinitions.get(clusterId);
        if (!cluster) return null;

        const childFolders = (childClusterIds.get(clusterId) || [])
            .map((childId) => buildClusterNodeForRoot(childId, rootTitle))
            .filter((node): node is BookmarkNode => Boolean(node));
        const directBookmarks = bookmarksByRootAndCluster.get(rootTitle)?.get(clusterId) || [];

        if (childFolders.length === 0 && directBookmarks.length === 0) {
            return null;
        }

        return {
            id: `cluster-${rootTitle}-${clusterId}`,
            title: cluster.name,
            children: [...childFolders, ...directBookmarks],
            parentId: cluster.parentId,
            nodeType: 'folder',
            rootTitle,
        };
    };

    const overflowIds = new Set(overflowBookmarks.map((bookmark) => bookmark.id));
    const buildOverflowTree = (nodes: any[]): BookmarkNode[] => {
        const result: BookmarkNode[] = [];

        for (const node of nodes) {
            if (node.url) {
                if (!overflowIds.has(node.id)) continue;
                const rootTitle = bookmarkRootMap[node.id] ?? defaultRootTitle;
                result.push({
                    id: `overflow-bookmark-${node.id}`,
                    title: node.title,
                    originalTitle: node.title,
                    url: node.url,
                    chromeId: node.id,
                    nodeType: 'bookmark',
                    rootTitle,
                    isOverflow: true,
                });
                continue;
            }

            if (!Array.isArray(node.children)) continue;

            const filteredChildren = buildOverflowTree(node.children);
            if (filteredChildren.length === 0) continue;

            result.push({
                id: `overflow-folder-${node.id}`,
                title: node.title || 'Untitled Folder',
                children: filteredChildren,
                nodeType: 'folder',
                rootTitle: typeof node.title === 'string' && isBookmarkRootTitle(node.title) ? node.title : undefined,
                isOverflow: true,
            });
        }

        return result;
    };

    const overflowNodes = buildOverflowTree(originalTree?.[0]?.children || []);
    const rootNodes: BookmarkNode[] = [];
    const overflowCount = overflowBookmarks.length;

    ROOT_TITLES.forEach((rootTitle) => {
        const clusterChildren = (childClusterIds.get(null) || [])
            .map((clusterId) => buildClusterNodeForRoot(clusterId, rootTitle))
            .filter((node): node is BookmarkNode => Boolean(node));
        const rootChildren = [...clusterChildren];

        if (rootTitle === 'Other Bookmarks' && overflowNodes.length > 0) {
            rootChildren.push({
                id: 'overflow-unorganized-folder',
                title: 'Unorganized Bookmarks',
                children: overflowNodes,
                nodeType: 'folder',
                rootTitle,
                isOverflow: true,
                badgeLabel: 'Unorganized',
            });
        }

        if (rootChildren.length === 0 && !availableRoots.includes(rootTitle)) {
            return;
        }

        rootNodes.push({
            id: `root-${rootTitle}`,
            title: rootTitle,
            children: rootChildren,
            nodeType: 'root',
            rootTitle,
            badgeLabel:
                rootTitle === 'Other Bookmarks' && overflowCount > 0
                    ? `${overflowCount} extra`
                    : undefined,
        });
    });

    return {
        rootNodes,
        assignmentSummaries,
        duplicateCount: countDuplicateAssignments(assignmentSummaries),
    };
};
