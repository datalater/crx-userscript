const pageStatusEl = document.getElementById("page-status");
const apiWarningEl = document.getElementById("api-warning");
const pageRuleEl = document.getElementById("page-rule");
const patternInputEl = document.getElementById("pattern-input");
const patternHintEl = document.getElementById("pattern-hint");
const summaryEl = document.getElementById("summary");
const listEl = document.getElementById("script-list");
const emptyListHintEl = document.getElementById("empty-list-hint");
const otherCountEl = document.getElementById("other-count");

let activeTab = null;
let defaultPattern = "https?://*/*";
let cachedUserScripts = [];
/** @type {string | null} */
let pendingEditScriptId = null;

initI18n();
init();

document.getElementById("btn-options").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

document.getElementById("btn-reload").addEventListener("click", async () => {
  if (!activeTab?.id || !isReloadableUrl(activeTab.url)) return;
  await chrome.tabs.reload(activeTab.id);
  window.close();
});

document.getElementById("btn-add").addEventListener("click", () => {
  if (pendingEditScriptId) {
    openOptionsForScript(pendingEditScriptId);
    return;
  }
  addScriptForPage();
});

patternInputEl.addEventListener("input", updatePatternHint);

otherCountEl.addEventListener("click", (event) => {
  if (event.target.closest('[data-action="options"]')) {
    chrome.runtime.openOptionsPage();
    window.close();
  }
});

async function init() {
  activeTab = await getActiveTab();
  await rememberReferenceTabUrl(activeTab?.url);
  renderPageRule();
  renderApiWarning();
  await renderList();
}

async function rememberReferenceTabUrl(url) {
  if (!isReloadableUrl(url)) return;
  try {
    await chrome.storage.session.set({ [CUS_REFERENCE_TAB_URL_KEY]: url });
  } catch {
    /* ignore */
  }
}

function initI18n() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const message = chrome.i18n.getMessage(el.getAttribute("data-i18n"));
    if (!message) return;
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      el.placeholder = message;
    } else {
      el.textContent = message;
    }
  });
}

function msg(key, fallback) {
  return chrome.i18n.getMessage(key) || fallback;
}

async function getActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab ?? null;
  } catch {
    return null;
  }
}

function isReloadableUrl(url) {
  return cusUserScripts.isWebUrl(url);
}

function isUserScriptsApiAvailable() {
  try {
    chrome.userScripts.getScripts();
    return true;
  } catch {
    return false;
  }
}

function renderPageRule() {
  const tabUrl = isReloadableUrl(activeTab?.url) ? activeTab.url : "";
  const canUsePage = Boolean(tabUrl);

  pageRuleEl.hidden = !canUsePage;
  document.getElementById("btn-reload").disabled = !canUsePage;

  if (!canUsePage) {
    setAddButtonMode({ disabled: true });
    pageStatusEl.textContent = msg("popup_no_http_tab", "http(s) 웹 페이지 탭이 아닙니다");
    pageStatusEl.classList.add("page-status--muted");
    return;
  }

  defaultPattern = cusUserScripts.urlToMatchPattern(tabUrl);
  patternInputEl.value = defaultPattern;
  updatePatternHint();
}

function setAddButtonMode({ disabled, editScriptId = null }) {
  const btnAdd = document.getElementById("btn-add");
  pendingEditScriptId = editScriptId;
  btnAdd.disabled = disabled;
  btnAdd.textContent = editScriptId
    ? msg("popup_edit_script", "스크립트 수정")
    : msg("popup_add_script", "스크립트 추가");
}

function showPatternHint(text, tone = "error") {
  patternHintEl.hidden = false;
  patternHintEl.textContent = text;
  patternHintEl.classList.toggle("page-rule__hint--error", tone === "error");
  patternHintEl.classList.toggle("page-rule__hint--info", tone === "info");
}

function clearPatternHint() {
  patternHintEl.hidden = true;
  patternHintEl.textContent = "";
  patternHintEl.classList.remove("page-rule__hint--error", "page-rule__hint--info");
}

