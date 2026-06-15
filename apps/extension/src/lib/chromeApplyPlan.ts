import { BookmarkNode } from '../components/BookmarkTree';
import { ROOT_IDS, BookmarkRootTitle } from './bookmarkImport';
import { getBookmarkChromeId } from './bookmarkStructure';

export const APPLY_JOURNAL_STORAGE_KEY = 'bookmarkWeaverActiveApplyJournal';

export type ChromeApplyResult = {
    movedCount: number;
    renamedCount: number;
    deletedCount: number;
    createdFolderCount: number;
    skippedCount: number;
    folderCreateFailures: number;
    cleanupFailures: number;
    cleanupFailureMessages: string[];
    journalId?: string;
    shouldWarnAboutPartialApply: boolean;
};

export type ChromeApplyPlanSummary = {
    createFolderCount: number;
    moveBookmarkCount: number;
    renameBookmarkCount: number;
    deleteRootChildCount: number;
    skippedBookmarkCount: number;
    rootTitles: BookmarkRootTitle[];
};

export type ChromeApplyPlan = {
    id: string;
    createdAt: string;
    roots: Array<{
        rootTitle: BookmarkRootTitle;
        rootId: string;
        children: PlannedNode[];
        cleanupDeleteTargets: CleanupDeleteTarget[];
    }>;
    summary: ChromeApplyPlanSummary;
    preview: ChromeApplyPlanPreview;
};

export type ChromeApplyPlanPreview = {
    creates: Array<{ planId: string; title: string }>;
    moves: Array<{ planId: string; chromeId: string; title: string; url?: string }>;
    renames: Array<{ planId: string; chromeId: string; from: string; to: string; url?: string }>;
    deletes: CleanupDeleteTarget[];
};

export type ChromeApplyJournal = {
    id: string;
    plan: ChromeApplyPlan;
    phase: 'folders' | 'bookmarks' | 'cleanup' | 'complete' | 'rollback';
    createdFolderIdsByPlanId: Record<string, string>;
    entries: ChromeApplyJournalEntry[];
    completed: boolean;
    errorMessage?: string;
    updatedAt: string;
};

export type ChromeApplyRollbackResult = {
    skippedDeletedFolderCount: number;
    skippedDeletedFolderTitles: string[];
};

type RootNode = BookmarkNode & { rootTitle: BookmarkRootTitle };

type PlannedNode = PlannedFolderNode | PlannedBookmarkNode;

type PlannedFolderNode = {
    kind: 'folder';
    planId: string;
    title: string;
    children: PlannedNode[];
};

type PlannedBookmarkNode = {
    kind: 'bookmark';
    planId: string;
    chromeId?: string;
    title: string;
    originalTitle?: string;
    url?: string;
};

type CleanupDeleteTarget = {
    chromeId: string;
    title: string;
    kind: 'folder' | 'bookmark';
    url?: string;
};

type PlannedRoot = ChromeApplyPlan['roots'][number];

type ChromeApplyJournalEntry =
    | {
        type: 'createFolder';
        status: 'pending' | 'applied';
        planId: string;
        chromeId?: string;
        parentId: string;
        title: string;
    }
    | {
        type: 'updateBookmark';
        status: 'pending' | 'applied';
        chromeId: string;
        previousTitle: string;
        nextTitle: string;
    }
    | {
        type: 'moveBookmark';
        status: 'pending' | 'applied';
        chromeId: string;
        previousParentId: string;
        previousIndex?: number;
        nextParentId: string;
    }
    | {
        type: 'deleteRootChild';
        status: 'pending' | 'applied';
        rootId: string;
        target: CleanupDeleteTarget;
    };

const getNowIso = () => new Date().toISOString();

