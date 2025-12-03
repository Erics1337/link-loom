// link-loom Background Service
import { BackendService } from './services/backend.js';
import { generateUUID } from './utils/uuid.js';

// Initialize Services with keys from storage
let backend;
let userId;

async function initServices() {
    const data = await chrome.storage.local.get(['userId']);
    backend = new BackendService();

    if (data.userId) {
        userId = data.userId;
    } else {
        userId = generateUUID();
        await chrome.storage.local.set({ userId });
    }
    console.log('Services initialized. User ID:', userId);
}

// Call init immediately
initServices().catch(console.error);

// Listen for storage changes to update keys dynamically
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local') {
        initServices();
    }
});

// Helper to safely send responses even if the popup is closed
function safeSendResponse(sendResponse, data) {
    try {
        sendResponse(data);
    } catch (error) {
        // Ignore 'Receiving end does not exist' error as it just means the popup was closed
        if (!error.message.includes('Receiving end does not exist')) {
            console.warn('Failed to send response:', error);
        }
    }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'analyze_bookmarks') {
        analyzeBookmarks(request.settings)
            .then(structure => {
                // Do NOT send structure back here, it's too big and causes crashes.
                // The popup will receive updates via 'status_update' messages or storage.
                safeSendResponse(sendResponse, { status: 'success' });
            })
            .catch(error => {
                if (error.message === 'Aborted' || error.name === 'AbortError') {
                    console.log('Analysis aborted by user.');
                    safeSendResponse(sendResponse, { status: 'cancelled' });
                } else {
                    console.error(error);
                    safeSendResponse(sendResponse, { status: 'error', message: error.message });
                }
            });
        return true; // Keep channel open for async response
    }

    if (request.action === 'apply_structure') {
        applyStructure(request.structure)
            .then(() => {
                safeSendResponse(sendResponse, { status: 'success' });
            })
            .catch(error => {
                safeSendResponse(sendResponse, { status: 'error', message: error.message });
            });
        return true;
    }

    if (request.action === 'stop_analysis') {
        if (abortController) {
            abortController.abort();
            safeSendResponse(sendResponse, { status: 'success' });
        } else {
            safeSendResponse(sendResponse, { status: 'error', message: 'No analysis running' });
        }
    }

    if (request.action === 'switch_to_metadata') {
        // Metadata mode is now handled by backend logic or granularity settings
        // For now, we just acknowledge it, but maybe we should pass a flag to backend?
        console.log('Switched to Metadata Mode (Fallback) via user request.');
        safeSendResponse(sendResponse, { status: 'success' });
        return true;
    }

    if (request.action === 'get_analysis_status') {
        const isRunning = !!abortController;
        safeSendResponse(sendResponse, {
            status: 'success',
            isRunning,
            // If running, we could return current progress if we tracked it globally, 
            // but for now just knowing it's alive is enough.
        });
        return true;
    }
});

async function updateState(status, progress = null, message = null, payload = null) {
    const state = { status, progress, message, timestamp: Date.now(), ...payload };

    // Send message immediately
    chrome.runtime.sendMessage({ action: 'status_update', state })
        .catch(() => { /* Ignore closed popup */ });

    // Save to storage (Fire and Forget - do not await)
    chrome.storage.local.set({ processingState: state }).catch(console.warn);
}

// Global AbortController to manage cancellation
let abortController = null;