function updatePatternHint() {
  const pattern = patternInputEl.value.trim();
  const tabUrl = isReloadableUrl(activeTab?.url) ? activeTab.url : "";
  const re = cusUserScripts.matchPatternToRegExp(pattern);

  clearPatternHint();
  patternInputEl.classList.remove("is-invalid");

  if (!pattern) {
    showPatternHint(msg("options_match_empty", "패턴을 입력하세요."), "error");
    patternInputEl.classList.add("is-invalid");
    setAddButtonMode({ disabled: true });
    return;
  }

  if (!re) {
    showPatternHint(
      msg("options_match_invalid", "패턴 형식이 올바르지 않습니다."),
      "error"
    );
    patternInputEl.classList.add("is-invalid");
    setAddButtonMode({ disabled: true });
    return;
  }

  const existing = cusUserScripts.findScriptWithMatchPattern(
    pattern,
    cachedUserScripts
  );
  if (existing) {
    showPatternHint(
      msg("popup_pattern_registered", "이 URL 패턴의 스크립트가 이미 있어요."),
      "info"
    );
    setAddButtonMode({ disabled: false, editScriptId: existing.id });
    return;
  }

  setAddButtonMode({ disabled: !tabUrl });

  if (tabUrl && !cusUserScripts.urlMatchesPattern(pattern, tabUrl)) {
    showPatternHint(
      msg("popup_pattern_no_match", "현재 탭 URL과 맞지 않습니다."),
      "error"
    );
  }
}

function renderApiWarning() {
  const apiOk = isUserScriptsApiAvailable();
  apiWarningEl.hidden = apiOk;
  if (!apiOk) {
    apiWarningEl.textContent =
      msg("popup_api_warning", "chrome://extensions에서 「사용자 스크립트 허용」을 켜 주세요.");
  }
}

function renderPageStatus(matchingCount, enabledCount) {
  const tabUrl = isReloadableUrl(activeTab?.url) ? activeTab.url : "";
  if (!tabUrl) return;

  pageStatusEl.classList.remove("page-status--muted");

  if (matchingCount === 0) {
    pageStatusEl.textContent = msg(
      "popup_page_status_none",
      "이 페이지에 맞는 스크립트가 없습니다."
    );
    return;
  }

  if (enabledCount === 0) {
    pageStatusEl.textContent = msg(
      "popup_page_status_disabled",
      "이 페이지용 스크립트가 있지만 모두 비활성입니다."
    );
    return;
  }

  pageStatusEl.textContent =
    chrome.i18n.getMessage("popup_page_status_active", [
      String(matchingCount),
      String(enabledCount),
    ]) ||
    `이 페이지에 스크립트 ${matchingCount}개(활성 ${enabledCount}개)가 있습니다.`;
}

async function requestRegistrySync() {
  try {
    await chrome.runtime.sendMessage({ type: "cus:sync-registry" });
  } catch (error) {
    console.warn("[popup] registry sync message failed", error);
  }
}

async function getRegisteredIds() {
  if (!isUserScriptsApiAvailable()) return new Set();
  const registered = await chrome.userScripts.getScripts();
  return new Set(
    registered.filter((s) => s.id.startsWith("cus-")).map((s) => s.id)
  );
}

async function renderList() {
  const { userScripts = [] } = await chrome.storage.local.get(CUS_STORAGE_KEY);
  cachedUserScripts = userScripts.map((script) =>
    cusUserScripts.normalizePageScript(script)
  );
  updatePatternHint();

  const tabUrl = isReloadableUrl(activeTab?.url) ? activeTab.url : "";
  const registeredIds = await getRegisteredIds();
  const apiAvailable = isUserScriptsApiAvailable();

  const context = { tabUrl, registeredIds, apiAvailable };
  const matching = cachedUserScripts.filter(
    (script) => tabUrl && cusUserScripts.urlMatchesPattern(script.matchPattern, tabUrl)
  );
  const nonMatchingCount = tabUrl
    ? cachedUserScripts.filter(
        (s) => !cusUserScripts.urlMatchesPattern(s.matchPattern || "", tabUrl)
      ).length
    : cachedUserScripts.length;

  listEl.innerHTML = "";

  const enabledMatching = matching.filter(
    (s) => s.enabled !== false && cusUserScripts.hasRunnablePageScriptCode(s)
  ).length;
  renderPageStatus(matching.length, enabledMatching);

  const showSummary = matching.length > 0;
  summaryEl.hidden = !showSummary;
  if (showSummary) {
    summaryEl.textContent =
      chrome.i18n.getMessage("popup_summary", [
        String(matching.length),
        String(enabledMatching),
      ]) || `${matching.length}개 매칭 · ${enabledMatching}개 활성`;
  }

  emptyListHintEl.hidden = matching.length > 0 || !tabUrl;
  otherCountEl.hidden = nonMatchingCount === 0;
  if (nonMatchingCount > 0) {
    otherCountEl.innerHTML =
      chrome.i18n.getMessage("popup_other_scripts", [String(nonMatchingCount)]) ||
      `다른 URL용 스크립트 ${nonMatchingCount}개 · <span data-action="options">전체 관리</span>`;
  }

  for (const script of matching) {
    listEl.append(createScriptItem(script, context));
  }
}

