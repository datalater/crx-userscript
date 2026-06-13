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