const makePlanId = () =>
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `apply-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const getChromeErrorMessage = (fallback: unknown) => {
    const runtimeError = chrome.runtime?.lastError?.message;
    if (runtimeError) return runtimeError;
    return fallback instanceof Error ? fallback.message : String(fallback);
};

const readStorageValue = async <T>(key: string): Promise<T | undefined> => {
    const stored = await chrome.storage.local.get(key);
    return stored[key] as T | undefined;
};

const writeJournal = async (journal: ChromeApplyJournal) => {
    journal.updatedAt = getNowIso();
    await chrome.storage.local.set({ [APPLY_JOURNAL_STORAGE_KEY]: journal });
};

export const loadActiveChromeApplyJournal = async () => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
        return null;
    }

    const journal = await readStorageValue<ChromeApplyJournal>(APPLY_JOURNAL_STORAGE_KEY);
    return journal && !journal.completed ? journal : null;
};

export const clearChromeApplyJournal = async () => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
        return;
    }
    await chrome.storage.local.remove(APPLY_JOURNAL_STORAGE_KEY);
};

const normalizeTitle = (title?: string) => (title || 'Untitled Folder').trim() || 'Untitled Folder';

const collectPlannedNodes = (
    nodes: BookmarkNode[],
    summary: ChromeApplyPlanSummary,
    preview: ChromeApplyPlanPreview,
    planIdPrefix: string
): PlannedNode[] => {
    return nodes
        .filter((node) => !node.isSeparator)
        .map((node, index): PlannedNode => {
            const planId = `${planIdPrefix}-${index}`;
            if (node.url) {
                const chromeId = getBookmarkChromeId(node);
                if (!chromeId) {
                    summary.skippedBookmarkCount += 1;
                } else {
                    summary.moveBookmarkCount += 1;
                    preview.moves.push({ planId, chromeId, title: node.title, url: node.url });
                    const nextTitle = node.title.trim();
                    const currentTitle = (node.originalTitle || node.title).trim();
                    if (nextTitle && nextTitle !== currentTitle) {
                        summary.renameBookmarkCount += 1;
                        preview.renames.push({ planId, chromeId, from: currentTitle, to: nextTitle, url: node.url });
                    }
                }

                return {
                    kind: 'bookmark',
                    planId,
                    chromeId,
                    title: node.title,
                    originalTitle: node.originalTitle,
                    url: node.url,
                };
            }

            summary.createFolderCount += 1;
            preview.creates.push({ planId, title: normalizeTitle(node.title) });
            return {
                kind: 'folder',
                planId,
                title: normalizeTitle(node.title),
                children: collectPlannedNodes(node.children || [], summary, preview, planId),
            };
        });
};

const collectPlannedBookmarkChromeIds = (nodes: PlannedNode[], keepIds: Set<string>) => {
    for (const node of nodes) {
        if (node.kind === 'bookmark' && node.chromeId) {
            keepIds.add(node.chromeId);
        } else if (node.kind === 'folder') {
            collectPlannedBookmarkChromeIds(node.children, keepIds);
        }
    }
};

const collectTopLevelBookmarkChromeIds = (nodes: PlannedNode[], keepIds: Set<string>) => {
    for (const node of nodes) {
        if (node.kind === 'bookmark' && node.chromeId) {
            keepIds.add(node.chromeId);
        }
    }
};

const getCleanupDeleteTargets = async (rootId: string, keepIds: Set<string>) => {
    const children = await chrome.bookmarks.getChildren(rootId);
    return children
        .filter((child) => !keepIds.has(child.id))
        .map((child): CleanupDeleteTarget => ({
            chromeId: child.id,
            title: child.title || 'Untitled',
            kind: child.url ? 'bookmark' : 'folder',
            url: child.url,
        }));
};

export const buildChromeBookmarkApplyPlan = async (rootNodes: RootNode[]): Promise<ChromeApplyPlan> => {
    const summary: ChromeApplyPlanSummary = {
        createFolderCount: 0,
        moveBookmarkCount: 0,
        renameBookmarkCount: 0,
        deleteRootChildCount: 0,
        skippedBookmarkCount: 0,
        rootTitles: rootNodes.map((node) => node.rootTitle),
    };
    const preview: ChromeApplyPlanPreview = {
        creates: [],
        moves: [],
        renames: [],
        deletes: [],
    };

    const roots = [];
    for (const rootNode of rootNodes) {
        const rootId = ROOT_IDS[rootNode.rootTitle];
        const children = collectPlannedNodes(rootNode.children || [], summary, preview, `root-${rootNode.rootTitle}`);
        const plannedBookmarkIds = new Set<string>();
        collectPlannedBookmarkChromeIds(children, plannedBookmarkIds);
        const cleanupDeleteTargets = await getCleanupDeleteTargets(rootId, plannedBookmarkIds);
        summary.deleteRootChildCount += cleanupDeleteTargets.length;
        preview.deletes.push(...cleanupDeleteTargets);
        roots.push({
            rootTitle: rootNode.rootTitle,
            rootId,
            children,
            cleanupDeleteTargets,
        });
    }

    return {
        id: makePlanId(),
        createdAt: getNowIso(),
        roots,
        summary,
        preview,
    };
};

export const formatChromeApplyPlanPreview = (plan: ChromeApplyPlan) => {
    const rootList = plan.summary.rootTitles.join(', ');
    const formatExamples = (items: string[]) => {
        if (items.length === 0) return 'none';
        const shown = items.slice(0, 5);
        return `${shown.join(', ')}${items.length > shown.length ? `, and ${items.length - shown.length} more` : ''}`;
    };

    return [
        `Roots: ${rootList || 'none'}`,
        `Create folders: ${plan.summary.createFolderCount} (${formatExamples(plan.preview.creates.map((item) => item.title))})`,
        `Move bookmarks: ${plan.summary.moveBookmarkCount} (${formatExamples(plan.preview.moves.map((item) => item.title.trim() || item.chromeId))})`,
        `Rename bookmarks: ${plan.summary.renameBookmarkCount} (${formatExamples(plan.preview.renames.map((item) => `${item.from} -> ${item.to}`))})`,
        `Delete replaced root items: ${plan.summary.deleteRootChildCount} (${formatExamples(plan.preview.deletes.map((item) => item.title))})`,
        `Skipped bookmarks without Chrome IDs: ${plan.summary.skippedBookmarkCount}`,
    ].join('\n');
};

const createEmptyResult = (journalId?: string): ChromeApplyResult => ({
    movedCount: 0,
    renamedCount: 0,
    deletedCount: 0,
    createdFolderCount: 0,
    skippedCount: 0,
    folderCreateFailures: 0,
    cleanupFailures: 0,
    cleanupFailureMessages: [],
    journalId,
    shouldWarnAboutPartialApply: false,
});

const getBookmarkNode = async (chromeId: string) => {
    const nodes = await chrome.bookmarks.get(chromeId);
    if (!nodes[0]) {
        throw new Error(`Missing bookmark ${chromeId}`);
    }
    return nodes[0];
};

const findBookmarkNode = async (chromeId: string) => {
    const nodes = await chrome.bookmarks.get(chromeId).catch(() => []);
    return nodes[0] || null;
};

const getCreateFolderMarkerTitle = (journalId: string, planId: string, title: string) =>
    `[Link Loom apply ${journalId}:${planId}] ${title}`;

const findChildByTitle = async (parentId: string, title: string) => {
    const children = await chrome.bookmarks.getChildren(parentId).catch(() => []);
    return children.find((child) => !child.url && child.title === title) || null;
};

const findCreateFolderEntry = (journal: ChromeApplyJournal, planId: string) =>
    journal.entries.find((entry): entry is Extract<ChromeApplyJournalEntry, { type: 'createFolder' }> =>
        entry.type === 'createFolder' && entry.planId === planId
    );

const createFoldersForNodes = async (
    nodes: PlannedNode[],
    parentId: string,
    journal: ChromeApplyJournal,
    result: ChromeApplyResult
) => {
    for (const node of nodes) {
        if (node.kind === 'bookmark') continue;
        if (journal.createdFolderIdsByPlanId[node.planId]) {
            await createFoldersForNodes(node.children, journal.createdFolderIdsByPlanId[node.planId], journal, result);
            continue;
        }

        try {
            let entry = findCreateFolderEntry(journal, node.planId);
            if (!entry) {
                entry = {
                    type: 'createFolder',
                    status: 'pending',
                    planId: node.planId,
                    parentId,
                    title: node.title,
                };
                journal.entries.push(entry);
                await writeJournal(journal);
            }

            const markerTitle = getCreateFolderMarkerTitle(journal.id, node.planId, node.title);
            const existingMarkedFolder = !entry.chromeId ? await findChildByTitle(parentId, markerTitle) : null;
            const folder = existingMarkedFolder || await chrome.bookmarks.create({ parentId, title: markerTitle });
            entry.chromeId = folder.id;
            entry.status = 'applied';
            journal.createdFolderIdsByPlanId[node.planId] = folder.id;
            result.createdFolderCount += 1;
            await writeJournal(journal);
            if (folder.title !== node.title) {
                await chrome.bookmarks.update(folder.id, { title: node.title });
            }
            await createFoldersForNodes(node.children, folder.id, journal, result);
        } catch (error) {
            result.folderCreateFailures += 1;
            result.shouldWarnAboutPartialApply = true;
            journal.errorMessage = getChromeErrorMessage(error);
            await writeJournal(journal);
            console.error(`[ApplyChanges] Failed to create folder ${node.title}`, error);
        }
    }
};

const applyBookmarksForNodes = async (
    nodes: PlannedNode[],
    parentId: string,
    journal: ChromeApplyJournal,
    result: ChromeApplyResult
) => {
    for (const node of nodes) {
        if (node.kind === 'folder') {
            const folderId = journal.createdFolderIdsByPlanId[node.planId];
            if (!folderId) {
                result.skippedCount += countPlannedBookmarks(node.children);
                continue;
            }
            await applyBookmarksForNodes(node.children, folderId, journal, result);
            continue;
        }

        if (!node.chromeId) {
            result.skippedCount += 1;
            continue;
        }

        try {
            const current = await getBookmarkNode(node.chromeId);
            const nextTitle = node.title.trim();
            const currentTitle = (current.title || node.originalTitle || node.title).trim();

            if (nextTitle && nextTitle !== currentTitle) {
                const entry: ChromeApplyJournalEntry = {
                    type: 'updateBookmark',
                    status: 'pending',
                    chromeId: node.chromeId,
                    previousTitle: current.title,
                    nextTitle,
                };
                journal.entries.push(entry);
                await writeJournal(journal);

                await chrome.bookmarks.update(node.chromeId, { title: nextTitle });
                entry.status = 'applied';
                result.renamedCount += 1;
                await writeJournal(journal);
            }

            if (current.parentId !== parentId) {
                const entry: ChromeApplyJournalEntry = {
                    type: 'moveBookmark',
                    status: 'pending',
                    chromeId: node.chromeId,
                    previousParentId: current.parentId || '',
                    previousIndex: current.index,
                    nextParentId: parentId,
                };
                journal.entries.push(entry);
                await writeJournal(journal);

                await chrome.bookmarks.move(node.chromeId, { parentId });
                entry.status = 'applied';
                await writeJournal(journal);
                result.movedCount += 1;
            }
        } catch (error) {
            result.skippedCount += 1;
            result.shouldWarnAboutPartialApply = true;
            journal.errorMessage = getChromeErrorMessage(error);
            await writeJournal(journal);
            console.warn(`[ApplyChanges] Failed to move bookmark ${node.chromeId}:`, error);
        }
    }
};

const countPlannedBookmarks = (nodes: PlannedNode[]): number =>
    nodes.reduce((sum, node) => sum + (node.kind === 'bookmark' ? 1 : countPlannedBookmarks(node.children)), 0);

const collectRootKeepIds = (nodes: PlannedNode[], journal: ChromeApplyJournal) => {
    const keepIds = new Set<string>();
    collectTopLevelBookmarkChromeIds(nodes, keepIds);

    for (const node of nodes) {
        if (node.kind === 'folder') {
            const folderId = journal.createdFolderIdsByPlanId[node.planId];
            if (folderId) {
                keepIds.add(folderId);
            }
        }
    }

    return keepIds;
};

const cleanupRootChildren = async (
    root: PlannedRoot,
    journal: ChromeApplyJournal,
    result: ChromeApplyResult
) => {
    const rootId = root.rootId;
    const rootKeepIds = collectRootKeepIds(root.children, journal);
    const plannedBookmarkIds = new Set<string>();
    collectPlannedBookmarkChromeIds(root.children, plannedBookmarkIds);
    const currentRootChildIds = new Set((await chrome.bookmarks.getChildren(rootId)).map((child) => child.id));
    const deleteTargets = root.cleanupDeleteTargets.filter(
        (target) =>
            currentRootChildIds.has(target.chromeId) &&
            !rootKeepIds.has(target.chromeId) &&
            !plannedBookmarkIds.has(target.chromeId)
    );

    for (const target of [...deleteTargets].reverse()) {
        try {
            const entry: ChromeApplyJournalEntry = {
                type: 'deleteRootChild',
                status: 'pending',
                rootId,
                target,
            };
            journal.entries.push(entry);
            await writeJournal(journal);

            if (target.kind === 'bookmark') {
                await chrome.bookmarks.remove(target.chromeId);
            } else {
                await chrome.bookmarks.removeTree(target.chromeId);
            }
            entry.status = 'applied';
            result.deletedCount += 1;
            await writeJournal(journal);
        } catch (error) {
            result.cleanupFailures += 1;
            result.shouldWarnAboutPartialApply = true;
            result.cleanupFailureMessages.push(getChromeErrorMessage(error));
            journal.errorMessage = getChromeErrorMessage(error);
            await writeJournal(journal);
            console.warn(`[ApplyChanges] Failed to clean root child ${target.title}`, error);
        }
    }
};

const createJournal = (plan: ChromeApplyPlan): ChromeApplyJournal => ({
    id: plan.id,
    plan,
    phase: 'folders',
    createdFolderIdsByPlanId: {},
    entries: [],
    completed: false,
    updatedAt: getNowIso(),
});

let inFlightApply: Promise<ChromeApplyResult> | null = null;

const runExclusiveApply = async (
    allowExistingJournal: boolean,
    runner: () => Promise<ChromeApplyResult>
): Promise<ChromeApplyResult> => {
    if (inFlightApply) {
        throw new Error('A bookmark apply is already in progress.');
    }

    if (!allowExistingJournal) {
        const existingJournal = await loadActiveChromeApplyJournal();
        if (existingJournal) {
            throw new Error(
                'An unfinished bookmark apply journal is already active.'
            );
        }
    }

    const operation = runner();
    inFlightApply = operation.finally(() => {
        inFlightApply = null;
    });

    return operation;
};

export const applyChromeBookmarkPlan = async (plan: ChromeApplyPlan): Promise<ChromeApplyResult> => {
    return runExclusiveApply(false, async () => {
        const journal = createJournal(plan);
        await writeJournal(journal);
        return executeChromeApplyJournal(journal);
    });
};

const executeChromeApplyJournal = async (journal: ChromeApplyJournal): Promise<ChromeApplyResult> => {
    const result = createEmptyResult(journal.id);

    try {
        journal.phase = 'folders';
        await writeJournal(journal);
        for (const root of journal.plan.roots) {
            await createFoldersForNodes(root.children, root.rootId, journal, result);
        }

        journal.phase = 'bookmarks';
        await writeJournal(journal);
        for (const root of journal.plan.roots) {
            await applyBookmarksForNodes(root.children, root.rootId, journal, result);
        }

        if (result.folderCreateFailures === 0 && result.skippedCount === 0) {
            journal.phase = 'cleanup';
            await writeJournal(journal);
            for (const root of journal.plan.roots) {
                await cleanupRootChildren(root, journal, result);
            }
        } else {
            result.shouldWarnAboutPartialApply = true;
        }

        if (result.shouldWarnAboutPartialApply) {
            await writeJournal(journal);
            return result;
        }

        journal.phase = 'complete';
        journal.completed = true;
        await writeJournal(journal);
        await clearChromeApplyJournal();
        return result;
    } catch (error) {
        journal.errorMessage = getChromeErrorMessage(error);
        await writeJournal(journal);
        result.shouldWarnAboutPartialApply = true;
        throw error;
    }
};

export const resumeChromeBookmarkApplyJournal = async (journal: ChromeApplyJournal) => {
    return runExclusiveApply(true, () => executeChromeApplyJournal(journal));
};

const rollbackAppliedJournalEntry = async (
    entry: ChromeApplyJournalEntry,
    restoredIds: Record<string, string>,
    result: ChromeApplyRollbackResult
) => {
    if (entry.type === 'deleteRootChild') {
        const existing = await chrome.bookmarks.get(entry.target.chromeId).catch(() => []);
        if (existing.length === 0) {
            if (entry.target.kind === 'folder') {
                result.skippedDeletedFolderCount += 1;
                result.skippedDeletedFolderTitles.push(entry.target.title);
                return;
            }
            const restored = await chrome.bookmarks.create({
                parentId: entry.rootId,
                title: entry.target.title,
                url: entry.target.kind === 'bookmark' ? entry.target.url : undefined,
            });
            restoredIds[entry.target.chromeId] = restored.id;
        } else {
            restoredIds[entry.target.chromeId] = entry.target.chromeId;
        }
        return;
    }

    if (entry.type === 'moveBookmark') {
        const existing = await findBookmarkNode(entry.chromeId);
        if (!existing) return;
        await chrome.bookmarks.move(entry.chromeId, {
            parentId: restoredIds[entry.previousParentId] || entry.previousParentId,
            index: entry.previousIndex,
        });
        return;
    }

    if (entry.type === 'updateBookmark') {
        const existing = await findBookmarkNode(entry.chromeId);
        if (!existing) return;
        await chrome.bookmarks.update(entry.chromeId, { title: entry.previousTitle });
        return;
    }

    if (entry.type === 'createFolder') {
        if (!entry.chromeId) return;
        const existing = await findBookmarkNode(entry.chromeId);
        if (!existing) return;
        const children = await chrome.bookmarks.getChildren(entry.chromeId).catch(() => []);
        if (children.length > 0) {
            return;
        }
        await chrome.bookmarks.removeTree(entry.chromeId);
    }
};

export const rollbackChromeBookmarkApplyJournal = async (journal: ChromeApplyJournal): Promise<ChromeApplyRollbackResult> => {
    journal.phase = 'rollback';
    await writeJournal(journal);
    const restoredIds: Record<string, string> = {};
    const result: ChromeApplyRollbackResult = {
        skippedDeletedFolderCount: 0,
        skippedDeletedFolderTitles: [],
    };

    const appliedEntries = [...journal.entries]
        .reverse()
        .filter((entry) => entry.status === 'applied');

    const rollbackEntries = async (
        entries: ChromeApplyJournalEntry[],
        entryFilter: (entry: ChromeApplyJournalEntry) => boolean
    ) => {
        for (const entry of entries) {
            if (!entryFilter(entry)) {
                continue;
            }

            try {
                await rollbackAppliedJournalEntry(entry, restoredIds, result);
            } catch (error) {
                journal.errorMessage = getChromeErrorMessage(error);
                await writeJournal(journal);
                throw error;
            }
        }
    };

    await rollbackEntries(
        appliedEntries,
        (entry) => entry.type !== 'createFolder'
    );
    await rollbackEntries(
        appliedEntries,
        (entry) => entry.type === 'createFolder'
    );

    journal.completed = true;
    journal.phase = 'complete';
    await writeJournal(journal);
    await clearChromeApplyJournal();
    return result;
};