function createScriptItem(script, context) {
  const li = document.createElement("li");
  li.className = "script-item";

  const status = evaluateScriptStatus(script, context);
  const indicator = document.createElement("span");
  indicator.className = `script-item__indicator script-item__indicator--${statusIndicatorClass(status)}`;

  const body = document.createElement("div");
  body.className = "script-item__body";

  const title = document.createElement("div");
  title.className = "script-item__title";
  title.textContent = getScriptLabel(script);
  title.title = script.matchPattern || "";

  const statusText = document.createElement("div");
  statusText.className = "script-item__status";
  statusText.textContent = getStatusMessage(status);

  body.append(title, statusText);

  const actions = document.createElement("div");
  actions.className = "script-item__actions";

  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "script-item__edit";
  editBtn.textContent = msg("popup_edit_code", "코드 편집");
  editBtn.addEventListener("click", () => openOptionsForScript(script.id));

  const toggle = document.createElement("input");
  toggle.type = "checkbox";
  toggle.className = "script-item__toggle";
  toggle.checked = script.enabled !== false;
  toggle.addEventListener("change", () => toggleScript(script.id, toggle.checked));

  actions.append(editBtn, toggle);
  li.append(indicator, body, actions);
  return li;
}

function getStatusMessage(status) {
  return getScriptStatusMessage("popup", status);
}

function createScriptId() {
  return `us-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function hostLabelFromPattern(pattern) {
  try {
    const host = String(pattern).replace(/^https\?\:\/\//i, "").split("/")[0];
    return host || "script";
  } catch {
    return "script";
  }
}

async function addScriptForPage() {
  const pattern = patternInputEl.value.trim();
  if (!cusUserScripts.matchPatternToRegExp(pattern)) return;

  const { userScripts = [] } = await chrome.storage.local.get(CUS_STORAGE_KEY);
  if (cusUserScripts.findScriptWithMatchPattern(pattern, userScripts)) {
    updatePatternHint();
    return;
  }
  const id = createScriptId();
  const script = cusUserScripts.normalizePageScript({
    id,
    name: hostLabelFromPattern(pattern),
    matchPattern: pattern,
    enabled: true,
    modules: [
      cusUserScripts.createEmptyPageScriptModule({
        name: "",
        code: msg("popup_default_code", "// 전체 관리에서 코드를 편집하세요."),
      }),
    ],
  });

  await chrome.storage.local.set({
    [CUS_STORAGE_KEY]: [...userScripts.map((item) => cusUserScripts.normalizePageScript(item)), script],
  });

  await requestRegistrySync();
  await renderList();
}

async function openOptionsForScript(scriptId) {
  try {
    await chrome.storage.session.set({ [CUS_FOCUS_SCRIPT_ID_KEY]: scriptId });
  } catch {
    /* ignore */
  }
  chrome.runtime.openOptionsPage();
  window.close();
}

async function toggleScript(id, enabled) {
  const { userScripts = [] } = await chrome.storage.local.get(CUS_STORAGE_KEY);
  const next = userScripts.map((script) =>
    script.id === id ? { ...script, enabled } : script
  );
  await chrome.storage.local.set({ [CUS_STORAGE_KEY]: next });
  await requestRegistrySync();
  await renderList();
}
