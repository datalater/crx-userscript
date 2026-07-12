importScripts("lib/match.js", "lib/common-utils.js", "lib/page-script.js");

const REGISTRY_PREFIX = "cus-";
const TEARDOWN_TYPE = "[cus] user-script-teardown";

function wrapUserScriptCode(scriptId, code) {
  const escapedId = JSON.stringify(scriptId);
  return `(function () {
  const __scriptId = ${escapedId};
  const cleanups = [];
  const registerCleanup = (fn) => {
    if (typeof fn === "function") cleanups.push(fn);
  };
  const teardown = () => {
    cleanups.forEach((fn) => {
      try {
        fn();
      } catch (error) {
        console.warn("[cus:user-script] cleanup failed", error);
      }
    });
  };
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (event.data?.type !== "${TEARDOWN_TYPE}") return;
    if (event.data.scriptId === __scriptId) teardown();
  });
  try {
    ${code}
  } catch (error) {
    console.error("[cus:user-script]", __scriptId, error);
  }
})();`;
}

function buildCombinedCode(script, commonUtils) {
  return [cusUserScripts.buildCommonUtilsCode(commonUtils), cusUserScripts.buildPageScriptCode(script)]
    .filter((code) => String(code || "").trim())
    .join("\n\n");
}

function buildUserScriptDefinition(script, commonUtils) {
  return {
    id: `${REGISTRY_PREFIX}${script.id}`,
    matches: cusUserScripts.toChromeMatchPatterns(script.matchPattern),
    js: [{ code: wrapUserScriptCode(script.id, buildCombinedCode(script, commonUtils)) }],
    runAt: "document_idle",
  };
}

async function syncUserScriptsRegistry() {
  if (!isUserScriptsApiAvailable()) {
    console.warn("[cus:user-script] chrome.userScripts API is unavailable");
    return;
  }

  const { userScripts = [], commonUtils = null } = await chrome.storage.local.get([
    "userScripts",
    "commonUtils",
  ]);
  const registered = await chrome.userScripts.getScripts();
  const registeredIds = new Set(
    registered
      .filter((script) => script.id.startsWith(REGISTRY_PREFIX))
      .map((script) => script.id)
  );

  const desired = new Map();
  for (const rawScript of userScripts) {
    const script = cusUserScripts.normalizePageScript(rawScript);
    if (!script?.id || !script.enabled) continue;
    if (!cusUserScripts.hasRunnablePageScriptCode(script)) continue;
    desired.set(`${REGISTRY_PREFIX}${script.id}`, buildUserScriptDefinition(script, commonUtils));
  }

  const toUnregister = [...registeredIds].filter((id) => !desired.has(id));
  if (toUnregister.length) {
    await chrome.userScripts.unregister({ ids: toUnregister });
    for (const id of toUnregister) registeredIds.delete(id);
  }

  for (const [id, definition] of desired) {
    try {
      if (registeredIds.has(id)) {
        await chrome.userScripts.update([definition]);
      } else {
        await chrome.userScripts.register([definition]);
        registeredIds.add(id);
      }
    } catch (error) {
      console.error("[cus:user-script] registry sync failed", id, error);
    }
  }
}

function isUserScriptsApiAvailable() {
  try {
    chrome.userScripts.getScripts();
    return true;
  } catch {
    return false;
  }
}

globalThis.syncUserScriptsRegistry = syncUserScriptsRegistry;
globalThis.isUserScriptsApiAvailable = isUserScriptsApiAvailable;
globalThis.REGISTRY_PREFIX = REGISTRY_PREFIX;
