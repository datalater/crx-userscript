const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { test } = require("node:test");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");

function createOptionsDom() {
  return new JSDOM(
    `<!doctype html>
    <div id="page-loading"></div>
    <span id="save-status"></span>
    <input id="import-file" type="file">
    <p id="api-warning"></p>
    <div class="toolbar"></div>
    <button id="btn-refresh"></button>
    <button id="btn-add"></button>
    <button id="btn-export"></button>
    <button id="btn-import"></button>
    <button class="options-tab is-active" data-panel="scripts"></button>
    <button class="options-tab" data-panel="common-utils"></button>
    <main id="panel-scripts">
      <div id="script-list" hidden></div>
    </main>
    <section id="panel-common-utils" hidden>
      <input id="common-utils-enabled" type="checkbox">
      <p id="common-utils-conflict" hidden></p>
      <div id="common-utils-list"></div>
      <p id="common-utils-empty" hidden></p>
    </section>
    <p id="editor-breadcrumb" hidden></p>`,
    {
      pretendToBeVisual: true,
      url: "chrome-extension://test/options/options.html",
    }
  );
}

async function waitFor(predicate) {
  for (let i = 0; i < 20; i += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("condition was not met");
}

function loadOptionsScript(window, { setCalls }) {
  window.CUS_STORAGE_KEY = "scripts";
  window.CUS_COMMON_UTILS_STORAGE_KEY = "commonUtils";
  window.CUS_FOCUS_SCRIPT_ID_KEY = "focusScriptId";
  window.CUS_REFERENCE_TAB_URL_KEY = "referenceTabUrl";
  window.chrome = {
    i18n: {
      getMessage: () => "",
    },
    runtime: {
      sendMessage: async () => {},
    },
    storage: {
      local: {
        get: async () => ({
          scripts: [
            {
              id: "script-1",
              name: "Before",
              matchPattern: "https://example.com/*",
              enabled: true,
              code: "console.log('before');",
            },
          ],
        }),
        set: async (value) => {
          setCalls.push(value);
        },
      },
      session: {
        get: async () => ({}),
        remove: async () => {},
      },
    },
    tabs: {
      query: async () => [{ url: "https://example.com/page" }],
    },
    userScripts: {
      getScripts: async () => [],
    },
  };
  window.cusUserScripts = {
    findScriptWithMatchPattern: () => null,
    hasDuplicateMatchPatterns: () => false,
    isWebUrl: (url) => typeof url === "string" && url.startsWith("https://"),
    matchPatternToRegExp: () => /./,
    toChromeMatchPatterns: (pattern) => [pattern],
    urlMatchesPattern: () => true,
    urlToMatchPattern: () => "https://example.com/*",
    EDITOR_MIN_LINES: 8,
    EDITOR_MAX_LINES: 48,
    normalizeCommonUtils: (raw) => ({
      enabled: raw?.enabled !== false,
      modules: Array.isArray(raw?.modules) ? raw.modules : [],
    }),
    createEmptyCommonUtilsModule: () => ({
      id: "cu-new",
      name: "",
      enabled: true,
      code: "",
    }),
    validateCommonUtils: () => ({ ok: true, conflicts: [] }),
    findCommonUtilsKeyConflicts: () => [],
  };
  window.evaluateScriptStatus = () => "active";
  window.getScriptStatusMessage = () => "active";
  window.statusIndicatorClass = () => "ok";
  window.createLightCodeEditor = (_host, options) => {
    let value = options.value;
    return {
      destroy() {},
      focus() {},
      getValue() {
        return value;
      },
      setValue(nextValue) {
        value = nextValue;
      },
    };
  };

  const source = readFileSync("options/options.js", "utf8");
  vm.runInContext(source, vm.createContext(window));
}

test("Command+S prevents the browser save dialog and saves current scripts immediately", async () => {
  const dom = createOptionsDom();
  const { window } = dom;
  const setCalls = [];

  loadOptionsScript(window, { setCalls });
  await waitFor(() => window.document.querySelector(".script-card"));

  const nameInput = window.document.querySelector(".script-card__meta input");
  nameInput.value = "After";

  const event = new window.KeyboardEvent("keydown", {
    key: "s",
    metaKey: true,
    bubbles: true,
    cancelable: true,
  });
  window.document.dispatchEvent(event);

  await waitFor(() => setCalls.length === 1);

  assert.equal(event.defaultPrevented, true);
  assert.equal(setCalls[0].scripts[0].name, "After");
});
