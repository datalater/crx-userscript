(function userScriptsTeardownBridge() {
  if (!/^https?:$/i.test(location.protocol)) return;

  const TEARDOWN_TYPE = "[cus] user-script-teardown";

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.userScripts) return;
    notifyTeardownForPreviousScripts(changes.userScripts);
  });

  function notifyTeardownForPreviousScripts(change) {
    const oldScripts = Array.isArray(change.oldValue) ? change.oldValue : [];

    for (const script of oldScripts) {
      if (!script?.id || !script.enabled) continue;
      window.postMessage({ type: TEARDOWN_TYPE, scriptId: script.id }, "*");
    }
  }
})();