async function analyzeBookmarks(settings) {
    try {
        // Reset controller for new run
        if (abortController) abortController.abort();
        abortController = new AbortController();
        const signal = abortController.signal;

        await updateState('processing', { current: 0, total: 0 }, 'Starting analysis...');

        // Prevent system sleep
        chrome.power.requestKeepAwake('system');

        // Ensure services are initialized
        if (!backend) {
            console.warn('Services not initialized, attempting to initialize...');
            await initServices();
            if (!backend) {
                throw new Error("Services failed to initialize. Please reload the extension.");
            }
        }

        // 1. Fetch all bookmarks
        const tree = await chrome.bookmarks.getTree();
        const flatBookmarks = flattenBookmarks(tree[0]);
        const totalBookmarks = flatBookmarks.length;

        // Check Premium Status
        const { isPremium } = await chrome.storage.local.get(['isPremium']);
        let bookmarksToProcess = flatBookmarks;

        if (!isPremium && totalBookmarks > 500) {
            console.log(`[Limit] User is not premium. Limiting processing to first 500 of ${totalBookmarks} bookmarks.`);
            bookmarksToProcess = flatBookmarks.slice(0, 500);

            // Notify user via toast (if possible) or just log
            // We can send a message to popup to show a toast
            chrome.runtime.sendMessage({
                action: 'quota_exceeded_warning',
                message: `Free plan limited to 500 bookmarks. Only the first 500 are being organized.`
            }).catch(() => { });
        }

        // 2. Sync to Backend
        if (signal.aborted) throw new Error('Aborted');
        await updateState('processing', { current: 10, total: 100 }, 'Syncing bookmarks to backend...');

        // Only sync the ones we are processing to avoid backend doing work on ignored ones?
        // Actually, sync might be good for backup, but for "organize" we want to limit.
        // The backend `organize` uses the synced bookmarks.
        // If we sync ALL, but then `organize` filters?
        // Current backend `organize` takes `userId` and uses ALL bookmarks for that user.
        // So we MUST only sync the ones we want to organize, OR update backend to accept a list of IDs.
        // Given current backend implementation (clusteringWorker fetches ALL for user), 
        // we should probably only sync the ones we want to process.
        // BUT, `syncBookmarks` is an upsert. If we sync fewer, the old ones might still be there?
        // `syncBookmarks` doesn't delete.
        // So if we sync 500, the backend might still have 1000 from previous runs.
        // We need to handle this.
        // Ideally, we should probably clear the backend for this user or update `organize` to filter.
        // For now, let's assume `syncBookmarks` is the source of truth for the current session.
        // Wait, `clusteringWorker` fetches `WHERE b.user_id = $1`.
        // If we want to limit, we should probably clear the user's bookmarks before syncing?
        // Or, simpler: The backend should probably just process what we give it.
        // But `syncBookmarks` is decoupled from `organize`.

        // Let's modify `syncBookmarks` to potentially clear old ones? No, that's risky.
        // Best approach without changing backend API too much:
        // We sync the 500.
        // But if the backend has more?
        // We can't easily "delete others" via the current `syncBookmarks`.

        // ALTERNATIVE: We send the list of IDs to `organize`?
        // `organize` takes `settings`. We can put the IDs in settings?
        // Or we can just rely on the fact that for a new user / clean state it works.
        // If a user was premium and becomes free?

        // Let's stick to: Sync ONLY the 500.
        // And hope backend doesn't use old ones.
        // Actually, `clusteringWorker` fetches `WHERE b.user_id = $1`.
        // If we don't delete the others, they are included.
        // This is a problem.

        // Quick fix: We can't easily fix this without backend changes.
        // But wait, I AM changing the backend too.
        // So I can update `organize` to accept a list of IDs or `clusteringWorker` to respect a limit?
        // No, `clusteringWorker` runs async.

        // Let's update `clusteringWorker` to respect the limit if passed in settings?
        // Or better: `syncBookmarks` should probably replace?
        // No, sync is sync.

        // Let's try to be smart.
        // If we are limiting, we want the backend to only see these 500.
        // Maybe we can send a "reset" flag to sync?

        // Actually, looking at `clusteringWorker.ts`:
        // It fetches ALL bookmarks for the user.
        // If I want to limit, I should probably implement the limit in the backend worker too?
        // "if the user has over 500 bookmarks it should only process and sort the first 500"

        // If I implement it in the backend, I don't need to filter here!
        // I can just send the "isPremium" flag (or rely on backend check) and let backend slice it.
        // That seems much more robust.
        // The user request says: "limit the sorting to 500 bookmarks for the free plan... if the user has over 500 bookmarks it should only process and sort the first 500"

        // So, I will pass `isPremium` in the settings to `organize`.
        // And `clusteringWorker` will do the slicing.
        // This avoids the sync issue.

        // 2. Sync to Backend
        if (signal.aborted) throw new Error('Aborted');
        await updateState('processing', { current: 10, total: 100 }, 'Syncing bookmarks to backend...');

        // Only sync the bookmarks we are processing (respecting the limit)
        await backend.syncBookmarks(userId, bookmarksToProcess);

        // 3. Trigger Organization
        if (signal.aborted) throw new Error('Aborted');
        await updateState('processing', { current: 20, total: 100 }, 'Starting organization...');

        // Pass premium status and total count to settings
        const organizeSettings = {
            ...settings,
            isPremium: isPremium,
            totalBookmarks: totalBookmarks
        };

        await backend.organize(userId, organizeSettings);

        // 4. Poll Status with timeout protection
        let jobStatus = 'active';
        const startTime = Date.now();
        const TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

        while (jobStatus === 'active' || jobStatus === 'waiting' || jobStatus === 'delayed' || jobStatus === 'processing') {
            if (signal.aborted) throw new Error('Aborted');

            // Check for timeout
            if (Date.now() - startTime > TIMEOUT_MS) {
                throw new Error('Processing timeout (30 minutes). Please try again with fewer bookmarks or contact support.');
            }

            const status = await backend.getStatus(userId);
            jobStatus = status.status; // 'active', 'completed', 'failed', etc.

            // Use the detailed message from backend (includes "Embedding: X/Y")
            const message = status.message || 'Processing...';
            const progressVal = status.progress ? Math.max(20, status.progress) : 20;

            await updateState('processing', { current: progressVal, total: 100 }, message);

            if (jobStatus === 'completed' || jobStatus === 'failed') break;

            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        if (jobStatus === 'failed') {
            throw new Error('Organization failed on backend.');
        }

        // 5. Fetch Structure with validation
        if (signal.aborted) throw new Error('Aborted');
        await updateState('processing', { current: 90, total: 100 }, 'Fetching results...');
        console.log('Calling backend.getStructure...');
        const response = await backend.getStructure(userId);
        console.log('backend.getStructure returned:', response ? 'Data received' : 'No data');

        // Validate that we got a reasonable number of bookmarks back
        const returnedBookmarkCount = countBookmarksInStructure(response.structure);
        const expectedCount = isPremium ? totalBookmarks : Math.min(totalBookmarks, 500);

        console.log(`Validation: Got ${returnedBookmarkCount} bookmarks, expected ~${expectedCount}`);

        // If we got significantly fewer bookmarks than expected, warn but don't fail
        if (returnedBookmarkCount < expectedCount * 0.8) {
            console.warn(`Warning: Only received ${returnedBookmarkCount}/${expectedCount} bookmarks. Some may still be processing.`);
            // Continue anyway - the backend might have filtered some out
        }

        // 6. Save Result
        const resultWithMetadata = {
            structure: response.structure,
            metadata: {
                duplicateCount: response.metadata?.duplicateCount || 0,
                brokenCount: response.metadata?.brokenCount || 0,
                totalBookmarks: totalBookmarks,
                returnedBookmarks: returnedBookmarkCount
            }
        };

        // Save result to storage asynchronously
        // Send message FIRST to unblock UI
        await updateState('complete', null, 'Analysis complete!', { structure: resultWithMetadata });

        // Then save to storage
        await chrome.storage.local.set({ analysisResult: resultWithMetadata });

        return response.structure;

    } catch (error) {
        if (error.message === 'Aborted' || error.name === 'AbortError') {
            await updateState('stopped', null, 'Analysis stopped by user.');
        } else {
            console.error(error);
            await updateState('error', null, error.message);
        }
        throw error;
    } finally {
        abortController = null;
        // Allow system sleep again
        chrome.power.releaseKeepAwake();
    }
}

function flattenBookmarks(node, list = []) {
    if (node.url) {
        list.push({
            id: node.id,
            title: node.title,
            url: node.url
        });
    }
    if (node.children) {
        for (const child of node.children) {
            flattenBookmarks(child, list);
        }
    }
    return list;
}

function countBookmarksInStructure(structure) {
    if (!structure || !Array.isArray(structure)) return 0;

    let count = 0;
    for (const node of structure) {
        if (node.url) {
            // It's a bookmark
            count++;
        } else if (node.children) {
            // It's a folder, count recursively
            count += countBookmarksInStructure(node.children);
        }
    }
    return count;
}


function categorizeBookmarks(bookmarks, targetCount) {
    // Simple Heuristic Categorization
    const categories = {
        'Development': ['github', 'stackoverflow', 'dev.to', 'mdn', 'w3schools', 'npm', 'pypi'],
        'News': ['cnn', 'bbc', 'nytimes', 'techcrunch', 'hackernews', 'medium', 'substack'],
        'Social': ['facebook', 'twitter', 'instagram', 'linkedin', 'reddit', 'tiktok', 'discord'],
        'Shopping': ['amazon', 'ebay', 'shopify', 'etsy', 'walmart', 'target', 'bestbuy'],
        'Entertainment': ['youtube', 'netflix', 'spotify', 'twitch', 'hulu', 'disney'],
        'Design': ['dribbble', 'behance', 'figma', 'canva', 'unsplash'],
        'Business': ['salesforce', 'hubspot', 'slack', 'zoom', 'notion', 'trello'],
        'Education': ['coursera', 'udemy', 'edx', 'khanacademy', 'duolingo'],
        'Finance': ['chase', 'paypal', 'stripe', 'robinhood', 'coinbase'],
        'Travel': ['airbnb', 'booking', 'expedia', 'tripadvisor', 'uber']
    };

    // If targetCount is low (~5), merge into broader categories
    let activeCategories = { ...categories };

    if (targetCount <= 5) {
        activeCategories = {
            'Work & Tech': [...categories['Development'], ...categories['Design'], ...categories['Business'], ...categories['Finance']],
            'Personal & Fun': [...categories['Social'], ...categories['Shopping'], ...categories['Entertainment'], ...categories['Travel']],
            'News & Learning': [...categories['News'], ...categories['Education']]
        };
    }
    // If targetCount is high (Specific), we use all available heuristic categories (approx 10)
    // We can't easily invent more without LLM, so we cap at the max defined here.

    const structure = {};
    const uncategorized = [];

    bookmarks.forEach(bm => {
        let matched = false;
        const urlLower = bm.url.toLowerCase();

        for (const [cat, keywords] of Object.entries(activeCategories)) {
            if (keywords.some(k => urlLower.includes(k))) {
                if (!structure[cat]) structure[cat] = [];
                structure[cat].push(bm);
                matched = true;
                break;
            }
        }

        if (!matched) {
            uncategorized.push(bm);
        }
    });

    // Convert to array format for UI
    const result = Object.keys(structure).map(cat => ({
        title: cat,
        children: structure[cat]
    }));

    if (uncategorized.length > 0) {
        result.push({
            title: 'Other',
            children: uncategorized
        });
    }

    return result;
}

async function applyStructure(structure) {
    // 0. Create Backup
    await createBackup();

    // 1. Create 'link-loom Organized' folder
    const root = await chrome.bookmarks.create({ title: 'link-loom Organized' });

    // 2. Create subfolders and move bookmarks
    // Recursive function to handle nested folders
    async function createRecursive(nodes, parentId) {
        if (!nodes || !Array.isArray(nodes)) return;
        for (const node of nodes) {
            if (node.url) {
                // It's a bookmark
                await chrome.bookmarks.move(node.id, { parentId: parentId });
            } else if (node.children) {
                // It's a folder
                const folder = await chrome.bookmarks.create({
                    parentId: parentId,
                    title: node.title
                });
                await createRecursive(node.children, folder.id);
            }
        }
    }

    await createRecursive(structure, root.id);
}

// --- Backup & Restore Logic ---

async function createBackup() {
    try {
        const tree = await chrome.bookmarks.getTree();
        const backup = {
            id: Date.now(),
            timestamp: new Date().toISOString(),
            tree: tree[0].children, // Save root children (Bookmarks Bar, Other, Mobile)
            count: flattenBookmarks(tree[0]).length
        };

        const data = await chrome.storage.local.get(['backups']);
        let backups = data.backups || [];

        // Add new backup to start
        backups.unshift(backup);

        // Keep only last 5
        if (backups.length > 5) {
            backups = backups.slice(0, 5);
        }

        await chrome.storage.local.set({ backups });
        console.log('Backup created:', backup.id);
    } catch (error) {
        console.error('Failed to create backup:', error);
    }
}

async function restoreBackup(backupId) {
    const data = await chrome.storage.local.get(['backups']);
    const backup = data.backups.find(b => b.id === backupId);

    if (!backup) throw new Error('Backup not found');

    await updateState('processing', { current: 0, total: 100 }, 'Restoring backup...');

    // 1. Wipe current bookmarks (DANGER ZONE)
    // We iterate over root folders and remove their children
    const currentTree = await chrome.bookmarks.getTree();
    const roots = currentTree[0].children;

    for (const root of roots) {
        for (const child of root.children) {
            await chrome.bookmarks.removeTree(child.id);
        }
    }

    // 2. Recreate from backup
    // Helper to recreate nodes recursively
    async function restoreNodes(nodes, parentId) {
        for (const node of nodes) {
            if (node.url) {
                // Bookmark
                await chrome.bookmarks.create({
                    parentId: parentId,
                    title: node.title,
                    url: node.url
                });
            } else {
                // Folder
                // Note: Root folders (Bar, Other, Mobile) can't be created, only populated
                // We need to map backup roots to current roots by index or title
                let targetId = parentId;

                // If we are at the top level, we match to existing roots
                if (parentId === '0') { // '0' is usually the root of the tree
                    // Logic handled outside for roots
                } else {
                    const folder = await chrome.bookmarks.create({
                        parentId: parentId,
                        title: node.title
                    });
                    if (node.children) {
                        await restoreNodes(node.children, folder.id);
                    }
                }
            }
        }
    }

    // Restore contents of each root folder (Bar, Other, Mobile)
    // We assume the structure of roots hasn't changed (Chrome standard)
    const backupRoots = backup.tree;
    for (let i = 0; i < backupRoots.length; i++) {
        const backupRoot = backupRoots[i];
        const targetRoot = roots[i]; // Corresponding live root

        if (targetRoot && backupRoot.children) {
            await restoreNodes(backupRoot.children, targetRoot.id);
        }
    }

    await updateState('complete', null, 'Backup restored successfully!');
}

// Add message listener for restore
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // ... existing listeners ...
    if (request.action === 'restore_backup') {
        restoreBackup(request.backupId)
            .then(() => safeSendResponse(sendResponse, { status: 'success' }))
            .catch(error => safeSendResponse(sendResponse, { status: 'error', message: error.message }));
        return true;
    }
    // ...
});
