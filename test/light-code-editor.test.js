const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { test } = require("node:test");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");

function loadEditorScript(window) {
  const source = readFileSync("lib/light-code-editor.js", "utf8");
  vm.runInContext(source, vm.createContext(window));
}

test("createLightCodeEditor delegates to the CodeMirror adapter and preserves the public API", () => {
  const dom = new JSDOM("<!doctype html><div id=\"host\"></div>");
  const { window } = dom;
  const host = window.document.getElementById("host");
  const calls = [];

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
    minLines: 8,
    onChange: () => {},
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].parent, host);
  assert.equal(calls[0].doc, "const a = 1;");
  assert.equal(calls[0].placeholder, "code");
  assert.equal(calls[0].minLines, 8);

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
