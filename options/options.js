const SAVE_DEBOUNCE_MS = 350;
const COMMON_UTILS_PLACEHOLDER = `export const utils = {
  qs(selector) {
    return document.querySelector(selector);
  },
};
`;

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
const btnAdd = document.getElementById("btn-add");
const tabEls = document.querySelectorAll(".options-tab");
const panelScriptsEl = document.getElementById("panel-scripts");
const panelCommonUtilsEl = document.getElementById("panel-common-utils");
const commonUtilsEnabledEl = document.getElementById("common-utils-enabled");
const commonUtilsListEl = document.getElementById("common-utils-list");
const commonUtilsEmptyEl = document.getElementById("common-utils-empty");
const commonUtilsConflictEl = document.getElementById("common-utils-conflict");
const editorBreadcrumbEl = document.getElementById("editor-breadcrumb");
const btnNavTree = document.getElementById("btn-nav-tree");
const btnNavTreeClose = document.getElementById("btn-nav-tree-close");
const navTreeBackdropEl = document.getElementById("nav-tree-backdrop");
const navTreeDrawerEl = document.getElementById("nav-tree-drawer");
const navTreeEl = document.getElementById("nav-tree");

/** @type {Map<string, {
 *   matchInput: HTMLInputElement,
 *   matchHint: HTMLElement,
 *   statusChip: HTMLElement,
 *   nameInput: HTMLInputElement,
 *   enableInput: HTMLInputElement,
 *   modulesEl: HTMLElement,
 *   modules: Map<string, {
 *     editor: ReturnType<typeof createLightCodeEditor>,
 *     nameInput: HTMLInputElement,
 *     enableInput: HTMLInputElement,
 *   }>
 * }>} */
const rowState = new Map();
/** @type {Map<string, { editor: ReturnType<typeof createLightCodeEditor>, nameInput: HTMLInputElement, enableInput: HTMLInputElement, conflictHint: HTMLElement }>} */
const utilRowState = new Map();

/** @type {{ kind: "script" | "util", id: string, moduleId?: string | null } | null} */
let activeEditorContext = null;
let navTreeOpen = false;

let scripts = [];
let commonUtils = { enabled: true, modules: [] };
let defaultMatchPattern = "https?://*/*";
let referenceTabUrl = "";
let saveTimer = null;
let registeredIds = new Set();
let isLoading = false;
let activePanel = "scripts";
let isHydratingCommonUtils = false;

initI18n();
initStickyChrome();
initNavTree();
init();

btnAdd.addEventListener("click", async () => {
  if (activePanel === "common-utils") {
    addUtilModule(cusUserScripts.createEmptyCommonUtilsModule());
    scheduleSave();
    return;
  }

  const matchPattern = await resolveDefaultMatchPattern();
  const existing = listEl.querySelector(".script-card")
    ? collectScriptsFromDom()
    : scripts;

  if (cusUserScripts.findScriptWithMatchPattern(matchPattern, existing)) {
    setSaveStatus(
      msg("match_duplicate", "동일한 URL 패턴이 이미 등록되어 있습니다."),
      true,
    );
    return;
  }

  addRow({
    ...createEmptyScript(),
    matchPattern,
  });
  scheduleSave();
});

document.getElementById("btn-export").addEventListener("click", exportScripts);
document
  .getElementById("btn-import")
  .addEventListener("click", () => importFileEl.click());
importFileEl.addEventListener("change", onImportFile);
btnRefresh.addEventListener("click", () => reloadScripts());
document.addEventListener("keydown", onDocumentKeydown);
commonUtilsEnabledEl.addEventListener("change", scheduleSave);
tabEls.forEach((tab) => {
  tab.addEventListener("click", () => setActivePanel(tab.dataset.panel));
});

function setLoading(loading) {
  isLoading = loading;
  pageLoadingEl.hidden = !loading;
  listEl.hidden = loading;
  btnRefresh.disabled = loading;
  toolbarEl?.classList.toggle("is-disabled", loading);
  listEl.setAttribute("aria-busy", loading ? "true" : "false");
  if (loading) {
    panelScriptsEl.hidden = true;
    panelCommonUtilsEl.hidden = true;
  } else {
    setActivePanel(activePanel);
  }
}

async function loadScriptsData({ focusFromSession = false } = {}) {
  teardownRows();
  registeredIds = await loadRegisteredIds();

  const stored = await chrome.storage.local.get([
    CUS_STORAGE_KEY,
    CUS_COMMON_UTILS_STORAGE_KEY,
  ]);
  scripts = Array.isArray(stored[CUS_STORAGE_KEY])
    ? stored[CUS_STORAGE_KEY].map((script) =>
        cusUserScripts.normalizePageScript(script, {
          matchPattern: defaultMatchPattern,
        }),
      )
    : [];
  commonUtils = cusUserScripts.normalizeCommonUtils(
    stored[CUS_COMMON_UTILS_STORAGE_KEY],
  );
  renderCommonUtils();

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
    rowState.get(focusId)?.modules?.values()?.next()?.value?.editor?.focus();
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

function initStickyChrome() {
  const stickyChrome = document.getElementById("sticky-chrome");
  const sentinel = document.querySelector(".sticky-chrome-sentinel");
  if (!stickyChrome || !sentinel || typeof IntersectionObserver !== "function") {
    return;
  }

  const observer = new IntersectionObserver(
    ([entry]) => {
      stickyChrome.classList.toggle("is-stuck", Boolean(entry) && !entry.isIntersecting);
    },
    { threshold: 0 }
  );
  observer.observe(sentinel);
}

function initNavTree() {
  if (!btnNavTree || !navTreeDrawerEl || !navTreeEl) return;

  btnNavTree.addEventListener("click", () => setNavTreeOpen(!navTreeOpen));
  btnNavTreeClose?.addEventListener("click", () => setNavTreeOpen(false));
  navTreeBackdropEl?.addEventListener("click", () => setNavTreeOpen(false));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && navTreeOpen) setNavTreeOpen(false);
  });
  renderNavTree();
}

