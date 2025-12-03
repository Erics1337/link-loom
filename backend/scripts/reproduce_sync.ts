
import fetch from 'node-fetch';

async function run() {
    const userId = 'test-user-' + Date.now();
    const bookmarks = [
        { id: '1', url: 'https://example.com', title: 'Example' },
        { id: '2', url: 'https://google.com', title: 'Google' },
        { id: '3', url: 'https://example.com', title: 'Example Duplicate' } // Duplicate URL
    ];

    try {
        console.log('Sending sync request...');
        const res = await fetch('http://localhost:3000/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, bookmarks })
        });

        if (!res.ok) {
            console.error('Sync failed:', res.status, res.statusText);
            const text = await res.text();
            console.error('Response:', text);
        } else {
            const json = await res.json();
            console.log('Sync success:', json);
        }
    } catch (e) {
        console.error('Network error:', e);
    }
}

run();
