import { closeBrackets, closeBracketsKeymap, completionKeymap, autocompletion } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { javascript } from "@codemirror/lang-javascript";
import {
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
import { search, searchKeymap } from "@codemirror/search";
import { EditorState } from "@codemirror/state";
import {
  EditorView,
  crosshairCursor,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder as placeholderExtension,
  rectangularSelection,
} from "@codemirror/view";

const BASE_LINE_HEIGHT = 19.5;
const VERTICAL_PADDING = 20;

window.createCodeMirrorEditor = function createCodeMirrorEditor(options) {
  const editorConfig = globalThis.cusUserScripts || {};
  const {
    parent,
    doc = "",
    placeholder = "",
    minLines = editorConfig.EDITOR_MIN_LINES,
    maxLines = editorConfig.EDITOR_MAX_LINES,
    onChange = () => {},
  } = options;

  const safeMinLines = Math.max(minLines, 1);
  const safeMaxLines = Math.max(maxLines, safeMinLines);
  const minHeight = `${safeMinLines * BASE_LINE_HEIGHT + VERTICAL_PADDING}px`;
  const maxHeight = `${safeMaxLines * BASE_LINE_HEIGHT + VERTICAL_PADDING}px`;
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        lineNumbers(),
        foldGutter(),
        highlightActiveLineGutter(),
        history(),
        drawSelection(),
        dropCursor(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        autocompletion(),
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),
        placeholderExtension(placeholder),
        javascript(),
        search(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        keymap.of([
          ...searchKeymap,
          indentWithTab,
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...historyKeymap,
          ...completionKeymap,
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChange(view.state.doc.toString());
        }),
        editorBaseStyle(minHeight, maxHeight),
      ],
    }),
  });

  return {
    getValue() {
      return view.state.doc.toString();
    },
    setValue(nextValue) {
      const nextDoc = nextValue ?? "";
      view.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: nextDoc,
        },
      });
    },
    focus() {
      view.focus();
    },
    destroy() {
      view.destroy();
    },
  };
};

function editorBaseStyle(minHeight, maxHeight) {
  return EditorView.baseTheme(
    {
      "&": {
        minHeight,
        maxHeight,
        border: "1px solid #d1d5db",
        borderRadius: "8px",
        overflow: "hidden",
      },
      ".cm-scroller": {
        minHeight,
        maxHeight,
        overflow: "auto",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        fontSize: "13px",
        lineHeight: "1.5",
      },
      ".cm-content": {
        padding: "10px 0",
      },
      ".cm-line": {
        padding: "0 12px",
      },
    }
  );
}