function setNavTreeOpen(open) {
  navTreeOpen = Boolean(open);
  if (navTreeDrawerEl) navTreeDrawerEl.hidden = !navTreeOpen;
  if (navTreeBackdropEl) navTreeBackdropEl.hidden = !navTreeOpen;
  if (btnNavTree) {
    btnNavTree.setAttribute("aria-expanded", navTreeOpen ? "true" : "false");
    btnNavTree.classList.toggle("is-active", navTreeOpen);
  }
  if (navTreeOpen) renderNavTree();
}

function renderNavTree() {
  if (!navTreeEl) return;
  navTreeEl.replaceChildren();

  const scriptsSection = document.createElement("section");
  scriptsSection.className = "nav-tree__section";
  const scriptsTitle = document.createElement("h3");
  scriptsTitle.className = "nav-tree__section-title";
  scriptsTitle.textContent = msg("options_tab_scripts", "페이지별 스크립트");
  scriptsSection.append(scriptsTitle);

  const scriptCards = [...listEl.querySelectorAll(".script-card")];
  if (!scriptCards.length) {
    const empty = document.createElement("p");
    empty.className = "nav-tree__empty";
    empty.textContent = msg("options_nav_tree_empty_scripts", "스크립트 없음");
    scriptsSection.append(empty);
  } else {
    scriptCards.forEach((card) => {
      const scriptId = card.dataset.id;
      const state = rowState.get(scriptId);
      if (!state) return;

      const groupName = state.nameInput.value.trim() || breadcrumbUntitled();
      const pattern = state.matchInput.value.trim() || defaultMatchPattern;
      const groupBtn = createNavTreeItem({
        label: groupName,
        meta: pattern,
        className: "nav-tree__item--group",
        active:
          activeEditorContext?.kind === "script" &&
          activeEditorContext.id === scriptId &&
          !activeEditorContext.moduleId,
        onClick: () => navigateNavTreeTarget("script", scriptId),
      });
      scriptsSection.append(groupBtn);

      state.modules.forEach((moduleState, moduleId) => {
        const moduleName =
          moduleState.nameInput.value.trim() || breadcrumbUntitled();
        const moduleBtn = createNavTreeItem({
          label: moduleName,
          className: "nav-tree__item--child",
          active:
            activeEditorContext?.kind === "script" &&
            activeEditorContext.id === scriptId &&
            activeEditorContext.moduleId === moduleId,
          onClick: () => navigateNavTreeTarget("script", scriptId, moduleId),
        });
        scriptsSection.append(moduleBtn);
      });
    });
  }

  const utilsSection = document.createElement("section");
  utilsSection.className = "nav-tree__section";
  const utilsTitle = document.createElement("h3");
  utilsTitle.className = "nav-tree__section-title";
  utilsTitle.textContent = msg("options_tab_common_utils", "공통 유틸");
  utilsSection.append(utilsTitle);

  const utilCards = [...commonUtilsListEl.querySelectorAll(".util-card")];
  if (!utilCards.length) {
    const empty = document.createElement("p");
    empty.className = "nav-tree__empty";
    empty.textContent = msg("options_nav_tree_empty_utils", "유틸 없음");
    utilsSection.append(empty);
  } else {
    utilCards.forEach((card) => {
      const utilId = card.dataset.id;
      const state = utilRowState.get(utilId);
      if (!state) return;
      const name = state.nameInput.value.trim() || breadcrumbUntitled();
      const utilBtn = createNavTreeItem({
        label: name,
        className: "nav-tree__item--group",
        active:
          activeEditorContext?.kind === "util" &&
          activeEditorContext.id === utilId,
        onClick: () => navigateNavTreeTarget("util", utilId),
      });
      utilsSection.append(utilBtn);
    });
  }

  navTreeEl.append(scriptsSection, utilsSection);
}

function createNavTreeItem({ label, meta, className = "", active, onClick }) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `nav-tree__item ${className}`.trim();
  if (active) button.classList.add("is-active");

  const labelEl = document.createElement("span");
  labelEl.textContent = label;
  button.append(labelEl);

  if (meta) {
    const metaEl = document.createElement("span");
    metaEl.className = "nav-tree__meta";
    metaEl.textContent = meta;
    button.append(metaEl);
  }

  button.addEventListener("click", onClick);
  return button;
}

