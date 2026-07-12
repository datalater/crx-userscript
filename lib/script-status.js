const STORAGE_KEY = "userScripts";
const COMMON_UTILS_STORAGE_KEY = "commonUtils";

const STATUS = {
  DISABLED: "disabled",
  API_UNAVAILABLE: "api_unavailable",
  PATTERN_INVALID: "pattern_invalid",
  CODE_EMPTY: "code_empty",
  TAB_MISMATCH: "tab_mismatch",
  NOT_REGISTERED: "not_registered",
  REGISTERED: "registered",
};

function evaluateScriptStatus(script, context) {
  const { tabUrl, registeredIds, apiAvailable } = context;

  if (!script?.enabled) return STATUS.DISABLED;
  if (!apiAvailable) return STATUS.API_UNAVAILABLE;

  const pattern = String(script.matchPattern || "").trim();
  if (!pattern || !cusUserScripts.matchPatternToRegExp(pattern)) {
    return STATUS.PATTERN_INVALID;
  }
  if (!cusUserScripts.hasRunnablePageScriptCode(script)) return STATUS.CODE_EMPTY;

  if (tabUrl && !cusUserScripts.urlMatchesPattern(pattern, tabUrl)) {
    return STATUS.TAB_MISMATCH;
  }

  const registryId = `cus-${script.id}`;
  if (!registeredIds?.has(registryId)) return STATUS.NOT_REGISTERED;

  return STATUS.REGISTERED;
}

function statusIndicatorClass(status) {
  if (status === STATUS.DISABLED) return "disabled";
  if (status === STATUS.REGISTERED) return "registered";
  if (status === STATUS.TAB_MISMATCH) return "warn";
  return "error";
}

function getScriptStatusMessage(scope, status) {
  const key = `${scope}_status_${status}`;
  return chrome.i18n.getMessage(key) || status;
}

function getScriptLabel(script) {
  if (script.name?.trim()) return script.name.trim();
  const pattern = script.matchPattern || "";
  try {
    const host = pattern.replace(/^https\?\:\/\//i, "").split("/")[0];
    if (host) return host;
  } catch {
    /* ignore */
  }
  return script.id || "script";
}

function formatTabLabel(url) {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    if (!/^https?:$/i.test(parsed.protocol)) return url;
    const path = parsed.pathname === "/" ? "" : parsed.pathname;
    return `${parsed.host}${path}`;
  } catch {
    return url;
  }
}

globalThis.CUS_STORAGE_KEY = STORAGE_KEY;
globalThis.CUS_COMMON_UTILS_STORAGE_KEY = COMMON_UTILS_STORAGE_KEY;
globalThis.CUS_REFERENCE_TAB_URL_KEY = "referenceTabUrl";
globalThis.CUS_FOCUS_SCRIPT_ID_KEY = "focusScriptId";
globalThis.CUS_STATUS = STATUS;
globalThis.evaluateScriptStatus = evaluateScriptStatus;
globalThis.statusIndicatorClass = statusIndicatorClass;
globalThis.getScriptStatusMessage = getScriptStatusMessage;
globalThis.getScriptLabel = getScriptLabel;
globalThis.formatTabLabel = formatTabLabel;
