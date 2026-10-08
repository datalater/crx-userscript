// Serialize each tab's reads and writes so older refreshes cannot win a race.
const toolbarRefreshes = new Map();

function refreshToolbarBadge(tabId) {
  if (!Number.isInteger(tabId) || tabId < 0) return Promise.resolve();

  const previous = toolbarRefreshes.get(tabId) || Promise.resolve();
  const refresh = previous.then(() => updateToolbarBadge(tabId)).catch((error) => {
    // A tab may close while its badge is being refreshed.
    console.debug("[cus:toolbar] badge refresh skipped", tabId, error);
  });
  toolbarRefreshes.set(tabId, refresh);
  return refresh.finally(() => {
    if (toolbarRefreshes.get(tabId) === refresh) toolbarRefreshes.delete(tabId);
  });
}

async function refreshAllToolbarBadges() {
  try {
    const tabs = await chrome.tabs.query({});
    await Promise.all(tabs.map((tab) => refreshToolbarBadge(tab.id)));
  } catch (error) {
    console.warn("[cus:toolbar] could not refresh tabs", error);
  }
}

async function updateToolbarBadge(tabId) {
  const tab = await chrome.tabs.get(tabId);
  let count = 0;

  if (cusUserScripts.isWebUrl(tab.url)) {
    const { userScripts = [] } = await chrome.storage.local.get(CUS_STORAGE_KEY);
    const registeredIds = await getToolbarRegisteredIds();
    const context = { tabUrl: tab.url, registeredIds, apiAvailable: true };
    count = userScripts
      .map((script) => cusUserScripts.normalizePageScript(script))
      .filter((script) => evaluateScriptStatus(script, context) === CUS_STATUS.REGISTERED)
      .length;
  }

  await Promise.all([
    chrome.action.setBadgeBackgroundColor({ tabId, color: "#1a7f37" }),
    chrome.action.setBadgeTextColor({ tabId, color: "#ffffff" }),
    chrome.action.setBadgeText({ tabId, text: count ? String(count) : "" }),
    chrome.action.setTitle({ tabId, title: getToolbarTitle(count) }),
  ]);
}

async function getToolbarRegisteredIds() {
  try {
    const registered = await chrome.userScripts.getScripts();
    return new Set(registered.map((script) => script.id));
  } catch {
    // Missing permission/API must clear the badge, not leave a stale active count.
    return new Set();
  }
}

function getToolbarTitle(count) {
  const key = count ? "toolbar_active_scripts" : "toolbar_no_active_scripts";
  return chrome.i18n.getMessage(key, [String(count)]) || (count
    ? `User Spell — ${count} active script(s) on this page (configured, not execution status)`
    : "User Spell — No active scripts on this page");
}