function navigateNavTreeTarget(kind, id, moduleId = null) {
  if (kind === "script") {
    setActivePanel("scripts", { clearBreadcrumb: false });
    const state = rowState.get(id);
    const card = listEl.querySelector(
      `.script-card[data-id="${CSS.escape(id)}"]`,
    );
    if (!state || !card) return;

    if (moduleId) {
      const moduleState = state.modules.get(moduleId);
      const moduleCard = card.querySelector(
        `.script-module-card[data-module-id="${CSS.escape(moduleId)}"]`,
      );
      setEditorContext("script", id, moduleId);
      scrollBreadcrumbTarget(moduleCard, moduleState?.nameInput ?? null);
      return;
    }

    setEditorContext("script", id, null);
    scrollBreadcrumbTarget(card, state.nameInput);
    return;
  }

  setActivePanel("common-utils", { clearBreadcrumb: false });
  const state = utilRowState.get(id);
  const card = commonUtilsListEl.querySelector(
    `.util-card[data-id="${CSS.escape(id)}"]`,
  );
  if (!state || !card) return;
  setEditorContext("util", id);
  scrollBreadcrumbTarget(card, state.nameInput);
}

function setActivePanel(panel, options = {}) {
  const { clearBreadcrumb = true } = options;
  activePanel = panel === "common-utils" ? "common-utils" : "scripts";
  panelScriptsEl.hidden = activePanel !== "scripts";
  panelCommonUtilsEl.hidden = activePanel !== "common-utils";

  btnAdd.textContent =
    activePanel === "common-utils"
      ? msg("options_add_util", "유틸 추가")
      : msg("options_add_row", "스크립트 추가");

  tabEls.forEach((tab) => {
    const active = tab.dataset.panel === activePanel;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", active ? "true" : "false");
  });

  if (clearBreadcrumb) clearEditorBreadcrumb();
  renderNavTree();
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
  return new Set(
    registered.filter((s) => s.id.startsWith("cus-")).map((s) => s.id),
  );
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
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
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
  renderNavTree();
}

function clearEditorBreadcrumb() {
  activeEditorContext = null;
  updateEditorBreadcrumb();
  renderNavTree();
}

function setEditorContext(kind, id, moduleId = null) {
  activeEditorContext = { kind, id, moduleId };
  updateEditorBreadcrumb();
  renderNavTree();
}

function breadcrumbUntitled() {
  return msg("options_breadcrumb_untitled", "(이름 없음)");
}

function updateEditorBreadcrumb() {
  if (!editorBreadcrumbEl) return;

  if (!activeEditorContext) {
    editorBreadcrumbEl.hidden = true;
    editorBreadcrumbEl.replaceChildren();
    return;
  }

  /** @type {Array<{ label: string, getTarget: () => Element | null, focusEl?: () => HTMLElement | null }>} */
  const segments = [];

  if (activeEditorContext.kind === "script") {
    const scriptId = activeEditorContext.id;
    const state = rowState.get(scriptId);
    if (!state) {
      clearEditorBreadcrumb();
      return;
    }
    const card = listEl.querySelector(
      `.script-card[data-id="${CSS.escape(scriptId)}"]`,
    );
    const moduleId = activeEditorContext.moduleId;
    const moduleState = moduleId ? state.modules.get(moduleId) : null;
    const moduleCard = moduleId
      ? card?.querySelector(
          `.script-module-card[data-module-id="${CSS.escape(moduleId)}"]`,
        )
      : null;

    const groupName = state.nameInput.value.trim() || breadcrumbUntitled();
    const pattern = state.matchInput.value.trim() || defaultMatchPattern;
    const moduleName =
      moduleState?.nameInput.value.trim() || breadcrumbUntitled();

    segments.push(
      {
        label: msg("options_tab_scripts", "페이지별 스크립트"),
        getTarget: () => panelScriptsEl,
      },
      {
        label: groupName,
        getTarget: () => card,
        focusEl: () => state.nameInput,
      },
      {
        label: moduleName,
        getTarget: () => moduleCard,
        focusEl: () => moduleState?.nameInput ?? null,
      },
      {
        label: pattern,
        getTarget: () => card,
        focusEl: () => state.matchInput,
      },
    );
  } else {
    const utilId = activeEditorContext.id;
    const state = utilRowState.get(utilId);
    if (!state) {
      clearEditorBreadcrumb();
      return;
    }
    const card = commonUtilsListEl.querySelector(
      `.util-card[data-id="${CSS.escape(utilId)}"]`,
    );
    const name = state.nameInput.value.trim() || breadcrumbUntitled();

    segments.push(
      {
        label: msg("options_tab_common_utils", "공통 유틸"),
        getTarget: () => panelCommonUtilsEl,
      },
      {
        label: name,
        getTarget: () => card,
        focusEl: () => state.nameInput,
      },
    );
  }

  editorBreadcrumbEl.replaceChildren();
  segments.forEach((segment, index) => {
    if (index > 0) {
      const sep = document.createElement("span");
      sep.className = "editor-breadcrumb__sep";
      sep.textContent = "›";
      sep.setAttribute("aria-hidden", "true");
      editorBreadcrumbEl.append(sep);
    }
    const seg = document.createElement("button");
    seg.type = "button";
    seg.className = "editor-breadcrumb__seg";
    if (index === 0) seg.classList.add("editor-breadcrumb__seg--muted");
    if (index === segments.length - 1) {
      seg.classList.add("editor-breadcrumb__seg--strong");
    }
    seg.textContent = segment.label;
    seg.title = segment.label;
    seg.addEventListener("click", () => {
      scrollBreadcrumbTarget(segment.getTarget(), segment.focusEl?.() ?? null);
    });
    editorBreadcrumbEl.append(seg);
  });
  editorBreadcrumbEl.hidden = false;
}

