console.log('Link Loom background script loaded');

// Listen for bookmark changes
chrome.bookmarks.onCreated.addListener((_id, bookmark) => {
    console.log('Bookmark created:', bookmark);
});
