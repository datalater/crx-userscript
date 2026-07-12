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

- **Popup** (toolbar icon): scripts matching the active tab, status indicator, enable toggle, reload tab
- **Options**: add/edit scripts, URL pattern hints, import/export JSON

## Import from MinTool

Export JSON from the old MinTool user scripts UI (if any), then **Import** on the options page. Format: `{ "version": 1, "userScripts": [...] }`.
