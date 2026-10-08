const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { test } = require("node:test");
const vm = require("node:vm");

test("badge counts registered matching scripts, not modules or disabled/empty scripts", async () => {
  const scripts = [
    script("one", { modules: [moduleCode(), moduleCode()] }),
    script("two"),
    script("off", { enabled: false }),
    script("empty", { code: "" }),
    script("modules-off", { modules: [moduleCode(false)] }),
    script("other", { matchPattern: "https://elsewhere.example/*" }),
    script("unregistered"),
    script("invalid", { matchPattern: "invalid://example/*" }),
  ];
  const app = createBackground({ scripts, registered: scripts.filter((s) => s.id !== "unregistered") });
  await app.idle();
  assert.equal(app.badges.get(1), "2");
  assert.match(app.titles.get(1), /2 active/);
  assert.match(app.titles.get(1), /not execution status/);
});

test("navigation, tab activation and non-web pages refresh tab-specific badges", async () => {
  const app = createBackground({ scripts: [script("one")] });
  await app.idle();
  assert.equal(app.badges.get(1), "1");
  app.tabs.set(2, { id: 2, active: true, url: "https://elsewhere.example/" });
  app.events.activated.fire({ tabId: 2 });
  await app.idle();
  assert.equal(app.badges.get(2), "");
  assert.equal(app.badges.get(1), "1");

  for (const url of ["https://elsewhere.example/", "chrome://extensions/", "about:blank", undefined]) {
    app.navigate(1, url);
    await app.idle();
    assert.equal(app.badges.get(1), "");
    assert.match(app.titles.get(1), /No active scripts/);
  }
  app.navigate(1, "https://news.hada.io/topic?id=2");
  await app.idle();
  assert.equal(app.badges.get(1), "1");
});

test("settings changes refresh all tabs after registration, disable and deletion", async () => {
  const app = createBackground({ scripts: [], registered: [] });
  app.tabs.set(2, { id: 2, active: false, url: "https://news.hada.io/topic?id=2" });
  await app.idle();

  for (const [scripts, expected] of [
    [[script("new")], "1"],
    [[script("new", { enabled: false })], ""],
    [[script("new")], "1"],
    [[], ""],
  ]) {
    app.storage.userScripts = scripts;
    app.events.storage.fire({ userScripts: {} }, "local");
    await app.idle();
    assert.equal(app.badges.get(1), expected);
    assert.equal(app.badges.get(2), expected);
  }
});

test("unavailable or rejected userScripts API clears a previous active badge", async () => {
  const app = createBackground({ scripts: [script("one")] });
  await app.idle();
  const api = app.chrome.userScripts;
  app.chrome.userScripts = undefined;
  await app.context.refreshToolbarBadge(1);
  assert.equal(app.badges.get(1), "");

  app.chrome.userScripts = api;
  await app.context.refreshToolbarBadge(1);
  assert.equal(app.badges.get(1), "1");
  api.getScripts = async () => { throw new Error("Permission revoked"); };
  await app.context.refreshToolbarBadge(1);
  assert.equal(app.badges.get(1), "");
});

test("startup/install and explicit registry sync update badges after Chrome registration", async () => {
  const app = createBackground({ scripts: [script("one")], registered: [] });
  await app.idle();
  assert.equal(app.badges.get(1), "");
  app.events.installed.fire();
  await app.idle();
  assert.equal(app.badges.get(1), "1");

  app.registered.clear();
  app.events.startup.fire();
  await app.idle();
  assert.equal(app.badges.get(1), "1");

  app.storage.userScripts = [];
  let replied = false;
  app.events.message.fire({ type: "cus:sync-registry" }, {}, () => { replied = true; });
  await app.idle();
  assert.equal(app.badges.get(1), "");
  assert.equal(replied, true);
});

test("a delayed old badge write cannot overwrite a newer navigation refresh", async () => {
  const app = createBackground({ scripts: [script("one")] });
  await app.idle();
  let release;
  let started;
  const writing = new Promise((resolve) => { started = resolve; });
  const originalSet = app.chrome.action.setBadgeText;
  app.chrome.action.setBadgeText = async (details) => {
    if (details.text === "1") {
      started();
      await new Promise((resolve) => { release = resolve; });
    }
    await originalSet(details);
  };
  const oldRefresh = app.context.refreshToolbarBadge(1);
  await writing;
  app.navigate(1, "https://elsewhere.example/");
  release();
  await oldRefresh;
  await app.idle();
  assert.equal(app.badges.get(1), "");
  assert.equal(vm.runInContext("toolbarRefreshes.size", app.context), 0);

  app.tabs.delete(1);
  await app.context.refreshToolbarBadge(1);
  assert.equal(vm.runInContext("toolbarRefreshes.size", app.context), 0);
});

function createBackground({ scripts, registered = scripts }) {
  const events = Object.fromEntries(
    ["activated", "updated", "installed", "startup", "storage", "message"].map((key) => [key, event()])
  );
  const tabs = new Map([[1, { id: 1, active: true, url: "https://news.hada.io/topic?id=1" }]]);
  const storage = { userScripts: scripts };
  const registry = new Map(registered.map((s) => [`cus-${s.id}`, { id: `cus-${s.id}` }]));
  const badges = new Map();
  const titles = new Map();
  const chrome = {
    tabs: {
      onActivated: events.activated,
      onUpdated: events.updated,
      query: async () => [...tabs.values()],
      get: async (id) => {
        if (!tabs.has(id)) throw new Error("Tab closed");
        return { ...tabs.get(id) };
      },
    },
    storage: {
      local: { get: async () => storage },
      session: { set: async () => {} },
      onChanged: events.storage,
    },
    runtime: { onInstalled: events.installed, onStartup: events.startup, onMessage: events.message },
    userScripts: {
      getScripts: async () => [...registry.values()],
      register: async (definitions) => definitions.forEach((d) => registry.set(d.id, d)),
      update: async (definitions) => definitions.forEach((d) => registry.set(d.id, d)),
      unregister: async ({ ids }) => ids.forEach((id) => registry.delete(id)),
    },
    action: {
      setBadgeText: async ({ tabId, text }) => { badges.set(tabId, text); },
      setTitle: async ({ tabId, title }) => { titles.set(tabId, title); },
      setBadgeBackgroundColor: async () => {},
      setBadgeTextColor: async () => {},
    },
    i18n: { getMessage: () => "" },
  };
  const context = vm.createContext({ chrome, console: { ...console, debug() {} } });
  context.importScripts = (...paths) => {
    for (const path of paths) vm.runInContext(readFileSync(path, "utf8"), context);
  };
  vm.runInContext(readFileSync("background.js", "utf8"), context);
  return {
    context, chrome, tabs, storage, badges, titles, events, registered: registry,
    navigate(id, url) {
      const tab = { ...tabs.get(id), url };
      tabs.set(id, tab);
      events.updated.fire(id, { url, status: "complete" }, tab);
    },
    async idle() {
      await new Promise((resolve) => setImmediate(resolve));
      await vm.runInContext("registrySyncChain", context);
      await Promise.all(vm.runInContext("[...toolbarRefreshes.values()]", context));
    },
  };
}

function script(id, overrides = {}) {
  return { id, enabled: true, matchPattern: "https://news.hada.io/topic*", code: "console.log('active');", ...overrides };
}

function moduleCode(enabled = true) {
  return { enabled, code: "console.log('module');" };
}

function event() {
  const listeners = [];
  return {
    addListener(listener) { listeners.push(listener); },
    fire(...args) { for (const listener of listeners) listener(...args); },
  };
}
