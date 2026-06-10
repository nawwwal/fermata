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
  // Toolbar badge mirrors the tab's clock state: HOLD while a fermata is
  // dropped, the rate while off 1×, empty at a tempo.
  if (msg.type === 'fermata-badge' && sender.tab && sender.tab.id) {
    chrome.action.setBadgeBackgroundColor({ tabId: sender.tab.id, color: '#ffb000' });
    if (chrome.action.setBadgeTextColor)
      chrome.action.setBadgeTextColor({ tabId: sender.tab.id, color: '#16140f' });
    chrome.action.setBadgeText({ tabId: sender.tab.id, text: msg.text || '' });
  }
});
