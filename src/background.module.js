// LinkLoom Background Service
import { FirecrawlService } from './services/firecrawl.js';
import { ClusteringService } from './services/clustering.js';

// Initialize Services (TODO: Get keys from storage/options)
const firecrawl = new FirecrawlService(null); // Pass API Key here
const clustering = new ClusteringService(null); // Pass API Key here

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'analyze_bookmarks') {
        analyzeBookmarks(request.settings)
            .then(structure => {
                sendResponse({ status: 'success', structure: structure });
            })
            .catch(error => {
                console.error(error);
                sendResponse({ status: 'error', message: error.message });
            });
        return true; // Keep channel open for async response
    }

    if (request.action === 'apply_structure') {
        applyStructure(request.structure)
            .then(() => {
                sendResponse({ status: 'success' });
            })
            .catch(error => {
                sendResponse({ status: 'error', message: error.message });
            });
        return true;
    }
});

async function analyzeBookmarks(settings) {
    // 1. Fetch all bookmarks
    const tree = await chrome.bookmarks.getTree();
    const flatBookmarks = flattenBookmarks(tree[0]);

    // Check if Premium/High Granularity is requested
    if (settings.granularity === 'high') {
        // --- PREMIUM FLOW ---

        // Pass 1: Deep Scrape with Firecrawl
        // We limit to 10 bookmarks for the prototype to be fast/safe
        const bookmarksToAnalyze = flatBookmarks.slice(0, 10);
        const enrichedBookmarks = await firecrawl.batchScrape(bookmarksToAnalyze);

        // Pass 2 & 3: Clustering & Assignment
        const organized = await clustering.organize(enrichedBookmarks, settings.granularity);
        return organized;

    } else {
        // --- FREE FLOW (Heuristic) ---
        return categorizeBookmarks(flatBookmarks, settings.granularity);
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
