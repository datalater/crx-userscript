function createLightCodeEditor(container, options = {}) {
  const {
    value = "",
    placeholder = "",
    onChange = () => {},
    minLines = cusUserScripts.EDITOR_MIN_LINES,
    maxLines = cusUserScripts.EDITOR_MAX_LINES,
  } = options;

  if (typeof window.createCodeMirrorEditor !== "function") {
    throw new Error("CodeMirror editor bundle is not loaded.");
  }

  return window.createCodeMirrorEditor({
    parent: container,
    doc: value,
    placeholder,
    minLines,
    maxLines,
    onChange,
  });
}
