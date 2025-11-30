// LinkLoom Background Service
import { FirecrawlService } from './services/firecrawl.js';
import { ClusteringService } from './services/clustering.js';

// Initialize Services with keys from storage
let firecrawl;
let clustering;

async function initServices() {
    const data = await chrome.storage.local.get(['firecrawlKey', 'llmKey']);
    firecrawl = new FirecrawlService(data.firecrawlKey);
    clustering = new ClusteringService(data.llmKey);
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
        if (firecrawl) {
            firecrawl.setFallbackMode(true);
            console.log('Switched to Metadata Mode (Fallback) via user request.');
            safeSendResponse(sendResponse, { status: 'success' });
        } else {
            safeSendResponse(sendResponse, { status: 'error', message: 'Service not initialized' });
        }
        return true;
    }
});

async function updateState(status, progress = null, message = null) {
    const state = { status, progress, message, timestamp: Date.now() };

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
        if (!clustering || !firecrawl) {
            console.warn('Services not initialized, attempting to initialize...');
            await initServices();
            if (!clustering || !firecrawl) {
                throw new Error("Services failed to initialize. Please reload the extension.");
            }
        }

        // 1. Fetch all bookmarks
        const tree = await chrome.bookmarks.getTree();
        const flatBookmarks = flattenBookmarks(tree[0]);
        const totalBookmarks = flatBookmarks.length;

        // 1.5 Detect duplicates by URL
        const urlMap = new Map();
        const duplicateIds = new Set();
        let duplicateCount = 0;

        flatBookmarks.forEach(bm => {
            if (urlMap.has(bm.url)) {
                // This is a duplicate - mark it
                bm.isDuplicate = true;
                duplicateIds.add(bm.id);
                duplicateCount++;
            } else {
                // First occurrence
                urlMap.set(bm.url, bm.id);
                bm.isDuplicate = false;
            }
        });

        // Check if LLM Service is available (Premium Flow)
        if (clustering && clustering.apiKey) {
            // --- PREMIUM FLOW (LLM) ---

            if (signal.aborted) throw new Error('Aborted');

            // Pass 1: Deep Scrape with Firecrawl
            // Process ALL bookmarks
            const bookmarksToAnalyze = flatBookmarks;

            await updateState('processing', { current: 0, total: bookmarksToAnalyze.length }, `Found ${totalBookmarks} bookmarks. Starting analysis...`);

            // Small delay to let user read the message
            await new Promise(resolve => setTimeout(resolve, 1500));

            if (signal.aborted) throw new Error('Aborted');

            let enrichedBookmarks = [];

            // Check Analysis Mode
            if (settings.analysisMode === 'metadata') {
                await updateState('processing', { current: 0, total: bookmarksToAnalyze.length }, `Metadata Mode: Skipping deep crawl...`);

                // Fast Metadata Generation
                enrichedBookmarks = bookmarksToAnalyze.map(bm => {
                    // Generate fallback content locally
                    let fallbackContent = '';
                    try {
                        const urlObj = new URL(bm.url);
                        fallbackContent = `
# ${urlObj.hostname}
URL: ${bm.url}
Domain: ${urlObj.hostname}
Path: ${urlObj.pathname}
Note: Metadata Mode. Categorize based on domain and URL structure.
`;
                    } catch (e) {
                        fallbackContent = `URL: ${bm.url} (Invalid)`;
                    }

                    return {
                        ...bm,
                        content: fallbackContent,
                        scrapeStatus: 'fallback',
                        scrapedTitle: null,
                        isDuplicate: bm.isDuplicate || false
                    };
                });

                await new Promise(resolve => setTimeout(resolve, 1000)); // UX delay

            } else {
                // Hybrid / Deep Crawl Mode
                let quotaWarningSent = false;
                // Reset fallback mode at start of scan
                firecrawl.setFallbackMode(false);

                enrichedBookmarks = await firecrawl.batchScrape(bookmarksToAnalyze, (current, total, url, result) => {
                    if (signal.aborted) return;
                    updateState('processing', { current, total }, `Scraping: ${url}`);

                    // Check for quota/rate limit in real-time
                    if (result && result.quotaExceeded && !quotaWarningSent) {
                        quotaWarningSent = true;
                        chrome.runtime.sendMessage({
                            action: 'quota_exceeded_warning',
                            message: 'Firecrawl rate limit reached.'
                        });
                    }
                }, signal);

                // Check for quota exceeded in results (double check)
                const quotaHit = enrichedBookmarks.some(bm => bm.quotaExceeded);
                if (quotaHit && !quotaWarningSent) {
                    chrome.runtime.sendMessage({
                        action: 'quota_exceeded_warning',
                        message: 'Firecrawl token limit reached. Switched to Metadata Mode.'
                    });
                }
            }

            if (signal.aborted) throw new Error('Aborted');

            // Separate dead links
            const validBookmarks = [];
            const brokenLinks = [];

            enrichedBookmarks.forEach(bm => {
                if (bm.scrapeStatus === 'dead') {
                    brokenLinks.push(bm);
                } else {
                    validBookmarks.push(bm);
                }
            });

            if (brokenLinks.length > 0) {
                await updateState('processing', { current: bookmarksToAnalyze.length, total: bookmarksToAnalyze.length }, `Found ${brokenLinks.length} broken links...`);
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            // Pass 2 & 3: Clustering & Assignment
            const totalValid = validBookmarks.length;
            await updateState('processing', { current: totalValid, total: totalValid }, 'Analyzing structure with LLM...');

            let organized = [];
            if (totalValid > 0) {
                // Pass signal to clustering service
                // Pass the target count from settings
                const targetCount = settings.granularity.count || 10;
                organized = await clustering.organize(validBookmarks, targetCount, (msg, progress) => {
                    if (signal.aborted) return;
                    updateState('processing', progress || { current: totalValid, total: totalValid }, msg);
                }, signal);
            }

            if (signal.aborted) throw new Error('Aborted');

            // Append Broken Links folder if any
            if (brokenLinks.length > 0) {
                // Optimize broken links: Remove heavy 'content' before adding
                const optimizedBroken = brokenLinks.map(bm => ({
                    id: bm.id,
                    title: bm.title,
                    url: bm.url,
                    scrapeStatus: bm.scrapeStatus,
                    error: bm.error
                }));

                organized.push({
                    title: "⚠️ Broken Links (Review)",
                    children: optimizedBroken
                });
            }

            // Add metadata for UI stats
            const resultWithMetadata = {
                structure: organized,
                metadata: {
                    duplicateCount: duplicateCount,
                    brokenCount: brokenLinks.length,
                    totalBookmarks: totalBookmarks
                }
            };

            // Add status update for saving
            await updateState('processing', { current: 100, total: 100 }, 'Saving results...');

            // Save result to storage asynchronously (Fire and Forget)
            chrome.storage.local.set({ analysisResult: resultWithMetadata }).catch(err => {
                console.error('Failed to save analysis result:', err);
            });

            return organized;

        } else {
            // --- FREE FLOW (Heuristic) ---
            if (abortController?.signal.aborted) throw new Error('Aborted');
            await updateState('processing', null, 'Running heuristic analysis...');

            // Extract count from settings
            const targetCount = settings.granularity.count || 10;
            const result = categorizeBookmarks(flatBookmarks, targetCount);

            // Save result to storage (consistent with Premium Flow)
            const resultWithMetadata = {
                structure: result,
                metadata: {
                    duplicateCount: duplicateCount,
                    brokenCount: 0, // Heuristic doesn't check broken
                    totalBookmarks: totalBookmarks
                }
            };
            await chrome.storage.local.set({ analysisResult: resultWithMetadata });

            await updateState('complete', null, 'Analysis complete!');
            return result;
        }
    } catch (error) {
        if (error.message === 'Aborted' || error.name === 'AbortError') {
            await updateState('stopped', null, 'Analysis stopped by user.');
        } else {
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

    // 1. Create 'LinkLoom Organized' folder
    const root = await chrome.bookmarks.create({ title: 'LinkLoom Organized' });

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