function ensureCardExpanded(card) {
  if (!card?.classList.contains("is-collapsed")) return;
  card.querySelector(".btn-collapse-icon")?.click();
}

function flashScrollTarget(el) {
  if (!el) return;
  el.classList.remove("is-scroll-target");
  // reflow so the animation can replay
  void el.offsetWidth;
  el.classList.add("is-scroll-target");
  window.setTimeout(() => el.classList.remove("is-scroll-target"), 1200);
}

function scrollBreadcrumbTarget(target, focusEl = null) {
  if (!target) return;

  ensureCardExpanded(target.closest?.(".script-module-card, .util-card") || target);
  if (target.classList?.contains("script-card")) {
    target
      .querySelectorAll(".script-module-card.is-collapsed")
      .forEach((card) => {
        if (focusEl && card.contains(focusEl)) ensureCardExpanded(card);
      });
  }

  const stickyOffset =
    document.getElementById("sticky-chrome")?.getBoundingClientRect().height ??
    0;
  const top =
    target.getBoundingClientRect().top + window.scrollY - stickyOffset - 12;
  window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  flashScrollTarget(target);

  if (focusEl && typeof focusEl.focus === "function") {
    window.setTimeout(() => {
      focusEl.focus({ preventScroll: true });
    }, 250);
  }
}

function bindEditorContext(card, kind, id, moduleId = null) {
  card.addEventListener("focusin", () => setEditorContext(kind, id, moduleId));
}

function createCollapseToggle(card, panelEl) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn-collapse-icon";

  const syncLabel = () => {
    const collapsed = card.classList.contains("is-collapsed");
    button.setAttribute("aria-expanded", collapsed ? "false" : "true");
    const label = collapsed
      ? msg("options_expand_editor", "펼치기")
      : msg("options_collapse_editor", "접기");
    button.setAttribute("aria-label", label);
    button.title = label;
    button.textContent = collapsed ? "▸" : "▾";
    panelEl.hidden = collapsed;
  };

  button.addEventListener("click", () => {
    card.classList.toggle("is-collapsed");
    syncLabel();
  });

  syncLabel();
  return button;
}

function confirmDestructiveDelete({ name = "", code = "" } = {}) {
  const hasContent = Boolean(String(name).trim() || String(code).trim());
  if (!hasContent) return true;
  return window.confirm(
    msg(
      "options_delete_confirm",
      "삭제하면 되돌릴 수 없습니다. 계속할까요?",
    ),
  );
}

function createEmptyScript() {
  return cusUserScripts.normalizePageScript(
    {
      id: createScriptId(),
      name: "",
      matchPattern: defaultMatchPattern,
      enabled: true,
      modules: [cusUserScripts.createEmptyPageScriptModule()],
    },
    { matchPattern: defaultMatchPattern },
  );
}

