(function () {
  "use strict";

  var pythonTokens = /((?:\b[rRuUbBfF]{1,2})?(?:"""(?:\\[\s\S]|(?!""")[\s\S])*"""|'''(?:\\[\s\S]|(?!''')[\s\S])*'''|"(?:\\.|[^"\\\r\n])*"|'(?:\\.|[^'\\\r\n])*')|#[^\r\n]*|\b(?:0[xX][0-9A-Fa-f](?:_?[0-9A-Fa-f])*|0[bB][01](?:_?[01])*|0[oO][0-7](?:_?[0-7])*|(?:\d(?:_?\d)*(?:\.\d(?:_?\d)*)?|\.\d(?:_?\d)*)(?:[eE][+-]?\d(?:_?\d)*)?[jJ]?)\b|[A-Za-z_][A-Za-z0-9_]*)/g;
  var goTokens = /(`[^`]*`|"(?:\\.|[^"\\\r\n])*"|'(?:\\.|[^'\\\r\n])*'|\/\/[^\r\n]*|\/\*[\s\S]*?\*\/|\b(?:0[xX][0-9A-Fa-f](?:_?[0-9A-Fa-f])*|0[bB][01](?:_?[01])*|0[oO][0-7](?:_?[0-7])*|(?:\d(?:_?\d)*(?:\.\d(?:_?\d)*)?|\.\d(?:_?\d)*)(?:[eE][+-]?\d(?:_?\d)*)?[i]?)\b|[A-Za-z_][A-Za-z0-9_]*)/g;

  function words(value) {
    return value.split(" ").reduce(function (result, word) {
      result[word] = true;
      return result;
    }, {});
  }

  var pythonKeywords = words("and as assert async await break case class continue def del elif else except finally for from global if import in is lambda match nonlocal not or pass raise return try while with yield");
  var pythonDeclarations = words("as async await class def from global import lambda nonlocal");
  var pythonConstants = words("False None True Ellipsis NotImplemented");
  var pythonTypes = words("bool bytearray bytes complex dict float frozenset int list memoryview object range set slice str tuple type");
  var pythonBuiltins = words("abs all any ascii bin breakpoint callable chr classmethod compile delattr dir divmod enumerate eval exec filter format getattr globals hasattr hash help hex id input isinstance issubclass iter len locals map max min next oct open ord pow print property repr reversed round setattr sorted staticmethod sum super vars zip __import__");
  var goKeywords = words("break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var");
  var goDeclarations = words("chan const func import interface map package struct type var");
  var goConstants = words("false iota nil true");
  var goTypes = words("any bool byte comparable complex64 complex128 error float32 float64 int int8 int16 int32 int64 rune string uint uint8 uint16 uint32 uint64 uintptr");
  var goBuiltins = words("append cap clear close complex copy delete imag len make max min new panic print println real recover");

  function escapeHTML(value) {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function nextNonWhitespace(source, position) {
    var match = source.slice(position).match(/^\s*(.)/);
    return match ? match[1] : "";
  }

  function previousNonWhitespace(source, position) {
    var index = position - 1;
    while (index >= 0 && /\s/.test(source[index])) {
      index -= 1;
    }
    return index >= 0 ? source[index] : "";
  }

  function parenthesisBalance(value) {
    var balance = 0;
    var sawOpening = false;
    for (var index = 0; index < value.length; index += 1) {
      if (value[index] === "(") {
        balance += 1;
        sawOpening = true;
      } else if (value[index] === ")") {
        balance -= 1;
      }
    }
    return { balance: balance, sawOpening: sawOpening };
  }

  function identifierClass(token, language, source, start, end, state) {
    var next = nextNonWhitespace(source, end);
    var previous = previousNonWhitespace(source, start);

    if (language === "python") {
      if (pythonKeywords[token]) {
        state.previousWord = token;
        return pythonDeclarations[token] ? "syntax-declaration" : "syntax-keyword";
      }
      if (pythonConstants[token]) {
        state.previousWord = token;
        return "syntax-literal";
      }
      if (state.previousWord === "def") {
        state.previousWord = token;
        return "syntax-function";
      }
      if (state.previousWord === "class") {
        state.previousWord = token;
        return "syntax-type";
      }
      state.previousWord = token;
      if (pythonTypes[token]) {
        return "syntax-type";
      }
      if (pythonBuiltins[token]) {
        return "syntax-builtin";
      }
      if (token.slice(0, 2) === "__" && token.slice(-2) === "__") {
        return "syntax-magic";
      }
      if (previous === "@") {
        return "syntax-decorator";
      }
      if (next === "(") {
        return "syntax-function";
      }
      if (next === ".") {
        return "syntax-namespace";
      }
      if (previous === ".") {
        return "syntax-property";
      }
      return "";
    }

    if (goKeywords[token]) {
      if (token === "func" || token === "type") {
        state.goDeclaration = { kind: token, end: end };
      }
      return goDeclarations[token] ? "syntax-declaration" : "syntax-keyword";
    }
    if (goConstants[token]) {
      return "syntax-literal";
    }
    if (state.goDeclaration) {
      var between = source.slice(state.goDeclaration.end, start);
      if (between.indexOf("{") !== -1 || between.indexOf(";") !== -1) {
        state.goDeclaration = null;
      } else if (state.goDeclaration.kind === "type") {
        state.goDeclaration = null;
        return "syntax-type";
      } else {
        var parentheses = parenthesisBalance(between);
        if (!parentheses.sawOpening || (parentheses.balance === 0 && next === "(")) {
          state.goDeclaration = null;
          return "syntax-function";
        }
      }
    }
    if (goTypes[token]) {
      return "syntax-type";
    }
    if (goBuiltins[token]) {
      return "syntax-builtin";
    }
    if (next === "(") {
      return "syntax-function";
    }
    if (next === ".") {
      return "syntax-namespace";
    }
    if (previous === ".") {
      return "syntax-property";
    }
    return "";
  }

  function tokenClass(token, language, source, start, end, state) {
    if ((language === "python" && token[0] === "#") || (language === "go" && (token.slice(0, 2) === "//" || token.slice(0, 2) === "/*"))) {
      return "syntax-comment";
    }
    if (/^(?:[rRuUbBfF]{0,2})(?:\"|'|`)/.test(token)) {
      return "syntax-string";
    }
    if (/^(?:\d|\.)/.test(token)) {
      return "syntax-number";
    }
    return identifierClass(token, language, source, start, end, state);
  }

  function highlightSource(source, language) {
    var pattern = language === "python" ? pythonTokens : goTokens;
    var output = "";
    var lastIndex = 0;
    var match;
    var state = { previousWord: "", goDeclaration: null };

    pattern.lastIndex = 0;
    while ((match = pattern.exec(source)) !== null) {
      output += escapeHTML(source.slice(lastIndex, match.index));
      var className = tokenClass(match[0], language, source, match.index, match.index + match[0].length, state);
      if (className) {
        output += '<span class="' + className + '">' + escapeHTML(match[0]) + "</span>";
      } else {
        output += escapeHTML(match[0]);
      }
      lastIndex = match.index + match[0].length;
    }
    output += escapeHTML(source.slice(lastIndex));

    // A final space keeps a trailing blank line visible in the overlay.
    return output + (source.endsWith("\n") ? " " : "");
  }

  function createHighlighter(language, textarea) {
    var highlight = document.getElementById(language + "-highlight");
    var lineNumbers = document.getElementById(language + "-line-numbers");
    var shell = textarea.closest(".code-editor-shell");
    var highlightedCode = highlight ? highlight.querySelector("code") : null;

    if (!highlight || !shell || !highlightedCode) {
      return function () {};
    }

    function syncScroll() {
      highlight.scrollTop = textarea.scrollTop;
      highlight.scrollLeft = textarea.scrollLeft;
      if (lineNumbers) {
        lineNumbers.scrollTop = textarea.scrollTop;
      }
    }

    function updateLineNumbers() {
      if (!lineNumbers) {
        return;
      }

      var lineCount = textarea.value.split(/\r\n|\r|\n/).length;
      var numbers = [];
      for (var lineNumber = 1; lineNumber <= lineCount; lineNumber += 1) {
        numbers.push(String(lineNumber));
      }
      lineNumbers.textContent = numbers.join("\n");
    }

    function update() {
      highlightedCode.innerHTML = highlightSource(textarea.value, language);
      updateLineNumbers();
      syncScroll();
    }

    textarea.addEventListener("input", update);
    textarea.addEventListener("scroll", syncScroll);
    shell.classList.add("syntax-enabled");
    update();
    return update;
  }

  function stripTrailingComment(line, language) {
    var quote = "";
    var escaped = false;

    for (var index = 0; index < line.length; index += 1) {
      var character = line[index];

      if (quote !== "") {
        if (quote !== "`" && escaped) {
          escaped = false;
        } else if (quote !== "`" && character === "\\") {
          escaped = true;
        } else if (character === quote) {
          quote = "";
        }
        continue;
      }

      if (character === "\"" || character === "'" || (language === "go" && character === "`")) {
        quote = character;
      } else if (language === "python" && character === "#") {
        return line.slice(0, index);
      } else if (language === "go" && character === "/" && line[index + 1] === "/") {
        return line.slice(0, index);
      }
    }

    return line;
  }

  function detectIndentUnit(source, language) {
    var smallestSpaceIndent = Infinity;
    source.split(/\r\n|\r|\n/).forEach(function (line) {
      var indentation = line.match(/^[\t ]+/);
      if (!indentation || line.trim() === "") {
        return;
      }
      if (indentation[0].indexOf("\t") !== -1) {
        smallestSpaceIndent = 0;
        return;
      }
      smallestSpaceIndent = Math.min(smallestSpaceIndent, indentation[0].length);
    });

    if (smallestSpaceIndent === 0) {
      return "\t";
    }
    if (Number.isFinite(smallestSpaceIndent)) {
      var maximumDetectedWidth = language === "go" ? 8 : 4;
      if (smallestSpaceIndent <= maximumDetectedWidth) {
        return " ".repeat(smallestSpaceIndent);
      }
    }
    return language === "go" ? "\t" : "    ";
  }

  function smartEnterEdit(source, selectionStart, selectionEnd, language) {
    var lineStart = source.lastIndexOf("\n", selectionStart - 1) + 1;
    var beforeCursor = source.slice(lineStart, selectionStart);
    var parentIndentMatch = beforeCursor.match(/^[\t ]*/);
    var parentIndent = parentIndentMatch ? parentIndentMatch[0] : "";
    var statement = stripTrailingComment(beforeCursor, language).trimEnd();
    var lastCharacter = statement.slice(-1);
    var indentUnit = detectIndentUnit(source, language);
    var shouldIndent;

    if (language === "python") {
      shouldIndent = lastCharacter === ":" || (lastCharacter !== "" && "([{ ".trim().indexOf(lastCharacter) !== -1);
    } else {
      shouldIndent = (lastCharacter !== "" && "([{ ".trim().indexOf(lastCharacter) !== -1) || /^(?:case\b.*|default)\s*:$/.test(statement.trim());
    }

    var childIndent = parentIndent + (shouldIndent ? indentUnit : "");
    var closingPairs = { "(": ")", "[": "]", "{": "}" };
    var following = source.slice(selectionEnd);
    var closingMatch = following.match(/^[\t ]*([)\]}])/);

    if (closingPairs[lastCharacter] && closingMatch && closingMatch[1] === closingPairs[lastCharacter]) {
      var whitespaceBeforeClosing = closingMatch[0].length - 1;
      var splitText = "\n" + childIndent + "\n" + parentIndent;
      return {
        start: selectionStart,
        end: selectionEnd + whitespaceBeforeClosing,
        text: splitText,
        caret: selectionStart + 1 + childIndent.length
      };
    }

    var text = "\n" + childIndent;
    return {
      start: selectionStart,
      end: selectionEnd,
      text: text,
      caret: selectionStart + text.length
    };
  }

  function initialize() {
    var language = document.body.dataset.language;

    if (language !== "python" && language !== "go") {
      return;
    }

    var code = document.getElementById(language + "-code");
    var stdin = document.getElementById(language + "-stdin");
    var runButton = document.getElementById(language + "-run");
    var formatButton = document.getElementById("go-format");
    var output = document.getElementById(language + "-output");
    var status = document.getElementById(language + "-status");
    var runtime = document.getElementById(language + "-runtime");

    if (!code || !stdin || !runButton || !output || !status || !runtime) {
      return;
    }

    var form = runButton.closest("form");
    var busy = false;
    var idleRunText = runButton.textContent;
    var idleFormatText = formatButton ? formatButton.textContent : "";
    var displayName = language === "go" ? "Go" : "Python";
    var updateHighlight = createHighlighter(language, code);

    function setStatus(message, state) {
      status.textContent = message;
      status.dataset.state = state;
    }

    function setBusy(active, activeButton, activeText) {
      busy = active;
      runButton.disabled = active;
      runButton.textContent = active && activeButton === runButton ? activeText : idleRunText;
      if (formatButton) {
        formatButton.disabled = active;
        formatButton.textContent = active && activeButton === formatButton ? activeText : idleFormatText;
      }
    }

    function appendTruncationNotice(text, truncated) {
      if (!truncated) {
        return text;
      }
      return text + (text && !text.endsWith("\n") ? "\n" : "") + "[output truncated]";
    }

    function renderStreams(response) {
      var stdout = appendTruncationNotice(typeof response.stdout === "string" ? response.stdout : "", response.stdoutTruncated === true);
      var stderr = appendTruncationNotice(typeof response.stderr === "string" ? response.stderr : "", response.stderrTruncated === true);
      var sections = [];

      if (stdout !== "") {
        sections.push(stdout);
      }
      if (stderr !== "") {
        sections.push("stderr\n" + stderr);
      }

      output.textContent = sections.length > 0 ? sections.join("\n\n") : "No output.";
    }

    function durationText(value) {
      return typeof value === "number" && Number.isFinite(value) ? " in " + value + " ms" : "";
    }

    function showBinary(response, label) {
      var binary = typeof response.binary === "string" ? response.binary.trim() : "";
      runtime.textContent = binary === "" ? "" : label + ": " + binary;
      runtime.hidden = binary === "";
    }

    function renderRunResult(response) {
      renderStreams(response);
      showBinary(response, "Runtime");

      var duration = durationText(response.durationMs);
      var serverError = typeof response.error === "string" ? response.error.trim() : "";

      if (response.timedOut === true) {
        setStatus("Timed out" + duration + (serverError ? ": " + serverError : "."), "error");
      } else if (serverError) {
        setStatus("Run failed" + duration + ": " + serverError, "error");
      } else if (typeof response.exitCode === "number" && response.exitCode !== 0) {
        setStatus("Exited with code " + response.exitCode + duration + ".", "error");
      } else if (typeof response.exitCode === "number") {
        setStatus("Finished with exit code " + response.exitCode + duration + ".", "success");
      } else {
        setStatus("Run finished" + duration + ".", "success");
      }
    }

    async function readErrorResponse(response) {
      try {
        var data = await response.json();
        if (data && typeof data.error === "string" && data.error.trim() !== "") {
          return data.error;
        }
      } catch (error) {
        // The HTTP status remains useful if the body was not JSON.
      }
      return "The server returned HTTP " + response.status + ".";
    }

    async function postJSON(url, body) {
      var response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json"
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        throw new Error(await readErrorResponse(response));
      }

      try {
        var result = await response.json();
        if (!result || typeof result !== "object") {
          throw new Error("The server returned an invalid response.");
        }
        return result;
      } catch (error) {
        if (error instanceof Error && error.message !== "Unexpected end of JSON input") {
          throw error;
        }
        throw new Error("The server returned an invalid response.");
      }
    }

    async function run() {
      if (busy) {
        return;
      }
      if (code.value.trim() === "") {
        setStatus("Enter " + displayName + " code to run.", "error");
        code.focus();
        return;
      }

      setBusy(true, runButton, "Running\u2026");
      output.textContent = "";
      runtime.textContent = "";
      runtime.hidden = true;
      setStatus("Running " + displayName + "\u2026", "running");

      try {
        var result = await postJSON("/api/run/" + language, { code: code.value, stdin: stdin.value });
        if (language === "go" && typeof result.code === "string" && result.code !== "" && result.code !== code.value) {
          code.value = result.code;
          code.dispatchEvent(new Event("input", { bubbles: true }));
          code.setSelectionRange(0, 0);
        }
        renderRunResult(result);
      } catch (error) {
        output.textContent = "";
        runtime.textContent = "";
        runtime.hidden = true;
        setStatus(error instanceof Error ? error.message : "The run could not be completed.", "error");
      } finally {
        setBusy(false);
      }
    }

    async function formatGo() {
      if (busy || language !== "go" || !formatButton) {
        return;
      }
      if (code.value.trim() === "") {
        setStatus("Enter Go code to format.", "error");
        code.focus();
        return;
      }

      setBusy(true, formatButton, "Formatting\u2026");
      setStatus("Formatting Go\u2026", "running");

      try {
        var result = await postJSON("/api/format/go", { code: code.value, stdin: "" });
        showBinary(result, "Formatter");

        var serverError = typeof result.error === "string" ? result.error.trim() : "";
        if (result.timedOut === true || serverError || result.exitCode !== 0) {
          renderStreams(result);
          if (result.timedOut === true) {
            setStatus("Formatting timed out" + durationText(result.durationMs) + ".", "error");
          } else if (serverError) {
            setStatus("Formatting failed: " + serverError, "error");
          } else {
            setStatus("gofmt exited with code " + result.exitCode + durationText(result.durationMs) + ".", "error");
          }
          return;
        }

        code.value = typeof result.stdout === "string" ? result.stdout : code.value;
        updateHighlight();
        output.textContent = "No output.";
        setStatus("Go code formatted" + durationText(result.durationMs) + ".", "success");
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Go code could not be formatted.", "error");
      } finally {
        setBusy(false);
      }
    }

    if (form) {
      form.addEventListener("submit", function (event) {
        event.preventDefault();
        run();
      });
    } else {
      runButton.addEventListener("click", run);
    }

    if (formatButton) {
      formatButton.addEventListener("click", formatGo);
    }

    function handleEditorKeydown(event) {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        run();
        return;
      }

      if (event.key === "Enter" && !event.altKey && !event.ctrlKey && !event.metaKey && !event.isComposing) {
        event.preventDefault();
        var edit = smartEnterEdit(code.value, code.selectionStart, code.selectionEnd, language);
        code.setRangeText(edit.text, edit.start, edit.end, "end");
        code.setSelectionRange(edit.caret, edit.caret);
        updateHighlight();
      }
    }

    code.addEventListener("keydown", handleEditorKeydown);
    stdin.addEventListener("keydown", function (event) {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        run();
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();
