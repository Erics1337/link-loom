// Test script for LinkLoom categorization logic

// Mock data
const mockBookmarks = [
    { id: '1', title: 'GitHub', url: 'https://github.com/ericswanson' },
    { id: '2', title: 'Stack Overflow', url: 'https://stackoverflow.com/questions/123' },
    { id: '3', title: 'NY Times', url: 'https://www.nytimes.com' },
    { id: '4', title: 'Unknown Site', url: 'https://example.com' },
    { id: '5', title: 'Amazon', url: 'https://www.amazon.com/product' }
];

// Logic copied from background.js for testing purposes
function categorizeBookmarks(bookmarks, granularity) {
    // Simple Heuristic Categorization
    const categories = {
        'Development': ['github', 'stackoverflow', 'dev.to', 'mdn', 'w3schools'],
        'News': ['cnn', 'bbc', 'nytimes', 'techcrunch', 'hackernews'],
        'Social': ['facebook', 'twitter', 'instagram', 'linkedin', 'reddit'],
        'Shopping': ['amazon', 'ebay', 'shopify', 'etsy'],
        'Entertainment': ['youtube', 'netflix', 'spotify', 'twitch']
    };

    const structure = {};
    const uncategorized = [];

    bookmarks.forEach(bm => {
        let matched = false;
        const urlLower = bm.url.toLowerCase();

        for (const [cat, keywords] of Object.entries(categories)) {
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

// Run Test
console.log('Running Categorization Test...');
const result = categorizeBookmarks(mockBookmarks, 'medium');

console.log(JSON.stringify(result, null, 2));

// Assertions
const devCat = result.find(c => c.title === 'Development');
if (devCat && devCat.children.length === 2) {
    console.log('✅ Development category correct');
} else {
    console.error('❌ Development category failed');
}

const shopCat = result.find(c => c.title === 'Shopping');
if (shopCat && shopCat.children.length === 1) {
    console.log('✅ Shopping category correct');
} else {
    console.error('❌ Shopping category failed');
}

const otherCat = result.find(c => c.title === 'Other');
if (otherCat && otherCat.children.length === 1) {
    console.log('✅ Other category correct');
} else {
    console.error('❌ Other category failed');
}
