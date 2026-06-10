// Fermata — service worker.

chrome.action.onClicked.addListener((tab) => {
  if (!tab.id) return;
  chrome.tabs.sendMessage(tab.id, { type: 'fermata-toggle' }).catch(() => {
    // Content script not present (chrome:// pages, store, etc.) — nothing to do.
  });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'fermata-capture') {
    chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'png' }, (url) => {
      const err = chrome.runtime.lastError;
      sendResponse(err ? { ok: false, err: err.message } : { ok: true, url });
    });
    return true; // async
  }
  if (msg.type === 'fermata-storyboard') {
    chrome.tabs.create({ url: chrome.runtime.getURL('pages/storyboard.html') });
  }
});
