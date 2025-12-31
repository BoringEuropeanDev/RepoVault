// Service worker for background tasks

chrome.runtime.onInstalled.addListener(() => {
  console.log('RepoVault installed');
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getBookmarkCount') {
    chrome.storage.local.get('bookmarks', (result) => {
      const count = result.bookmarks ? result.bookmarks.length : 0;
      sendResponse({ count });
    });
    return true;
  }
});
