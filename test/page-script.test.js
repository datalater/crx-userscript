const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { test } = require("node:test");
const vm = require("node:vm");

function loadPageScriptLib() {
  const context = { console, globalThis: {} };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(readFileSync("lib/page-script.js", "utf8"), context);
  return context.cusUserScripts;
}

test("normalizePageScript migrates legacy code into one module", () => {
  const api = loadPageScriptLib();
  const normalized = api.normalizePageScript({
    id: "us-1",
    name: "ChatGPT",
    matchPattern: "https://chatgpt.com/*",
    enabled: true,
    code: "console.log(1);",
  });

  assert.equal(normalized.modules.length, 1);
  assert.equal(normalized.modules[0].code, "console.log(1);");
  assert.equal(normalized.code, undefined);
});

test("buildPageScriptCode wraps enabled modules in isolated IIFEs", () => {
  const api = loadPageScriptLib();
  const code = api.buildPageScriptCode({
    id: "us-1",
    matchPattern: "https://example.com/*",
    enabled: true,
    modules: [
      { id: "a", name: "one", enabled: true, code: "const x = 1;" },
      { id: "b", name: "two", enabled: false, code: "const y = 2;" },
      { id: "c", name: "three", enabled: true, code: "const z = 3;" },
    ],
  });

  assert.ok(code.includes("cus:module one"));
  assert.ok(code.includes("cus:module three"));
  assert.equal(code.includes("cus:module two"), false);
  assert.ok(code.includes("(() => {"));
  assert.ok(code.includes("const x = 1;"));
  assert.ok(code.includes("const z = 3;"));
});
