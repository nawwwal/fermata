// Fermata — service worker.

chrome.action.onClicked.addListener((tab) => {
  if (!tab.id) return;
  chrome.tabs.sendMessage(tab.id, { type: 'fermata-toggle' }).catch(() => {
    // Content script not present (chrome:// pages, store, etc.) — nothing to do.
  });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg && msg.type) {
    case 'fermata-capture': {
      if (!sender.tab) { sendResponse({ ok: false, err: 'no tab' }); return false; }
      chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'png' }, (url) => {
        const err = chrome.runtime.lastError;
        sendResponse(err ? { ok: false, err: err.message } : { ok: true, url });
      });
      return true; // async
    }
    case 'fermata-storyboard':
      chrome.tabs.create({ url: chrome.runtime.getURL('pages/storyboard.html') });
      return false;
    case 'fermata-badge':
      // Toolbar badge mirrors the tab's clock state: HELD while a fermata is
      // dropped, the rate while off 1×, empty at a tempo.
      if (sender.tab && sender.tab.id) {
        chrome.action.setBadgeBackgroundColor({ tabId: sender.tab.id, color: '#ffb000' });
        if (chrome.action.setBadgeTextColor)
          chrome.action.setBadgeTextColor({ tabId: sender.tab.id, color: '#16140f' });
        chrome.action.setBadgeText({ tabId: sender.tab.id, text: msg.text || '' });
      }
      return false;
    default:
      return false;
  }
});
