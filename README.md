# crx-userscript

Chrome extension for user scripts on the current page (MV3 + `chrome.userScripts`).

## Setup

```sh
pnpm install
pnpm run build:codemirror
```

> ⚠️ **필수:** `pnpm run build:codemirror` 를 꼭 실행하세요.  
> CodeMirror 에디터 번들(`vendor/codemirror/codemirror.bundle.js`)은 git에 포함되지 않습니다.  
> 빌드하지 않으면 Options 페이지 에디터가 동작하지 않습니다. 🚨

1. Open `chrome://extensions`, enable **Developer mode**
2. **Load unpacked** → select this directory
3. Open extension **Details** → enable **Allow user scripts**

## UI

- **Toolbar badge**: green count of enabled, non-empty scripts matching the tab URL
  and registered with Chrome. Counts scripts, not modules; hidden when none apply.
  Updates on navigation, tab activation, and settings/registry changes. This shows
  configured activation, not successful execution; saved changes still need a page reload.
- **Popup** (toolbar icon): scripts matching the active tab, status indicator, enable toggle, reload tab
- **Options**: add/edit scripts, URL pattern hints, import/export JSON

## Script APIs

Page-script modules and common-util modules can use the extension-provided
`userscript` namespace. It is injected into each script’s scope, not installed on
`window`, and does not require common utils to be enabled.

```js
const style = document.createElement("style");
style.textContent = ".gn-ad-slot, .gn-ad-slot * { visibility: hidden !important; }";
document.head.appendChild(style);

userscript.registerCleanup(() => style.remove());
```

- `userscript.registerCleanup(fn)` registers a synchronous cleanup callback. The
  extension runs it on teardown when script/common-utils settings change. It does
  not run immediately. Register DOM, listener, or timer cleanup here.
- `registerCleanup(fn)` remains a backward-compatible alias. Prefer the namespace
  in new code.
- `utils` is separate: it contains exports from your enabled common-util modules,
  not extension runtime APIs. It may be absent when no valid utilities are enabled.
- The editor suggests `userscript` and `userscript.registerCleanup`, with API
  descriptions (Ctrl+Space also opens completion).
- Scripts are injected at `document_idle`. Reload the target page to run updated
  code; changing settings tears down old code but does not immediately run new code.
- These are classic scripts, not ES modules: native static `import` is unsupported.
  The common-utils `export const utils = ...` syntax is transformed by the extension.

## Import from MinTool

Export JSON from the old MinTool user scripts UI (if any), then **Import** on the options page. Format: `{ "version": 1, "userScripts": [...] }`.
