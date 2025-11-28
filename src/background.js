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
initServices();

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
                safeSendResponse(sendResponse, { status: 'success', structure: structure });
            })
            .catch(error => {
                console.error(error);
                safeSendResponse(sendResponse, { status: 'error', message: error.message });
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
});

async function updateState(status, progress = null, message = null) {
    const state = { status, progress, message, timestamp: Date.now() };
    await chrome.storage.local.set({ processingState: state });

    // Send message and catch error if popup is closed
    chrome.runtime.sendMessage({ action: 'status_update', state })
        .catch(() => {
            // Ignore error when popup is closed
        });
}

async function analyzeBookmarks(settings) {
    try {
        await updateState('processing', { current: 0, total: 0 }, 'Starting analysis...');

        // 1. Fetch all bookmarks
        const tree = await chrome.bookmarks.getTree();
        const flatBookmarks = flattenBookmarks(tree[0]);
        const totalBookmarks = flatBookmarks.length;

        // Check if Premium/High Granularity is requested
        if (settings.granularity === 'high') {
            // --- PREMIUM FLOW ---

            // Pass 1: Deep Scrape with Firecrawl
            // Limit to 50 for testing
            const bookmarksToAnalyze = flatBookmarks.slice(0, 50);

            await updateState('processing', { current: 0, total: bookmarksToAnalyze.length }, `Found ${totalBookmarks} bookmarks. Processing first 50...`);

            // Small delay to let user read the message
            await new Promise(resolve => setTimeout(resolve, 1500));

            const enrichedBookmarks = await firecrawl.batchScrape(bookmarksToAnalyze, (current, total, url) => {
                updateState('processing', { current, total }, `Scraping: ${url}`);
            });

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
                organized = await clustering.organize(validBookmarks, settings.granularity, (msg) => {
                    updateState('processing', { current: totalValid, total: totalValid }, msg);
                });
            }

            // Append Broken Links folder if any
            if (brokenLinks.length > 0) {
                organized.push({
                    title: "⚠️ Broken Links (Review)",
                    children: brokenLinks
                });
            }

            // Save result to storage so popup can retrieve it
            await chrome.storage.local.set({ analysisResult: organized });

            await updateState('complete', null, `Analysis complete! Found ${brokenLinks.length} broken links.`);
            return organized;

        } else {
            // --- FREE FLOW (Heuristic) ---
            await updateState('processing', null, 'Running heuristic analysis...');
            const result = categorizeBookmarks(flatBookmarks, settings.granularity);
            await updateState('complete', null, 'Analysis complete!');
            return result;
        }
    } catch (error) {
        await updateState('error', null, error.message);
        throw error;
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

function categorizeBookmarks(bookmarks, granularity) {
    // Simple Heuristic Categorization
    const categories = {
        'Development': ['github', 'stackoverflow', 'dev.to', 'mdn', 'w3schools'],
        'News': ['cnn', 'bbc', 'nytimes', 'techcrunch', 'hackernews'],
        'Social': ['facebook', 'twitter', 'instagram', 'linkedin', 'reddit'],
        'Shopping': ['amazon', 'ebay', 'shopify', 'etsy'],
        'Entertainment': ['youtube', 'netflix', 'spotify', 'twitch']
    };

    // If granularity is 'low' (Free tier default), merge some categories
    let activeCategories = { ...categories };
    if (granularity === 'low') {
        activeCategories = {
            'Work & Tech': [...categories['Development'], ...categories['News']],
            'Personal': [...categories['Social'], ...categories['Shopping'], ...categories['Entertainment']]
        };
    }

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
