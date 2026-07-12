const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { test } = require("node:test");
const vm = require("node:vm");

function loadSyncScript({ storageValue, registeredScripts = [] }) {
  const registeredDefinitions = [];
  const context = {
    console,
    chrome: {
      storage: {
        local: {
          get: async () => storageValue,
        },
      },
      userScripts: {
        getScripts: async () => registeredScripts,
        register: async (definitions) => {
          registeredDefinitions.push(...definitions);
        },
        unregister: async () => {},
        update: async (definitions) => {
          registeredDefinitions.push(...definitions);
        },
      },
    },
  };

  context.globalThis = context;
  context.importScripts = (...paths) => {
    for (const path of paths) {
      vm.runInContext(readFileSync(path, "utf8"), context);
    }
  };

  vm.createContext(context);
  vm.runInContext(readFileSync("lib/sync.js", "utf8"), context);

  return { context, registeredDefinitions };
}

function loadCommonUtilsLib() {
  const context = { console, globalThis: {} };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(readFileSync("lib/common-utils.js", "utf8"), context);
  return context.cusUserScripts;
}

test("sync prepends exported utils namespace before each page script", async () => {
  const { context, registeredDefinitions } = loadSyncScript({
    storageValue: {
      commonUtils: {
        enabled: true,
        code: `export const utils = {
  qs(selector) {
    return document.querySelector(selector);
  },
};`,
      },
      userScripts: [
        {
          id: "script-1",
          matchPattern: "https://example.com/*",
          enabled: true,
          code: "console.log(utils.qs('h1'));",
        },
      ],
    },
  });

  await context.syncUserScriptsRegistry();

  assert.equal(registeredDefinitions.length, 1);
  const code = registeredDefinitions[0].js[0].code;
  assert.ok(code.includes("const utils = {"));
  assert.equal(code.includes("export const utils"), false);
  assert.ok(code.indexOf("const utils = {") < code.indexOf("console.log(utils.qs('h1'));"));
});

test("sync merges multiple common util modules into one utils object", async () => {
  const { context, registeredDefinitions } = loadSyncScript({
    storageValue: {
      commonUtils: {
        enabled: true,
        modules: [
          {
            id: "cu-1",
            name: "dom",
            enabled: true,
            code: `export const utils = {
  qs(selector) {
    return document.querySelector(selector);
  },
};`,
          },
          {
            id: "cu-2",
            name: "time",
            enabled: true,
            code: `export const utils = {
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  },
};`,
          },
        ],
      },
      userScripts: [
        {
          id: "script-1",
          matchPattern: "https://example.com/*",
          enabled: true,
          code: "console.log(utils.qs, utils.sleep);",
        },
      ],
    },
  });

  await context.syncUserScriptsRegistry();

  const code = registeredDefinitions[0].js[0].code;
  assert.ok(code.includes("Object.assign(__utils, utils)"));
  assert.ok(code.includes("qs(selector)"));
  assert.ok(code.includes("sleep(ms)"));
  assert.equal(code.includes("export const utils"), false);
});

test("sync skips common utils when module keys conflict", async () => {
  const { context, registeredDefinitions } = loadSyncScript({
    storageValue: {
      commonUtils: {
        enabled: true,
        modules: [
          {
            id: "cu-1",
            name: "dom",
            enabled: true,
            code: "export const utils = { qs() {} };",
          },
          {
            id: "cu-2",
            name: "other",
            enabled: true,
            code: "export const utils = { qs() {} };",
          },
        ],
      },
      userScripts: [
        {
          id: "script-1",
          matchPattern: "https://example.com/*",
          enabled: true,
          code: "console.log('page');",
        },
      ],
    },
  });

  await context.syncUserScriptsRegistry();

  const code = registeredDefinitions[0].js[0].code;
  assert.equal(code.includes("const utils"), false);
  assert.ok(code.includes("console.log('page')"));
});

test("common-utils extracts keys and detects conflicts", () => {
  const api = loadCommonUtilsLib();

  const extracted = api.extractUtilsPropertyKeys(`export const utils = {
  qs(selector) {},
  async sleep(ms) {},
  "label": 1,
};`);
  assert.equal(extracted.ok, true);
  assert.deepEqual(Array.from(extracted.keys), ["qs", "sleep", "label"]);

  const legacy = api.normalizeCommonUtils({
    enabled: true,
    code: "export const utils = { qs() {} };",
  });
  assert.equal(legacy.modules.length, 1);
  assert.equal(legacy.modules[0].name, "utils");

  const conflicts = api.findCommonUtilsKeyConflicts({
    enabled: true,
    modules: [
      {
        id: "a",
        name: "dom",
        enabled: true,
        code: "export const utils = { qs() {} };",
      },
      {
        id: "b",
        name: "x",
        enabled: true,
        code: "export const utils = { qs() {}, sleep() {} };",
      },
    ],
  });
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].key, "qs");

  const validation = api.validateCommonUtils({
    enabled: true,
    modules: [
      {
        id: "a",
        name: "dom",
        enabled: true,
        code: "export const utils = { qs() {} };",
      },
      {
        id: "b",
        name: "time",
        enabled: true,
        code: "export const utils = { sleep() {} };",
      },
    ],
  });
  assert.equal(validation.ok, true);
});
