(function userScriptsTeardownBridge() {
  if (!/^https?:$/i.test(location.protocol)) return;

  const TEARDOWN_TYPE = "[cus] user-script-teardown";

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.userScripts) {
      notifyTeardownForPreviousScripts(changes.userScripts);
      return;
    }
    if (changes.commonUtils) {
      chrome.storage.local
        .get("userScripts")
        .then(({ userScripts = [] }) => notifyTeardownForScripts(userScripts))
        .catch((error) => {
          console.warn("[cus:user-script] common utils teardown failed", error);
        });
    }
  });

  function notifyTeardownForPreviousScripts(change) {
    const oldScripts = Array.isArray(change.oldValue) ? change.oldValue : [];
    notifyTeardownForScripts(oldScripts);
  }

  function notifyTeardownForScripts(scripts) {
    for (const script of scripts) {
      if (!script?.id || !script.enabled) continue;
      window.postMessage({ type: TEARDOWN_TYPE, scriptId: script.id }, "*");
    }
  }
})();
