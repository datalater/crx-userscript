const SAVE_DEBOUNCE_MS = 350;

const VISIBILITYCHANGE_EXAMPLE = `document.addEventListener("visibilitychange", (event) => {
  console.log("event:", event.type);
  console.log("visibilityState:", document.visibilityState);
  console.log("hidden:", document.hidden);
  
  const state = document.visibilityState;
  if (state === 'visible') {
    window.location.reload();
  }
});
`;

const listEl = document.getElementById("script-list");
const pageLoadingEl = document.getElementById("page-loading");
const saveStatusEl = document.getElementById("save-status");
const importFileEl = document.getElementById("import-file");
const apiWarningEl = document.getElementById("api-warning");
const toolbarEl = document.querySelector(".toolbar");
const btnRefresh = document.getElementById("btn-refresh");

/** @type {Map<string, { editor: ReturnType<typeof createLightCodeEditor> }>} */
const rowState = new Map();

let scripts = [];
let defaultMatchPattern = "https?://*/*";
let referenceTabUrl = "";
let saveTimer = null;
let registeredIds = new Set();
let isLoading = false;

initI18n();
init();

document.getElementById("btn-add").addEventListener("click", async () => {
  const matchPattern = await resolveDefaultMatchPattern();
  const existing = listEl.querySelector(".script-card") ? collectScriptsFromDom() : scripts;

  if (cusUserScripts.findScriptWithMatchPattern(matchPattern, existing)) {
    setSaveStatus(msg("match_duplicate", "동일한 URL 패턴이 이미 등록되어 있습니다."), true);
    return;
  }

  addRow({
    ...createEmptyScript(),
    matchPattern,
  });
  scheduleSave();
});

document.getElementById("btn-export").addEventListener("click", exportScripts);
document.getElementById("btn-import").addEventListener("click", () => importFileEl.click());
importFileEl.addEventListener("change", onImportFile);
btnRefresh.addEventListener("click", () => reloadScripts());
document.addEventListener("keydown", onDocumentKeydown);

function setLoading(loading) {
  isLoading = loading;
  pageLoadingEl.hidden = !loading;
  listEl.hidden = loading;
  btnRefresh.disabled = loading;
  toolbarEl?.classList.toggle("is-disabled", loading);
  listEl.setAttribute("aria-busy", loading ? "true" : "false");
}

async function loadScriptsData({ focusFromSession = false } = {}) {
  teardownRows();
  registeredIds = await loadRegisteredIds();

  const stored = await chrome.storage.local.get(CUS_STORAGE_KEY);
  scripts = Array.isArray(stored[CUS_STORAGE_KEY]) ? stored[CUS_STORAGE_KEY] : [];

  if (!scripts.length) {
    showEmptyState();
    return;
  }

  scripts.forEach((script) => addRow(script, { persist: false }));
  if (focusFromSession) await focusScriptFromSession();
}

async function init() {
  setLoading(true);
  try {
    defaultMatchPattern = await resolveDefaultMatchPattern();
    referenceTabUrl = await resolveReferenceTabUrl();
    renderApiWarning();
    await loadScriptsData({ focusFromSession: true });
  } catch (error) {
    console.error("[options] init failed", error);
    teardownRows();
    showEmptyState();
  } finally {
    setLoading(false);
  }
}

async function reloadScripts() {
  if (isLoading) return;
  setLoading(true);
  try {
    defaultMatchPattern = await resolveDefaultMatchPattern();
    referenceTabUrl = await resolveReferenceTabUrl();
    renderApiWarning();
    await loadScriptsData({ focusFromSession: false });
  } catch (error) {
    console.error("[options] reload failed", error);
  } finally {
    setLoading(false);
  }
}

async function focusScriptFromSession() {
  let focusId;
  try {
    const stored = await chrome.storage.session.get(CUS_FOCUS_SCRIPT_ID_KEY);
    focusId = stored[CUS_FOCUS_SCRIPT_ID_KEY];
    if (focusId) await chrome.storage.session.remove(CUS_FOCUS_SCRIPT_ID_KEY);
  } catch {
    return;
  }
  if (!focusId) return;

  requestAnimationFrame(() => {
    const card = listEl.querySelector(`[data-id="${CSS.escape(focusId)}"]`);
    if (!card) return;
    card.classList.add("script-card--focus");
    card.scrollIntoView({ behavior: "smooth", block: "center" });
    rowState.get(focusId)?.editor?.focus();
  });
}

