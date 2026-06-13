function createLightCodeEditor(container, options = {}) {
  const {
    value = "",
    placeholder = "",
    onChange = () => {},
    minLines = 6,
  } = options;

  if (typeof window.createCodeMirrorEditor !== "function") {
    throw new Error("CodeMirror editor bundle is not loaded.");
  }

  return window.createCodeMirrorEditor({
    parent: container,
    doc: value,
    placeholder,
    minLines,
    onChange,
  });
}
