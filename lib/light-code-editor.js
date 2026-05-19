function createLightCodeEditor(container, options = {}) {
  const {
    value = "",
    placeholder = "",
    onChange = () => {},
    minLines = 6,
  } = options;

  const root = document.createElement("div");
  root.className = "mintool-lce";

  const gutter = document.createElement("div");
  gutter.className = "mintool-lce__gutter";
  gutter.setAttribute("aria-hidden", "true");

  const editor = document.createElement("div");
  editor.className = "mintool-lce__editor";

  const highlight = document.createElement("pre");
  highlight.className = "mintool-lce__highlight";
  highlight.setAttribute("aria-hidden", "true");

  const input = document.createElement("textarea");
  input.className = "mintool-lce__input";
  input.spellcheck = false;
  input.autocomplete = "off";
  input.autocapitalize = "off";
  input.wrap = "off";
  input.placeholder = placeholder;
  input.value = value;
  input.rows = minLines;

  editor.append(highlight, input);
  root.append(gutter, editor);
  container.append(root);

  let changeTimer = null;

  input.addEventListener("input", () => {
    refresh();
    scheduleChange();
  });

  input.addEventListener("scroll", syncScroll);
  input.addEventListener("keydown", onKeyDown);

  refresh();

  return {
    getValue() {
      return input.value;
    },
    setValue(nextValue) {
      input.value = nextValue ?? "";
      refresh();
    },
    focus() {
      input.focus();
    },
    destroy() {
      root.remove();
    },
  };

  function scheduleChange() {
    clearTimeout(changeTimer);
    changeTimer = setTimeout(() => onChange(input.value), 120);
  }

  function refresh() {
    updateGutter();
    updateHighlight();
    syncScroll();
  }

  function updateGutter() {
    const lineCount = Math.max(minLines, input.value.split("\n").length);
    gutter.textContent = Array.from({ length: lineCount }, (_, i) => i + 1).join("\n");
  }

  function updateHighlight() {
    const code = input.value;
    highlight.innerHTML = highlightCode(code) + (code.endsWith("\n") ? "" : "\n");
  }

  function syncScroll() {
    highlight.scrollTop = input.scrollTop;
    highlight.scrollLeft = input.scrollLeft;
    gutter.scrollTop = input.scrollTop;
  }

  function onKeyDown(event) {
    if (event.key === "Tab") {
      event.preventDefault();
      insertAtCursor("  ");
      return;
    }

    if (event.key === "Enter") {
      const indent = getLineIndent(input.value, input.selectionStart);
      if (!indent) return;
      event.preventDefault();
      insertAtCursor(`\n${indent}`);
    }
  }

  function insertAtCursor(text) {
    const start = input.selectionStart;
    const end = input.selectionEnd;
    const next = input.value.slice(0, start) + text + input.value.slice(end);
    input.value = next;
    const cursor = start + text.length;
    input.selectionStart = cursor;
    input.selectionEnd = cursor;
    refresh();
    scheduleChange();
  }

  function getLineIndent(value, index) {
    const lineStart = value.lastIndexOf("\n", index - 1) + 1;
    const lineEnd = value.indexOf("\n", index);
    const line = value.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
    const match = line.match(/^[\t ]*/);
    return match ? match[0] : "";
  }
}

function highlightCode(source) {
  const tokens = [];
  let code = escapeHtml(source);

  const stash = (regex, wrap) => {
    code = code.replace(regex, (match) => {
      const id = tokens.length;
      tokens.push(wrap(match));
      // Delimit with letters so \b(\d+)\b (number highlight) cannot break the placeholder.
      return `\uE000M${id}M\uE001`;
    });
  };

  // Comments & strings are stashed first so keyword rules never run inside markup we inject.
  stash(/(\/\/.*$|\/\*[\s\S]*?\*\/)/gm, (m) => `<span class="tok-comment">${m}</span>`);
  stash(
    /('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`)/g,
    (m) => `<span class="tok-string">${m}</span>`
  );
  // Unclosed string while typing (e.g. 'visibilitychange)
  stash(/('(?:\\.|[^'\\\n]*)$|"(?:\\.|[^"\\\n]*)$|`(?:\\.|[^`\\\n]*)$)/gm, (m) => {
    return `<span class="tok-string">${m}</span>`;
  });

  code = code.replace(
    /\b(const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|try|catch|finally|throw|new|typeof|instanceof|async|await|class|extends|import|export|default|document|window|addEventListener|removeEventListener)\b/g,
    '<span class="tok-keyword">$1</span>'
  );
  code = code.replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="tok-number">$1</span>');

  return code.replace(/\uE000M(\d+)M\uE001/g, (_, index) => tokens[Number(index)]);
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