function initI18n() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const message = chrome.i18n.getMessage(el.getAttribute("data-i18n"));
    if (message) el.textContent = message;
  });
  document.querySelectorAll("[data-i18n-title]").forEach((el) => {
    const message = chrome.i18n.getMessage(el.getAttribute("data-i18n-title"));
    if (!message) return;
    el.title = message;
    el.setAttribute("aria-label", message);
  });
}

function isUserScriptsApiAvailable() {
  try {
    chrome.userScripts.getScripts();
    return true;
  } catch {
    return false;
  }
}

function renderApiWarning() {
  const ok = isUserScriptsApiAvailable();
  apiWarningEl.hidden = ok;
  if (!ok) {
    apiWarningEl.textContent =
      chrome.i18n.getMessage("options_api_warning") ||
      "chrome://extensions에서 이 확장의 「사용자 스크립트 허용」을 켜 주세요.";
  }
}

async function loadRegisteredIds() {
  if (!isUserScriptsApiAvailable()) return new Set();
  const registered = await chrome.userScripts.getScripts();
  return new Set(registered.filter((s) => s.id.startsWith("cus-")).map((s) => s.id));
}

async function requestRegistrySync() {
  try {
    await chrome.runtime.sendMessage({ type: "cus:sync-registry" });
  } catch (error) {
    console.warn("[options] registry sync message failed", error);
  }
}

async function resolveDefaultMatchPattern() {
  const url = await resolveReferenceTabUrl();
  if (url) return cusUserScripts.urlToMatchPattern(url);
  return "https?://*/*";
}

async function resolveReferenceTabUrl() {
  try {
    const stored = await chrome.storage.session.get(CUS_REFERENCE_TAB_URL_KEY);
    const remembered = stored[CUS_REFERENCE_TAB_URL_KEY];
    if (cusUserScripts.isWebUrl(remembered)) return remembered;
  } catch (error) {
    console.warn("[options] session reference tab failed", error);
  }

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (cusUserScripts.isWebUrl(tab?.url)) return tab.url;
  } catch (error) {
    console.warn("[options] tab query failed", error);
  }
  return "";
}

function showEmptyState() {
  listEl.innerHTML = "";
  const empty = document.createElement("p");
  empty.className = "empty-state";
  empty.textContent =
    chrome.i18n.getMessage("options_empty") ||
    "스크립트가 없습니다. 「스크립트 추가」를 눌러 시작하세요.";
  listEl.append(empty);
}

function createEmptyScript() {
  return {
    id: createScriptId(),
    name: "",
    matchPattern: defaultMatchPattern,
    enabled: true,
    code: "",
  };
}