function createScriptId() {
  return `us-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function addRow(script, options = {}) {
  const { persist = true } = options;
  const normalized = cusUserScripts.normalizePageScript(script, {
    matchPattern: defaultMatchPattern,
  });

  if (!listEl.querySelector(".script-card")) {
    listEl.innerHTML = "";
  }

  const card = document.createElement("article");
  card.className = "script-card";
  card.dataset.id = normalized.id;

  const header = document.createElement("header");
  header.className = "script-card__header";

  const meta = document.createElement("div");
  meta.className = "script-card__meta";

  const nameField = document.createElement("div");
  nameField.innerHTML = `<label>${msg("options_name_label", "이름")}</label>`;
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.value = normalized.name || "";
  nameInput.placeholder = msg(
    "options_name_placeholder",
    "예: ChatGPT 새로고침",
  );
  nameField.append(nameInput);

  const matchField = document.createElement("div");
  matchField.className = "script-card__match";
  matchField.innerHTML = `<label>${msg("options_match_label", "URL match")}</label>`;
  const matchInput = document.createElement("input");
  matchInput.type = "text";
  matchInput.value = normalized.matchPattern || defaultMatchPattern;
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
  enableInput.checked = normalized.enabled !== false;
  enableLabel.append(
    enableInput,
    document.createTextNode(msg("options_enabled", "활성")),
  );

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "btn btn-danger";
  deleteBtn.textContent = msg("options_delete", "삭제");
  deleteBtn.addEventListener("click", () => removeRow(normalized.id));

  const headerActions = document.createElement("div");
  headerActions.className = "script-card__header-actions";
  headerActions.append(statusChip, enableLabel, deleteBtn);
  header.append(meta, headerActions);

  const body = document.createElement("div");
  body.className = "script-card__body";

  const modulesHead = document.createElement("div");
  modulesHead.className = "script-card__modules-head";
  const modulesLabel = document.createElement("span");
  modulesLabel.className = "script-card__code-label";
  modulesLabel.textContent = msg("options_script_modules_label", "모듈");
  const addModuleBtn = document.createElement("button");
  addModuleBtn.type = "button";
  addModuleBtn.className = "btn btn-example";
  addModuleBtn.textContent = msg("options_add_script_module", "모듈 추가");
  const exampleBtn = document.createElement("button");
  exampleBtn.type = "button";
  exampleBtn.className = "btn btn-example";
  exampleBtn.textContent = msg("options_code_example", "example");
  modulesHead.append(modulesLabel, addModuleBtn, exampleBtn);

  const modulesEl = document.createElement("div");
  modulesEl.className = "script-card__modules";

  body.append(modulesHead, modulesEl);
  card.append(header, body);
  listEl.append(card);

  const modules = new Map();
  rowState.set(normalized.id, {
    matchInput,
    matchHint,
    statusChip,
    nameInput,
    enableInput,
    modulesEl,
    modules,
  });

  normalized.modules.forEach((module) => {
    addScriptModule(normalized.id, module, { persist: false });
  });

  addModuleBtn.addEventListener("click", () => {
    addScriptModule(
      normalized.id,
      cusUserScripts.createEmptyPageScriptModule(),
    );
    scheduleSave();
  });
  exampleBtn.addEventListener("click", () => {
    showCopyablePopup(VISIBILITYCHANGE_EXAMPLE);
  });

  const refreshRowUi = () => {
    updateMatchHint(matchInput, matchHint, normalized.id);
    updateStatusChip(normalized.id, statusChip, enableInput);
  };

  matchInput.addEventListener("input", () => {
    refreshRowUi();
    if (activeEditorContext?.kind === "script" && activeEditorContext.id === normalized.id) {
      updateEditorBreadcrumb();
    }
    renderNavTree();
    scheduleSave();
  });
  nameInput.addEventListener("input", () => {
    if (activeEditorContext?.kind === "script" && activeEditorContext.id === normalized.id) {
      updateEditorBreadcrumb();
    }
    renderNavTree();
    scheduleSave();
  });
  enableInput.addEventListener("change", () => {
    refreshRowUi();
    scheduleSave();
  });

  refreshRowUi();
  renderNavTree();

  if (persist) scheduleSave();
}

function addScriptModule(scriptId, module, options = {}) {
  const { persist = true } = options;
  const scriptState = rowState.get(scriptId);
  if (!scriptState) return;

  const normalized = {
    id: module.id || cusUserScripts.createPageScriptModuleId(),
    name: typeof module.name === "string" ? module.name : "",
    enabled: module.enabled !== false,
    code: typeof module.code === "string" ? module.code : "",
  };

  const card = document.createElement("div");
  card.className = "script-module-card";
  card.dataset.moduleId = normalized.id;

  const header = document.createElement("div");
  header.className = "script-module-card__header";

  const editorHost = document.createElement("div");
  editorHost.className = "script-module-card__editor";
  const collapseBtn = createCollapseToggle(card, editorHost);

  const nameBlock = document.createElement("div");
  nameBlock.className = "script-module-card__name-block";

  const nameLabel = document.createElement("label");
  nameLabel.className = "script-module-card__name";
  nameLabel.textContent = msg("options_name_label", "이름");
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.value = normalized.name;
  nameInput.placeholder = msg(
    "options_script_module_name_placeholder",
    "예: 탭 복귀 시 새로고침",
  );
  nameLabel.append(nameInput);
  nameBlock.append(collapseBtn, nameLabel);

  const enableLabel = document.createElement("label");
  enableLabel.className = "script-module-card__enable";
  const enableInput = document.createElement("input");
  enableInput.type = "checkbox";
  enableInput.checked = normalized.enabled;
  enableLabel.append(
    enableInput,
    document.createTextNode(` ${msg("options_enabled", "활성")}`),
  );

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "btn btn-danger btn-compact";
  deleteBtn.textContent = msg("options_delete", "삭제");
  deleteBtn.addEventListener("click", () => removeScriptModule(scriptId, normalized.id));

  const headerActions = document.createElement("div");
  headerActions.className = "script-module-card__actions";
  headerActions.append(enableLabel, deleteBtn);
  header.append(nameBlock, headerActions);

  card.append(header, editorHost);
  scriptState.modulesEl.append(card);
  bindEditorContext(card, "script", scriptId, normalized.id);

  const editor = createLightCodeEditor(editorHost, {
    value: normalized.code,
    placeholder: msg(
      "options_code_placeholder",
      "registerCleanup(() => { /* cleanup */ });",
    ),
    minLines: cusUserScripts.EDITOR_MIN_LINES,
    maxLines: cusUserScripts.EDITOR_MAX_LINES,
    onChange: scheduleSave,
  });

  scriptState.modules.set(normalized.id, {
    editor,
    nameInput,
    enableInput,
  });

  nameInput.addEventListener("input", () => {
    if (
      activeEditorContext?.kind === "script" &&
      activeEditorContext.id === scriptId &&
      activeEditorContext.moduleId === normalized.id
    ) {
      updateEditorBreadcrumb();
    }
    renderNavTree();
    scheduleSave();
  });
  enableInput.addEventListener("change", () => {
    const parent = rowState.get(scriptId);
    if (parent) {
      updateStatusChip(scriptId, parent.statusChip, parent.enableInput);
    }
    scheduleSave();
  });

  if (persist) {
    const parent = rowState.get(scriptId);
    if (parent) {
      updateStatusChip(scriptId, parent.statusChip, parent.enableInput);
    }
  }
  renderNavTree();
}

function removeScriptModule(scriptId, moduleId) {
  const scriptState = rowState.get(scriptId);
  if (!scriptState) return;

  const moduleState = scriptState.modules.get(moduleId);
  if (
    !confirmDestructiveDelete({
      name: moduleState?.nameInput?.value,
      code: moduleState?.editor?.getValue(),
    })
  ) {
    return;
  }

  moduleState?.editor?.destroy();
  scriptState.modules.delete(moduleId);
  scriptState.modulesEl
    .querySelector(`[data-module-id="${CSS.escape(moduleId)}"]`)
    ?.remove();

  if (
    activeEditorContext?.kind === "script" &&
    activeEditorContext.id === scriptId &&
    activeEditorContext.moduleId === moduleId
  ) {
    clearEditorBreadcrumb();
  }

  if (!scriptState.modules.size) {
    addScriptModule(scriptId, cusUserScripts.createEmptyPageScriptModule(), {
      persist: false,
    });
  }

  updateStatusChip(scriptId, scriptState.statusChip, scriptState.enableInput);
  renderNavTree();
  scheduleSave();
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
    hintEl.textContent = msg(
      "options_match_invalid",
      "패턴 형식이 올바르지 않습니다.",
    );
    matchInput.classList.add("is-invalid");
    return;
  }

  const duplicate = cusUserScripts.findScriptWithMatchPattern(
    pattern,
    collectScriptsFromDom(),
    scriptId,
  );
  if (duplicate) {
    hintEl.className = "match-hint match-hint--error";
    hintEl.textContent = msg(
      "match_duplicate",
      "동일한 URL 패턴이 이미 등록되어 있습니다.",
    );
    matchInput.classList.add("is-invalid");
    return;
  }

  matchInput.classList.remove("is-invalid");
  const chromePattern = cusUserScripts.toChromeMatchPatterns(pattern)[0];

  if (
    referenceTabUrl &&
    cusUserScripts.urlMatchesPattern(pattern, referenceTabUrl)
  ) {
    hintEl.className = "match-hint match-hint--ok";
    hintEl.textContent =
      msg("options_match_ok", "활성 탭 URL과 일치") +
      ` · Chrome: ${chromePattern}`;
    return;
  }

  if (referenceTabUrl) {
    hintEl.className = "match-hint match-hint--warn";
    hintEl.textContent =
      msg("options_match_no_tab", "활성 탭과 맞지 않음") +
      ` · Chrome: ${chromePattern}`;
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
  const modules = [];
  state?.modules?.forEach((moduleState, moduleId) => {
    modules.push({
      id: moduleId,
      name: moduleState.nameInput.value,
      enabled: Boolean(moduleState.enableInput.checked),
      code: moduleState.editor.getValue(),
    });
  });

  return {
    id: scriptId,
    name: state?.nameInput?.value ?? "",
    matchPattern: state?.matchInput?.value?.trim() ?? "",
    enabled: Boolean(enableInput?.checked),
    modules,
  };
}

function removeRow(id) {
  const state = rowState.get(id);
  const script = collectScriptFromCard(id, state?.enableInput);
  const hasContent =
    Boolean(script.name?.trim()) ||
    script.modules.some(
      (module) => module.name?.trim() || module.code?.trim(),
    );
  if (
    hasContent &&
    !window.confirm(
      msg(
        "options_delete_confirm",
        "삭제하면 되돌릴 수 없습니다. 계속할까요?",
      ),
    )
  ) {
    return;
  }

  state?.modules?.forEach((moduleState) => moduleState.editor.destroy());
  rowState.delete(id);
  if (activeEditorContext?.kind === "script" && activeEditorContext.id === id) {
    clearEditorBreadcrumb();
  }
  scripts = scripts.filter((item) => item.id !== id);

  listEl.querySelector(`[data-id="${id}"]`)?.remove();

  if (!scripts.length) showEmptyState();
  renderNavTree();
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
    const nextCommonUtils = collectCommonUtilsFromDom();
    if (cusUserScripts.hasDuplicateMatchPatterns(next)) {
      rowState.forEach((state, id) => {
        if (state.matchInput && state.matchHint) {
          updateMatchHint(state.matchInput, state.matchHint, id);
        }
      });
      setSaveStatus(
        msg(
          "options_save_duplicate",
          "동일한 URL 패턴이 중복되어 저장할 수 없습니다.",
        ),
        true,
      );
      return;
    }
    if (!isValidCommonUtils(nextCommonUtils)) {
      updateCommonUtilsConflictHints(nextCommonUtils);
      const validation = cusUserScripts.validateCommonUtils(nextCommonUtils);
      if (validation.reason === "key_conflict") {
        setSaveStatus(
          formatCommonUtilsConflictStatus(validation.conflicts),
          true,
        );
      } else {
        setSaveStatus(
          msg(
            "options_common_utils_invalid",
            "공통 유틸은 export const utils = { ... } 형태로 시작해야 합니다.",
          ),
          true,
        );
      }
      return;
    }

    scripts = next;
    commonUtils = nextCommonUtils;
    updateCommonUtilsConflictHints(commonUtils);
    await chrome.storage.local.set({
      [CUS_STORAGE_KEY]: scripts,
      [CUS_COMMON_UTILS_STORAGE_KEY]: commonUtils,
    });
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

function collectCommonUtilsFromDom() {
  const modules = [];
  commonUtilsListEl.querySelectorAll(".util-card").forEach((card) => {
    const id = card.dataset.id;
    const state = utilRowState.get(id);
    if (!state) return;
    modules.push({
      id,
      name: state.nameInput.value,
      enabled: Boolean(state.enableInput.checked),
      code: state.editor.getValue(),
    });
  });

  return {
    enabled: Boolean(commonUtilsEnabledEl.checked),
    modules,
  };
}

function isValidCommonUtils(value) {
  return cusUserScripts.validateCommonUtils(value).ok;
}

function formatCommonUtilsConflictStatus(conflicts) {
  if (!conflicts?.length) {
    return msg(
      "options_common_utils_conflict",
      "유틸 키 이름이 겹쳐 저장할 수 없습니다.",
    );
  }
  const summary = conflicts
    .slice(0, 3)
    .map((conflict) => {
      const owners = conflict.modules.map((module) => module.name).join(", ");
      return `${conflict.key} (${owners})`;
    })
    .join(" · ");
  return `${msg(
    "options_common_utils_conflict",
    "유틸 키 이름이 겹쳐 저장할 수 없습니다.",
  )} ${summary}`;
}

function updateCommonUtilsConflictHints(value = collectCommonUtilsFromDom()) {
  const conflicts = cusUserScripts.findCommonUtilsKeyConflicts(value);
  const conflictKeysByModule = new Map();

  for (const conflict of conflicts) {
    for (const module of conflict.modules) {
      if (!conflictKeysByModule.has(module.id)) {
        conflictKeysByModule.set(module.id, []);
      }
      conflictKeysByModule.get(module.id).push(conflict.key);
    }
  }

  if (conflicts.length) {
    commonUtilsConflictEl.hidden = false;
    commonUtilsConflictEl.textContent = formatCommonUtilsConflictStatus(conflicts);
  } else {
    commonUtilsConflictEl.hidden = true;
    commonUtilsConflictEl.textContent = "";
  }

  utilRowState.forEach((state, id) => {
    const keys = conflictKeysByModule.get(id);
    if (keys?.length) {
      state.conflictHint.hidden = false;
      state.conflictHint.textContent =
        chrome.i18n.getMessage("options_common_utils_module_conflict", [
          keys.join(", "),
        ]) || `겹치는 키: ${keys.join(", ")}`;
    } else {
      state.conflictHint.hidden = true;
      state.conflictHint.textContent = "";
    }
  });
}

function renderCommonUtils() {
  isHydratingCommonUtils = true;
  teardownUtilRows();
  commonUtilsEnabledEl.checked = commonUtils.enabled !== false;
  commonUtils.modules.forEach((module) => addUtilModule(module, { persist: false }));
  updateCommonUtilsEmptyState();
  updateCommonUtilsConflictHints(commonUtils);
  isHydratingCommonUtils = false;
  renderNavTree();
}

function updateCommonUtilsEmptyState() {
  const hasModules = commonUtilsListEl.querySelector(".util-card");
  commonUtilsEmptyEl.hidden = Boolean(hasModules);
}

function addUtilModule(module, options = {}) {
  const { persist = true } = options;
  const card = document.createElement("div");
  card.className = "util-card";
  card.dataset.id = module.id;

  const header = document.createElement("div");
  header.className = "util-card__header";

  const body = document.createElement("div");
  body.className = "util-card__body";
  const collapseBtn = createCollapseToggle(card, body);

  const meta = document.createElement("div");
  meta.className = "util-card__meta";

  const nameBlock = document.createElement("div");
  nameBlock.className = "util-card__name-block";

  const nameLabel = document.createElement("label");
  nameLabel.textContent = msg("options_name_label", "이름");
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.value = module.name || "";
  nameInput.placeholder = msg(
    "options_util_name_placeholder",
    "예: dom, time",
  );
  nameLabel.append(nameInput);
  nameBlock.append(collapseBtn, nameLabel);
  meta.append(nameBlock);

  const enableLabel = document.createElement("label");
  enableLabel.className = "util-card__enable";
  const enableInput = document.createElement("input");
  enableInput.type = "checkbox";
  enableInput.checked = module.enabled !== false;
  enableLabel.append(
    enableInput,
    document.createTextNode(` ${msg("options_enabled", "활성")}`),
  );

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "btn btn-danger btn-compact";
  deleteBtn.textContent = msg("options_delete", "삭제");
  deleteBtn.addEventListener("click", () => removeUtilModule(module.id));

  const headerActions = document.createElement("div");
  headerActions.className = "util-card__header-actions";
  headerActions.append(enableLabel, deleteBtn);
  header.append(meta, headerActions);

  const codeHead = document.createElement("div");
  codeHead.className = "util-card__code-head";
  const codeLabel = document.createElement("span");
  codeLabel.className = "util-card__code-label";
  codeLabel.textContent = msg("options_code_label", "JavaScript");
  codeHead.append(codeLabel);

  const editorHost = document.createElement("div");
  const conflictHint = document.createElement("p");
  conflictHint.className = "util-card__conflict";
  conflictHint.hidden = true;

  body.append(codeHead, editorHost, conflictHint);
  card.append(header, body);
  commonUtilsListEl.append(card);
  commonUtilsEmptyEl.hidden = true;
  bindEditorContext(card, "util", module.id);

  const editor = createLightCodeEditor(editorHost, {
    value: module.code || "",
    placeholder: COMMON_UTILS_PLACEHOLDER,
    minLines: cusUserScripts.EDITOR_MIN_LINES,
    maxLines: cusUserScripts.EDITOR_MAX_LINES,
    onChange: () => {
      if (!isHydratingCommonUtils) {
        updateCommonUtilsConflictHints();
        scheduleSave();
      }
    },
  });

  utilRowState.set(module.id, {
    editor,
    nameInput,
    enableInput,
    conflictHint,
  });

  nameInput.addEventListener("input", () => {
    if (!isHydratingCommonUtils) {
      if (
        activeEditorContext?.kind === "util" &&
        activeEditorContext.id === module.id
      ) {
        updateEditorBreadcrumb();
      }
      updateCommonUtilsConflictHints();
      renderNavTree();
      scheduleSave();
    }
  });
  enableInput.addEventListener("change", () => {
    if (!isHydratingCommonUtils) {
      updateCommonUtilsConflictHints();
      scheduleSave();
    }
  });

  if (persist) updateCommonUtilsEmptyState();
  if (!isHydratingCommonUtils) renderNavTree();
}

function removeUtilModule(id) {
  const state = utilRowState.get(id);
  if (
    !confirmDestructiveDelete({
      name: state?.nameInput?.value,
      code: state?.editor?.getValue(),
    })
  ) {
    return;
  }

  state?.editor?.destroy();
  utilRowState.delete(id);
  if (activeEditorContext?.kind === "util" && activeEditorContext.id === id) {
    clearEditorBreadcrumb();
  }
  commonUtilsListEl.querySelector(`[data-id="${CSS.escape(id)}"]`)?.remove();
  updateCommonUtilsEmptyState();
  updateCommonUtilsConflictHints();
  renderNavTree();
  scheduleSave();
}

function teardownUtilRows() {
  utilRowState.forEach((state) => state.editor.destroy());
  utilRowState.clear();
  commonUtilsListEl.innerHTML = "";
  if (activeEditorContext?.kind === "util") clearEditorBreadcrumb();
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
    commonUtils: collectCommonUtilsFromDom(),
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
    commonUtils = cusUserScripts.normalizeCommonUtils(data?.commonUtils);
    renderCommonUtils();
    if (cusUserScripts.hasDuplicateMatchPatterns(scripts)) {
      throw new Error("duplicate match patterns");
    }
    if (!isValidCommonUtils(commonUtils)) {
      throw new Error("invalid common utils");
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
  return cusUserScripts.normalizePageScript(raw, {
    matchPattern: defaultMatchPattern,
  });
}

function teardownRows() {
  rowState.forEach((state) => {
    state.modules?.forEach((moduleState) => moduleState.editor.destroy());
  });
  rowState.clear();
  listEl.innerHTML = "";
  if (activeEditorContext?.kind === "script") clearEditorBreadcrumb();
}

function showCopyablePopup(text) {
  const existingPopup = document.querySelector("[data-copyable-popup]");

  if (existingPopup) {
    existingPopup.remove();
  }

  const popup = document.createElement("div");
  popup.dataset.copyablePopup = "true";

  popup.style.position = "fixed";
  popup.style.top = "24px";
  popup.style.right = "24px";
  popup.style.zIndex = "999999";
  popup.style.width = "520px";
  popup.style.maxWidth = "calc(100vw - 48px)";
  popup.style.padding = "12px";
  popup.style.background = "white";
  popup.style.border = "1px solid #ddd";
  popup.style.borderRadius = "8px";
  popup.style.boxShadow = "0 8px 24px rgba(0, 0, 0, 0.18)";

  const closeButton = document.createElement("button");
  closeButton.textContent = "Close";
  closeButton.style.marginBottom = "8px";
  closeButton.addEventListener("click", () => {
    popup.remove();
  });

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.readOnly = true;
  textarea.style.width = "100%";
  textarea.style.height = "320px";
  textarea.style.boxSizing = "border-box";
  textarea.style.resize = "vertical";
  textarea.style.fontFamily = "monospace";
  textarea.style.fontSize = "13px";
  textarea.style.lineHeight = "1.5";

  popup.appendChild(closeButton);
  popup.appendChild(textarea);
  document.body.appendChild(popup);

  textarea.focus();
  textarea.select();
}
