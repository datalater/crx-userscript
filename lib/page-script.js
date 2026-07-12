var cusUserScripts = globalThis.cusUserScripts || {};
globalThis.cusUserScripts = cusUserScripts;

cusUserScripts.createPageScriptModuleId = function createPageScriptModuleId() {
  return `sm-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
};

cusUserScripts.createEmptyPageScriptModule = function createEmptyPageScriptModule(
  overrides = {}
) {
  return {
    id: cusUserScripts.createPageScriptModuleId(),
    name: "",
    enabled: true,
    code: "",
    ...overrides,
  };
};

/**
 * Normalize a page script from storage / import.
 * Legacy `{ code }` becomes a single module.
 */
cusUserScripts.normalizePageScript = function normalizePageScript(raw, defaults = {}) {
  const defaultPattern =
    typeof defaults.matchPattern === "string" ? defaults.matchPattern : "https?://*/*";

  const base = {
    id:
      typeof raw?.id === "string" && raw.id
        ? raw.id
        : `us-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    name: typeof raw?.name === "string" ? raw.name : "",
    matchPattern:
      typeof raw?.matchPattern === "string" && raw.matchPattern
        ? raw.matchPattern
        : defaultPattern,
    enabled: raw?.enabled !== false,
  };

  if (Array.isArray(raw?.modules)) {
    return {
      ...base,
      modules: raw.modules.map((module) => normalizePageScriptModule(module)),
    };
  }

  const legacyCode = typeof raw?.code === "string" ? raw.code : "";
  return {
    ...base,
    modules: [
      normalizePageScriptModule({
        id: cusUserScripts.createPageScriptModuleId(),
        name: base.name || "main",
        enabled: true,
        code: legacyCode,
      }),
    ],
  };
};

function normalizePageScriptModule(raw) {
  return {
    id:
      typeof raw?.id === "string" && raw.id
        ? raw.id
        : cusUserScripts.createPageScriptModuleId(),
    name: typeof raw?.name === "string" ? raw.name : "",
    enabled: raw?.enabled !== false,
    code: typeof raw?.code === "string" ? raw.code : "",
  };
}

cusUserScripts.getEnabledPageScriptModules = function getEnabledPageScriptModules(
  script
) {
  const normalized = cusUserScripts.normalizePageScript(script);
  return normalized.modules.filter(
    (module) => module.enabled && String(module.code || "").trim()
  );
};

cusUserScripts.hasRunnablePageScriptCode = function hasRunnablePageScriptCode(script) {
  return cusUserScripts.getEnabledPageScriptModules(script).length > 0;
};

/**
 * Build injectable page-script body from enabled modules.
 * Each module runs in its own IIFE so locals stay isolated, while
 * `registerCleanup` from the outer wrapper remains available via closure.
 */
cusUserScripts.buildPageScriptCode = function buildPageScriptCode(script) {
  const modules = cusUserScripts.getEnabledPageScriptModules(script);
  if (!modules.length) return "";

  return modules
    .map((module) => {
      const label = module.name.trim() || module.id;
      return `(() => {\n  /* cus:module ${label} */\n${module.code}\n})();`;
    })
    .join("\n\n");
};
