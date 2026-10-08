const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { test } = require("node:test");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");

test("namespaced and legacy cleanup restore their DOM only for the matching script teardown", () => {
  const dom = new JSDOM("<!doctype html><head></head><body></body>", {
    runScripts: "outside-only",
  });
  const { window } = dom;
  try {
    window.eval(buildCode({
      id: "ads",
      modules: [
        {
          enabled: true,
          code: `const style = document.createElement("style");
            style.id = "namespaced-style";
            document.head.append(style);
            userscript.registerCleanup(() => style.remove());`,
        },
        {
          enabled: true,
          code: `const style = document.createElement("style");
            style.id = "legacy-style";
            document.head.append(style);
            registerCleanup(() => style.remove());`,
        },
      ],
    }));
    assert.ok(window.document.getElementById("namespaced-style"));
    assert.ok(window.document.getElementById("legacy-style"));

    sendTeardown(window, "another-script");
    assert.ok(window.document.getElementById("namespaced-style"));
    assert.ok(window.document.getElementById("legacy-style"));

    sendTeardown(window, "ads");
    assert.equal(window.document.getElementById("namespaced-style"), null);
    assert.equal(window.document.getElementById("legacy-style"), null);
  } finally {
    window.close();
  }
});

test("common utils can register cleanup through the runtime without exporting it", () => {
  const dom = new JSDOM("<!doctype html><body></body>", {
    runScripts: "outside-only",
  });
  const { window } = dom;
  try {
    window.eval(buildCode({
      id: "with-utils",
      code: "utils.mark();",
    }, {
      enabled: true,
      modules: [{
        enabled: true,
        code: `export const utils = {
          mark() { document.body.dataset.active = "true"; }
        };
        userscript.registerCleanup(() => delete document.body.dataset.active);`,
      }],
    }));
    assert.equal(window.document.body.dataset.active, "true");
    assert.equal(window.userscript, undefined);
    sendTeardown(window, "with-utils");
    assert.equal(window.document.body.dataset.active, undefined);
  } finally {
    window.close();
  }
});

function buildCode(script, commonUtils = null) {
  const context = vm.createContext({ console });
  context.importScripts = (...paths) => {
    for (const path of paths) {
      vm.runInContext(readFileSync(path, "utf8"), context);
    }
  };
  vm.runInContext(readFileSync("lib/sync.js", "utf8"), context);
  return context.buildUserScriptDefinition({
    matchPattern: "https://news.hada.io/topic*",
    enabled: true,
    ...script,
  }, commonUtils).js[0].code;
}

function sendTeardown(window, scriptId) {
  window.dispatchEvent(new window.MessageEvent("message", {
    source: window,
    data: { type: "[cus] user-script-teardown", scriptId },
  }));
}
