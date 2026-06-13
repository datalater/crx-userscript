# crx-userscript

Chrome extension for user scripts on the current page (MV3 + `chrome.userScripts`).

## Setup

```sh
pnpm install
pnpm run build:codemirror
```

1. Open `chrome://extensions`, enable **Developer mode**
2. **Load unpacked** → select this directory
3. Open extension **Details** → enable **Allow user scripts**

## UI

- **Popup** (toolbar icon): scripts matching the active tab, status indicator, enable toggle, reload tab
- **Options**: add/edit scripts, URL pattern hints, import/export JSON

## Import from MinTool

Export JSON from the old MinTool user scripts UI (if any), then **Import** on the options page. Format: `{ "version": 1, "userScripts": [...] }`.