function createScriptId() {
  return `us-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function addRow(script, options = {}) {
  const { persist = true } = options;

  if (!listEl.querySelector(".script-card")) {
    listEl.innerHTML = "";
  }

  const card = document.createElement("article");
  card.className = "script-card";
  card.dataset.id = script.id;

  const header = document.createElement("header");
  header.className = "script-card__header";

  const meta = document.createElement("div");
  meta.className = "script-card__meta";

  const nameField = document.createElement("div");
  nameField.innerHTML = `<label>${msg("options_name_label", "이름")}</label>`;
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.value = script.name || "";
  nameInput.placeholder = msg("options_name_placeholder", "예: ChatGPT 새로고침");
  nameField.append(nameInput);

  const matchField = document.createElement("div");
  matchField.className = "script-card__match";
  matchField.innerHTML = `<label>${msg("options_match_label", "URL match")}</label>`;
  const matchInput = document.createElement("input");
  matchInput.type = "text";
  matchInput.value = script.matchPattern || defaultMatchPattern;
  matchInput.placeholder = defaultMatchPattern;
  matchInput.spellcheck = false;
  const matchHint = document.createElement("p");
  matchHint.className = "match-hint";
  matchField.append(matchInput, matchHint);

  meta.append(nameField, matchField);

  const statusChip = document.createElement("span");
  statusChip.className = "script-card__status-chip";

  const enableLabel = document.createElement("label");
  enableLabel.className = "script-card__enable";
  const enableInput = document.createElement("input");
  enableInput.type = "checkbox";
  enableInput.checked = script.enabled !== false;
  enableLabel.append(enableInput, document.createTextNode(msg("options_enabled", "활성")));

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "btn btn-danger";
  deleteBtn.textContent = msg("options_delete", "삭제");
  deleteBtn.addEventListener("click", () => removeRow(script.id));

  const headerActions = document.createElement("div");
  headerActions.className = "script-card__header-actions";
  headerActions.append(statusChip, enableLabel, deleteBtn);
  header.append(meta, headerActions);

  const body = document.createElement("div");
  body.className = "script-card__body";
  const codeHead = document.createElement("div");
  codeHead.className = "script-card__code-head";
  const codeLabel = document.createElement("span");
  codeLabel.className = "script-card__code-label";
  codeLabel.textContent = msg("options_code_label", "JavaScript");
  const exampleBtn = document.createElement("button");
  exampleBtn.type = "button";
  exampleBtn.className = "btn btn-example";
  exampleBtn.textContent = msg("options_code_example", "example");
  codeHead.append(codeLabel, exampleBtn);

  const editorHost = document.createElement("div");
  body.append(codeHead, editorHost);

  card.append(header, body);
  listEl.append(card);

  const editor = createLightCodeEditor(editorHost, {
    value: script.code || "",
    placeholder: msg(
      "options_code_placeholder",
      "registerCleanup(() => { /* cleanup */ });"
    ),
    minLines: 8,
    onChange: scheduleSave,
  });

  exampleBtn.addEventListener("click", () => {
    editor.setValue(VISIBILITYCHANGE_EXAMPLE);
    scheduleSave();
  });

  rowState.set(script.id, { editor, matchInput, matchHint, statusChip, nameInput, enableInput });

  const refreshRowUi = () => {
    updateMatchHint(matchInput, matchHint, script.id);
    updateStatusChip(script.id, statusChip, enableInput);
  };

  matchInput.addEventListener("input", () => {
    refreshRowUi();
    scheduleSave();
  });
  nameInput.addEventListener("input", scheduleSave);
  enableInput.addEventListener("change", () => {
    refreshRowUi();
    scheduleSave();
  });

  refreshRowUi();

  if (persist) scheduleSave();
}

function msg(key, fallback) {
  return chrome.i18n.getMessage(key) || fallback;
}

function updateMatchHint(matchInput, hintEl, scriptId) {
  const pattern = matchInput.value.trim();
  const re = cusUserScripts.matchPatternToRegExp(pattern);

  if (!pattern) {
    hintEl.className = "match-hint match-hint--neutral";
    hintEl.textContent = msg("options_match_empty", "패턴을 입력하세요.");
    matchInput.classList.add("is-invalid");
    return;
  }

  if (!re) {
    hintEl.className = "match-hint match-hint--error";
    hintEl.textContent = msg("options_match_invalid", "패턴 형식이 올바르지 않습니다.");
    matchInput.classList.add("is-invalid");
    return;
  }

  const duplicate = cusUserScripts.findScriptWithMatchPattern(
    pattern,
    collectScriptsFromDom(),
    scriptId
  );
  if (duplicate) {
    hintEl.className = "match-hint match-hint--error";
    hintEl.textContent = msg("match_duplicate", "동일한 URL 패턴이 이미 등록되어 있습니다.");
    matchInput.classList.add("is-invalid");
    return;
  }

  matchInput.classList.remove("is-invalid");
  const chromePattern = cusUserScripts.toChromeMatchPatterns(pattern)[0];

  if (referenceTabUrl && cusUserScripts.urlMatchesPattern(pattern, referenceTabUrl)) {
    hintEl.className = "match-hint match-hint--ok";
    hintEl.textContent =
      msg("options_match_ok", "활성 탭 URL과 일치") + ` · Chrome: ${chromePattern}`;
    return;
  }

  if (referenceTabUrl) {
    hintEl.className = "match-hint match-hint--warn";
    hintEl.textContent =
      msg("options_match_no_tab", "활성 탭과 맞지 않음") + ` · Chrome: ${chromePattern}`;
    return;
  }

  hintEl.className = "match-hint match-hint--neutral";
  hintEl.textContent = `Chrome: ${chromePattern}`;
}

function updateStatusChip(scriptId, chipEl, enableInput) {
  const script = collectScriptFromCard(scriptId, enableInput);
  const status = evaluateScriptStatus(script, {
    tabUrl: referenceTabUrl,
    registeredIds,
    apiAvailable: isUserScriptsApiAvailable(),
  });

  chipEl.className = `script-card__status-chip script-card__status-chip--${statusIndicatorClass(status)}`;
  chipEl.textContent = getScriptStatusMessage("options", status);
}

function collectScriptFromCard(scriptId, enableInput) {
  const state = rowState.get(scriptId);
  return {
    id: scriptId,
    name: state?.nameInput?.value ?? "",
    matchPattern: state?.matchInput?.value?.trim() ?? "",
    enabled: Boolean(enableInput?.checked),
    code: state?.editor?.getValue() ?? "",
  };
}

function removeRow(id) {
  const state = rowState.get(id);
  state?.editor.destroy();
  rowState.delete(id);
  scripts = scripts.filter((script) => script.id !== id);

  listEl.querySelector(`[data-id="${id}"]`)?.remove();

  if (!scripts.length) showEmptyState();
  scheduleSave();
}

function collectScriptsFromDom() {
  const cards = listEl.querySelectorAll(".script-card");
  const next = [];

  cards.forEach((card) => {
    const id = card.dataset.id;
    const enableInput = card.querySelector(".script-card__enable input");
    next.push(collectScriptFromCard(id, enableInput));
  });

  return next;
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveScripts, SAVE_DEBOUNCE_MS);
  setSaveStatus(msg("options_saving", "저장 중…"), false);
}

function onDocumentKeydown(event) {
  if (!isSaveShortcut(event)) return;
  event.preventDefault();
  if (isLoading) return;
  saveNow();
}

function isSaveShortcut(event) {
  return (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s";
}

function saveNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  return saveScripts();
}

async function saveScripts() {
  try {
    const next = collectScriptsFromDom();
    if (cusUserScripts.hasDuplicateMatchPatterns(next)) {
      rowState.forEach((state, id) => {
        if (state.matchInput && state.matchHint) {
          updateMatchHint(state.matchInput, state.matchHint, id);
        }
      });
      setSaveStatus(
        msg("options_save_duplicate", "동일한 URL 패턴이 중복되어 저장할 수 없습니다."),
        true
      );
      return;
    }

    scripts = next;
    await chrome.storage.local.set({ [CUS_STORAGE_KEY]: scripts });
    await requestRegistrySync();
    registeredIds = await loadRegisteredIds();
    rowState.forEach((state, id) => {
      if (state.statusChip && state.enableInput) {
        updateStatusChip(id, state.statusChip, state.enableInput);
      }
    });
    setSaveStatus(msg("options_saved", "저장됨"), false);
  } catch (error) {
    console.error("[options] save failed", error);
    setSaveStatus(msg("options_save_error", "저장 실패"), true);
  }
}

function setSaveStatus(text, isError) {
  saveStatusEl.textContent = text;
  saveStatusEl.classList.toggle("is-error", isError);
  if (!isError && text) {
    setTimeout(() => {
      if (saveStatusEl.textContent === text) saveStatusEl.textContent = "";
    }, 2000);
  }
}

function exportScripts() {
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    userScripts: collectScriptsFromDom(),
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `crx-userscript-${Date.now()}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function onImportFile(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file || isLoading) return;

  setLoading(true);
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const imported = Array.isArray(data?.userScripts)
      ? data.userScripts
      : Array.isArray(data)
        ? data
        : null;

    if (!imported) throw new Error("invalid format");

    teardownRows();
    scripts = imported.map(normalizeImportedScript);
    if (cusUserScripts.hasDuplicateMatchPatterns(scripts)) {
      throw new Error("duplicate match patterns");
    }
    scripts.forEach((script) => addRow(script, { persist: false }));
    await saveScripts();
  } catch (error) {
    console.error("[options] import failed", error);
    setSaveStatus(msg("options_import_error", "가져오기 실패"), true);
  } finally {
    setLoading(false);
  }
}

function normalizeImportedScript(raw) {
  return {
    id: raw.id || createScriptId(),
    name: typeof raw.name === "string" ? raw.name : "",
    matchPattern: raw.matchPattern || defaultMatchPattern,
    enabled: raw.enabled !== false,
    code: typeof raw.code === "string" ? raw.code : "",
  };
}

function teardownRows() {
  rowState.forEach((state) => state.editor.destroy());
  rowState.clear();
  listEl.innerHTML = "";
}
