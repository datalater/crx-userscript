const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { test } = require("node:test");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");

function loadScript(window, relativePath) {
  const source = readFileSync(relativePath, "utf8");
  vm.runInContext(source, vm.createContext(window));
}

function loadEditorConfig(window) {
  loadScript(window, "lib/editor-config.js");
}

function loadEditorScript(window) {
  loadScript(window, "lib/light-code-editor.js");
}

test("createLightCodeEditor delegates to the CodeMirror adapter and preserves the public API", () => {
  const dom = new JSDOM("<!doctype html><div id=\"host\"></div>");
  const { window } = dom;
  const host = window.document.getElementById("host");
  const calls = [];

  loadEditorConfig(window);

  window.createCodeMirrorEditor = (options) => {
    calls.push(options);
    let value = options.doc;
    return {
      getValue() {
        return value;
      },
      setValue(nextValue) {
        value = nextValue;
      },
      focus() {
        calls.push({ method: "focus" });
      },
      destroy() {
        calls.push({ method: "destroy" });
      },
    };
  };

  loadEditorScript(window);

  const editor = window.createLightCodeEditor(host, {
    value: "const a = 1;",
    placeholder: "code",
    onChange: () => {},
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].parent, host);
  assert.equal(calls[0].doc, "const a = 1;");
  assert.equal(calls[0].placeholder, "code");
  assert.equal(calls[0].minLines, window.cusUserScripts.EDITOR_MIN_LINES);
  assert.equal(calls[0].maxLines, window.cusUserScripts.EDITOR_MAX_LINES);
  assert.equal(window.cusUserScripts.EDITOR_MAX_LINES, 50);

  assert.equal(editor.getValue(), "const a = 1;");
  editor.setValue("let b = 2;");
  assert.equal(editor.getValue(), "let b = 2;");

  editor.focus();
  editor.destroy();
  assert.deepEqual(calls.slice(1), [{ method: "focus" }, { method: "destroy" }]);
});

test("built CodeMirror bundle creates a working editor instance", () => {
  const dom = new JSDOM("<!doctype html><div id=\"host\"></div>", {
    pretendToBeVisual: true,
  });
  const { window } = dom;

  loadEditorConfig(window);
  vm.runInContext(
    readFileSync("vendor/codemirror/codemirror.bundle.js", "utf8"),
    vm.createContext(window)
  );
  loadEditorScript(window);

  const host = window.document.getElementById("host");
  const editor = window.createLightCodeEditor(host, {
    value: "const a = 1;",
    placeholder: "code",
    minLines: 3,
    onChange: () => {},
  });

  assert.equal(typeof window.createCodeMirrorEditor, "function");
  assert.equal(editor.getValue(), "const a = 1;");
  assert.ok(host.querySelector(".cm-editor"));

  editor.setValue("let b = 2;");
  assert.equal(editor.getValue(), "let b = 2;");
  editor.destroy();
});

test("CodeMirror setup uses the provided default visual theme instead of a custom dark theme", () => {
  const source = readFileSync("src/codemirror-entry.js", "utf8");

  assert.equal(source.includes("EditorView.theme("), false);
  assert.equal(source.includes("dark: true"), false);
});

test("CodeMirror setup enables the default search panel keymap", () => {
  const source = readFileSync("src/codemirror-entry.js", "utf8");

  assert.match(source, /from "@codemirror\/search"/);
  assert.match(source, /\bsearch\(\)/);
  assert.match(source, /\.\.\.searchKeymap/);
});

test("CodeMirror setup caps editor height with maxLines and internal scroll", () => {
  const source = readFileSync("src/codemirror-entry.js", "utf8");

  assert.match(source, /\bmaxLines\b/);
  assert.match(source, /maxHeight/);
  assert.match(source, /overflow:\s*"auto"/);
});

test("editor-config exposes shared min/max line defaults", () => {
  const dom = new JSDOM("<!doctype html>");
  const { window } = dom;
  loadEditorConfig(window);

  assert.equal(window.cusUserScripts.EDITOR_MIN_LINES, 8);
  assert.equal(window.cusUserScripts.EDITOR_MAX_LINES, 50);
});
