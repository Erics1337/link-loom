// Test script for Advanced Logic (Firecrawl + Clustering)
import { FirecrawlService } from './src/services/firecrawl.js';
import { ClusteringService } from './src/services/clustering.js';

// Mock Data
const mockBookmarks = [
    { id: '1', title: 'React Docs', url: 'https://react.dev' },
    { id: '2', title: 'Vue.js', url: 'https://vuejs.org' },
    { id: '3', title: 'CNN', url: 'https://cnn.com' },
    { id: '4', title: 'BBC News', url: 'https://bbc.com' },
    { id: '5', title: 'Healthy Recipes', url: 'https://recipes.com' }
];

async function runTest() {
    console.log('--- Starting Advanced Logic Test ---');

    // 1. Test Firecrawl Service (Mock)
    console.log('\nTesting FirecrawlService...');
    const firecrawl = new FirecrawlService(null); // No API Key
    const enriched = await firecrawl.batchScrape(mockBookmarks);

    if (enriched.length === 5 && enriched[0].content) {
        console.log('✅ Firecrawl batch scrape successful (Mock)');
    } else {
        console.error('❌ Firecrawl scrape failed');
    }

    // 2. Test Clustering Service (Mock)
    console.log('\nTesting ClusteringService...');
    const clustering = new ClusteringService(null); // No API Key

    // Test "High" Granularity (Should trigger ratio logic)
    const organized = await clustering.organize(enriched, 'high');

    console.log('Organized Structure:');
    console.log(JSON.stringify(organized, null, 2));

    // Verify Structure
    const devCat = organized.find(c => c.title === 'Development');
    if (devCat) {
        console.log('✅ Clustering produced expected mock categories');
    } else {
        console.error('❌ Clustering failed to produce expected categories');
    }

    console.log('\n--- Test Complete ---');
}

runTest();
