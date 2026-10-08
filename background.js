importScripts("lib/sync.js", "lib/script-status.js", "lib/toolbar.js");

// Reconcile existing tabs whenever the service worker starts, including reloads.
void refreshAllToolbarBadges();

function rememberReferenceTabUrl(url) {
  if (!cusUserScripts.isWebUrl(url)) return;
  chrome.storage.session
    .set({ [CUS_REFERENCE_TAB_URL_KEY]: url })
    .catch(() => {});
}

chrome.tabs.onActivated.addListener((activeInfo) => {
  void refreshToolbarBadge(activeInfo.tabId);
  chrome.tabs
    .get(activeInfo.tabId)
    .then((tab) => rememberReferenceTabUrl(tab.url))
    .catch(() => {});
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url !== undefined || changeInfo.status) {
    void refreshToolbarBadge(tabId);
  }
  if (!tab.active) return;
  rememberReferenceTabUrl(changeInfo.url || tab.url);
});

chrome.runtime.onInstalled.addListener(() => {
  scheduleRegistrySync();
  chrome.tabs
    .query({ active: true, lastFocusedWindow: true })
    .then(([tab]) => rememberReferenceTabUrl(tab?.url));
});

let registrySyncChain = Promise.resolve();

function scheduleRegistrySync() {
  registrySyncChain = registrySyncChain
    .then(() => syncUserScriptsRegistry())
    .catch((error) => {
      console.error("[cus:user-script] registry sync failed", error);
    })
    .then(() => refreshAllToolbarBadges());
  return registrySyncChain;
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.userScripts || changes.commonUtils)) {
    scheduleRegistrySync();
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "cus:sync-registry") return;
  scheduleRegistrySync().then(() => sendResponse({ ok: true }));
  return true;
});

chrome.runtime.onStartup.addListener(() => {
  scheduleRegistrySync();
  chrome.tabs
    .query({ active: true, lastFocusedWindow: true })
    .then(([tab]) => rememberReferenceTabUrl(tab?.url));
});
