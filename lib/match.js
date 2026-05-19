var cusUserScripts = globalThis.cusUserScripts || {};

cusUserScripts.isWebUrl = function isWebUrl(url) {
  return Boolean(url && /^https?:/i.test(url));
};

cusUserScripts.urlToMatchPattern = function urlToMatchPattern(url) {
  try {
    const parsed = new URL(url);
    if (!/^https?:$/i.test(parsed.protocol) || !parsed.host) {
      return "https?://*/*";
    }
    return `https?://${parsed.host}/*`;
  } catch {
    return "https?://*/*";
  }
};

cusUserScripts.normalizeUrlForMatch = function normalizeUrlForMatch(url) {
  try {
    const parsed = new URL(url);
    if (/^https?:$/i.test(parsed.protocol)) {
      return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
    }
  } catch {
    /* fall through */
  }
  return String(url).split(/[?#]/)[0];
};

cusUserScripts.urlMatchesPattern = function urlMatchesPattern(pattern, url) {
  if (!pattern || !url) return false;
  const re = cusUserScripts.matchPatternToRegExp(pattern);
  return re ? re.test(cusUserScripts.normalizeUrlForMatch(url)) : false;
};

cusUserScripts.normalizeMatchPattern = function normalizeMatchPattern(pattern) {
  return String(pattern || "").trim().toLowerCase();
};

cusUserScripts.findScriptWithMatchPattern = function findScriptWithMatchPattern(
  pattern,
  scripts,
  exceptId
) {
  const key = cusUserScripts.normalizeMatchPattern(pattern);
  if (!key || !Array.isArray(scripts)) return null;

  for (const script of scripts) {
    if (exceptId && script.id === exceptId) continue;
    if (cusUserScripts.normalizeMatchPattern(script.matchPattern) === key) {
      return script;
    }
  }
  return null;
};

cusUserScripts.hasDuplicateMatchPatterns = function hasDuplicateMatchPatterns(scripts) {
  if (!Array.isArray(scripts)) return false;
  const seen = new Set();
  for (const script of scripts) {
    const key = cusUserScripts.normalizeMatchPattern(script.matchPattern);
    if (!key) continue;
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
};

cusUserScripts.matchPatternToRegExp = function matchPatternToRegExp(pattern) {
  const trimmed = String(pattern).trim();
  if (!trimmed) return null;

  let scheme = "*";
  let remainder = trimmed;
  const schemeMatch = trimmed.match(/^([*]|https\?|https|http|file|ftp):\/\/(.+)$/i);
  if (schemeMatch) {
    scheme = schemeMatch[1].toLowerCase();
    remainder = schemeMatch[2];
  } else if (trimmed.includes("://")) {
    return null;
  }

  const slashIndex = remainder.indexOf("/");
  const hostPart = slashIndex === -1 ? remainder : remainder.slice(0, slashIndex);
  const pathPart = slashIndex === -1 ? "/*" : remainder.slice(slashIndex) || "/*";

  const schemeRe = schemeToRegExp(scheme);
  const hostRe = hostPartToRegExp(hostPart);
  const pathRe = wildcardToRegExp(pathPart);

  return new RegExp(`^${schemeRe}://${hostRe}${pathRe}$`, "i");
};

cusUserScripts.toChromeMatchPatterns = function toChromeMatchPatterns(pattern) {
  let value = String(pattern || "").trim();
  if (!value) return ["<all_urls>"];

  value = value.replace(/^https\?:\/\//i, "*://");
  if (!/^[a-z*][a-z0-9+.-]*:\/\//i.test(value)) {
    value = `*://${value.replace(/^\/+/, "")}`;
  }

  return [value];
};

function schemeToRegExp(scheme) {
  if (scheme === "*") return "(https?|http|file|ftp)";
  if (scheme === "https?") return "(https|http)";
  return escapeRegex(scheme);
}

function hostPartToRegExp(host) {
  return host
    .split(".")
    .map((segment) => {
      if (segment === "*") return "[^.]+";
      if (segment.startsWith("*")) return `.*${escapeRegex(segment.slice(1))}`;
      return escapeRegex(segment);
    })
    .join("\\.");
}

function wildcardToRegExp(path) {
  // Trailing /* = this path plus optional subpaths (Chrome-style; slash not required)
  if (path.endsWith("/*")) {
    const prefix = path.slice(0, -2);
    let out = "";
    for (const char of prefix) {
      out += char === "*" ? ".*" : escapeRegex(char);
    }
    return `${out}(?:\\/.*)?`;
  }

  let out = "";
  for (const char of path) {
    out += char === "*" ? ".*" : escapeRegex(char);
  }
  return out;
}

function escapeRegex(value) {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

globalThis.cusUserScripts = cusUserScripts;
