var cusUserScripts = globalThis.cusUserScripts || {};
globalThis.cusUserScripts = cusUserScripts;

const COMMON_UTILS_EXPORT_RE = /^\s*export\s+const\s+utils\s*=/;

cusUserScripts.COMMON_UTILS_EXPORT_RE = COMMON_UTILS_EXPORT_RE;

cusUserScripts.createCommonUtilsModuleId = function createCommonUtilsModuleId() {
  return `cu-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
};

cusUserScripts.createEmptyCommonUtilsModule = function createEmptyCommonUtilsModule() {
  return {
    id: cusUserScripts.createCommonUtilsModuleId(),
    name: "",
    enabled: true,
    code: "",
  };
};

/**
 * Normalize storage / import payloads.
 * Legacy shape `{ enabled, code }` becomes one module.
 */
cusUserScripts.normalizeCommonUtils = function normalizeCommonUtils(raw) {
  const enabled = raw?.enabled !== false;

  if (Array.isArray(raw?.modules)) {
    return {
      enabled,
      modules: raw.modules.map((module) => normalizeModule(module)),
    };
  }

  const legacyCode = typeof raw?.code === "string" ? raw.code : "";
  if (!legacyCode.trim()) {
    return { enabled, modules: [] };
  }

  return {
    enabled,
    modules: [
      normalizeModule({
        id: cusUserScripts.createCommonUtilsModuleId(),
        name: "utils",
        enabled: true,
        code: legacyCode,
      }),
    ],
  };
};

function normalizeModule(raw) {
  return {
    id:
      typeof raw?.id === "string" && raw.id
        ? raw.id
        : cusUserScripts.createCommonUtilsModuleId(),
    name: typeof raw?.name === "string" ? raw.name : "",
    enabled: raw?.enabled !== false,
    code: typeof raw?.code === "string" ? raw.code : "",
  };
}

cusUserScripts.isValidCommonUtilsExport = function isValidCommonUtilsExport(code) {
  return COMMON_UTILS_EXPORT_RE.test(String(code || ""));
};

/**
 * Extract top-level property names from `export const utils = { ... }`.
 * Supports identifier props, method shorthand, async methods, and quoted keys.
 * Computed keys (`[expr]`) are rejected as unscannable.
 */
cusUserScripts.extractUtilsPropertyKeys = function extractUtilsPropertyKeys(code) {
  const source = String(code || "");
  if (!COMMON_UTILS_EXPORT_RE.test(source)) {
    return { ok: false, keys: [], reason: "invalid_export" };
  }

  const assignMatch = source.match(/export\s+const\s+utils\s*=/);
  if (!assignMatch) {
    return { ok: false, keys: [], reason: "invalid_export" };
  }

  let index = assignMatch.index + assignMatch[0].length;
  while (index < source.length && /\s/.test(source[index])) index += 1;
  if (source[index] !== "{") {
    return { ok: false, keys: [], reason: "not_object" };
  }

  const keys = [];
  let depth = 0;
  let inString = null;
  let escape = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (; index < source.length; index += 1) {
    const ch = source[index];
    const next = source[index + 1];

    if (inLineComment) {
      if (ch === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === inString) inString = null;
      continue;
    }

    if (ch === "/" && next === "/") {
      inLineComment = true;
      index += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      index += 1;
      continue;
    }

    if (depth === 1) {
      if (ch === "[") {
        return { ok: false, keys: [], reason: "computed_key" };
      }

      const rest = source.slice(index);
      const asyncMethod = rest.match(/^async\s+([A-Za-z_$][\w$]*)\s*\(/);
      if (asyncMethod) {
        keys.push(asyncMethod[1]);
        index += asyncMethod[0].length - 1;
        continue;
      }

      const method = rest.match(/^([A-Za-z_$][\w$]*)\s*\(/);
      if (method) {
        keys.push(method[1]);
        index += method[0].length - 1;
        continue;
      }

      const prop = rest.match(/^([A-Za-z_$][\w$]*)\s*:/);
      if (prop) {
        keys.push(prop[1]);
        index += prop[0].length - 1;
        continue;
      }

      const quoted = rest.match(/^("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')\s*:/);
      if (quoted) {
        keys.push(quoted[1].slice(1, -1).replace(/\\(.)/g, "$1"));
        index += quoted[0].length - 1;
        continue;
      }
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch;
      continue;
    }

    if (ch === "{") {
      depth += 1;
      continue;
    }
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) break;
      continue;
    }
  }

  if (depth !== 0) {
    return { ok: false, keys: [], reason: "unbalanced" };
  }

  return { ok: true, keys };
};

/**
 * @returns {{ key: string, modules: Array<{ id: string, name: string }> }[]}
 */
cusUserScripts.findCommonUtilsKeyConflicts = function findCommonUtilsKeyConflicts(
  commonUtils
) {
  const normalized = cusUserScripts.normalizeCommonUtils(commonUtils);
  const ownersByKey = new Map();

  for (const module of normalized.modules) {
    if (!module.enabled) continue;
    const code = String(module.code || "").trim();
    if (!code) continue;

    const extracted = cusUserScripts.extractUtilsPropertyKeys(code);
    if (!extracted.ok) continue;

    const label = module.name.trim() || module.id;
    for (const key of extracted.keys) {
      if (!ownersByKey.has(key)) ownersByKey.set(key, []);
      ownersByKey.get(key).push({ id: module.id, name: label });
    }
  }

  const conflicts = [];
  for (const [key, modules] of ownersByKey) {
    const uniqueIds = new Set(modules.map((item) => item.id));
    if (uniqueIds.size > 1) {
      conflicts.push({ key, modules });
    }
  }
  return conflicts;
};

cusUserScripts.validateCommonUtils = function validateCommonUtils(commonUtils) {
  const normalized = cusUserScripts.normalizeCommonUtils(commonUtils);
  if (!normalized.enabled) {
    return { ok: true, conflicts: [] };
  }

  for (const module of normalized.modules) {
    if (!module.enabled) continue;
    const code = String(module.code || "").trim();
    if (!code) continue;
    if (!cusUserScripts.isValidCommonUtilsExport(code)) {
      return {
        ok: false,
        reason: "invalid_export",
        moduleId: module.id,
        conflicts: [],
      };
    }
    const extracted = cusUserScripts.extractUtilsPropertyKeys(code);
    if (!extracted.ok) {
      return {
        ok: false,
        reason: extracted.reason || "invalid_export",
        moduleId: module.id,
        conflicts: [],
      };
    }
  }

  const conflicts = cusUserScripts.findCommonUtilsKeyConflicts(normalized);
  if (conflicts.length) {
    return { ok: false, reason: "key_conflict", conflicts };
  }
  return { ok: true, conflicts: [] };
};

/**
 * Build injectable `const utils = ...` code from enabled modules.
 * Returns "" when disabled, empty, invalid, or conflicting.
 */
cusUserScripts.buildCommonUtilsCode = function buildCommonUtilsCode(commonUtils) {
  const normalized = cusUserScripts.normalizeCommonUtils(commonUtils);
  if (!normalized.enabled) return "";

  const activeModules = normalized.modules.filter(
    (module) => module.enabled && String(module.code || "").trim()
  );
  if (!activeModules.length) return "";

  const validation = cusUserScripts.validateCommonUtils(normalized);
  if (!validation.ok) {
    console.warn(
      "[cus:user-script] common utils skipped:",
      validation.reason,
      validation.conflicts || []
    );
    return "";
  }

  if (activeModules.length === 1) {
    return activeModules[0].code.replace(COMMON_UTILS_EXPORT_RE, "const utils =");
  }

  const parts = activeModules.map((module) => {
    const body = module.code.replace(COMMON_UTILS_EXPORT_RE, "const utils =");
    return `  (() => {
${body}
    Object.assign(__utils, utils);
  })();`;
  });

  return `const utils = (() => {
  const __utils = {};
${parts.join("\n")}
  return __utils;
})();`;
};
