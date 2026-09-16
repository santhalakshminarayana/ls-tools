(function () {
  "use strict";

  var maximumNavigableMatches = 100;
  var maximumWorkspaces = 10;

  function lineAndColumn(source, position) {
    var before = source.slice(0, Math.max(0, position));
    var lines = before.split(/\r\n|\r|\n/);
    return {
      line: lines.length,
      column: lines[lines.length - 1].length + 1,
      character: Math.max(0, position) + 1
    };
  }

  function positionFromLineAndColumn(source, line, column) {
    var currentLine = 1;
    var index = 0;
    while (currentLine < line && index < source.length) {
      if (source[index] === "\r") {
        index += source[index + 1] === "\n" ? 2 : 1;
        currentLine += 1;
      } else if (source[index] === "\n") {
        index += 1;
        currentLine += 1;
      } else {
        index += 1;
      }
    }
    return Math.min(source.length, index + Math.max(0, column - 1));
  }

  function scanCommonMistake(source) {
    var inString = false;
    var escaped = false;

    for (var index = 0; index < source.length; index += 1) {
      var character = source[index];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (character === "\\") {
          escaped = true;
        } else if (character === "\"") {
          inString = false;
        }
        continue;
      }

      if (character === "\"") {
        inString = true;
        continue;
      }
      if (character === "'") {
        return {
          position: index,
          description: "JSON strings and property names must use double quotes, not single quotes."
        };
      }
      if (character === "/" && (source[index + 1] === "/" || source[index + 1] === "*")) {
        return {
          position: index,
          description: "Comments are not allowed in standard JSON. Remove the comment before parsing."
        };
      }
      if (character === ",") {
        var afterComma = index + 1;
        while (/\s/.test(source[afterComma] || "")) {
          afterComma += 1;
        }
        if (source[afterComma] === "}" || source[afterComma] === "]") {
          return {
            position: index,
            description: "Trailing commas are not allowed in JSON. Remove this comma."
          };
        }
      }
      if (character === "-" || /[0-9]/.test(character)) {
        var numberMatch = source.slice(index).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
        if (numberMatch) {
          var afterNumber = index + numberMatch[0].length;
          if (/[A-Za-z0-9.+-]/.test(source[afterNumber] || "")) {
            return {
              position: afterNumber,
              description: "The number is not valid JSON. Check leading zeroes, the decimal part, and the exponent."
            };
          }
          index = afterNumber - 1;
          continue;
        }
      }
      if (/[A-Za-z_$]/.test(character)) {
        var wordEnd = index + 1;
        while (/[A-Za-z0-9_$]/.test(source[wordEnd] || "")) {
          wordEnd += 1;
        }
        var word = source.slice(index, wordEnd);
        var afterWord = wordEnd;
        while (/\s/.test(source[afterWord] || "")) {
          afterWord += 1;
        }
        if (source[afterWord] === ":") {
          return { position: index, description: "Property names must be enclosed in double quotes." };
        }
        if (["true", "false", "null"].indexOf(word) === -1) {
          return {
            position: index,
            description: JSON.stringify(word) + " is not a JSON value. Use a quoted string, number, object, array, true, false, or null."
          };
        }
        index = wordEnd - 1;
      }
    }

    if (inString) {
      return { position: source.length, description: "The JSON string is missing its closing double quote." };
    }
    return null;
  }

  function nativeErrorPosition(message, source) {
    var positionMatch = message.match(/(?:at\s+)?position\s+(\d+)/i);
    if (positionMatch) {
      return Number(positionMatch[1]);
    }
    var lineMatch = message.match(/line\s+(\d+)\s+column\s+(\d+)/i);
    if (lineMatch) {
      return positionFromLineAndColumn(source, Number(lineMatch[1]), Number(lineMatch[2]));
    }
    return /unexpected end|end of json input/i.test(message) ? source.length : null;
  }

  function friendlyNativeDescription(message, source, position) {
    var character = position === null ? "" : source[position] || "";
    if (/unexpected end|end of json input/i.test(message)) {
      return "The document ends before a value, string, object, or array is complete. Check closing quotes, braces, and brackets.";
    }
    if (/property name|double-quoted/i.test(message)) {
      return "Property names must be enclosed in double quotes.";
    }
    if (/expected.*colon|expected ':'/i.test(message)) {
      return "A colon is required between a property name and its value.";
    }
    if (/expected.*comma|after property value|delimiter/i.test(message)) {
      return "A comma may be missing between adjacent properties or array values.";
    }
    if (/unterminated string/i.test(message)) {
      return "The JSON string is missing its closing double quote.";
    }
    if (/escape|unicode/i.test(message)) {
      return 'The string contains an invalid escape sequence. JSON escapes use forms such as \\n, \\t, \\u1234, or \\".';
    }
    if (/control character/i.test(message)) {
      return "A string contains an unescaped control character or line break.";
    }
    if (/number|digit|exponent/i.test(message)) {
      return "The number is not valid JSON. Check leading zeroes, the decimal part, and the exponent.";
    }
    if (/after json|non-whitespace/i.test(message)) {
      return "Only one top-level JSON value is allowed; remove text after the completed value.";
    }
    if (character === "}" || character === "]") {
      return "A value or delimiter is missing before this closing character.";
    }
    return "Unexpected JSON syntax near this character. Check quotes, commas, colons, and matching braces or brackets.";
  }

  function describeParseError(error, source) {
    var message = error instanceof Error ? error.message : String(error);
    var commonMistake = scanCommonMistake(source);
    var position = commonMistake ? commonMistake.position : nativeErrorPosition(message, source);
    var description = commonMistake ? commonMistake.description : friendlyNativeDescription(message, source, position);
    if (position !== null && Number.isFinite(position)) {
      var location = lineAndColumn(source, position);
      return "Invalid JSON at line " + location.line + ", column " + location.column + " (character " + location.character + "). " + description + " Parser detail: " + message;
    }
    return "Invalid JSON. " + description + " Parser detail: " + message;
  }

  async function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }
    var temporary = document.createElement("textarea");
    temporary.value = text;
    temporary.setAttribute("readonly", "");
    temporary.style.position = "fixed";
    temporary.style.opacity = "0";
    document.body.appendChild(temporary);
    temporary.select();
    try {
      if (!document.execCommand("copy")) {
        throw new Error("Copy was rejected by the browser.");
      }
    } finally {
      temporary.remove();
    }
  }

  function appendToken(fragment, className, value) {
    var token = document.createElement("span");
    token.className = className;
    token.textContent = value;
    fragment.appendChild(token);
  }

  function renderHighlight(target, source) {
    var fragment = document.createDocumentFragment();
    var plainStart = 0;
    var index = 0;

    function flushPlain(end) {
      if (end > plainStart) {
        fragment.appendChild(document.createTextNode(source.slice(plainStart, end)));
      }
    }

    while (index < source.length) {
      var tokenEnd = index;
      var className = "";
      if (source[index] === "\"") {
        tokenEnd = index + 1;
        var escaped = false;
        while (tokenEnd < source.length) {
          var character = source[tokenEnd];
          tokenEnd += 1;
          if (escaped) {
            escaped = false;
          } else if (character === "\\") {
            escaped = true;
          } else if (character === "\"") {
            break;
          }
        }
        var afterString = tokenEnd;
        while (/\s/.test(source[afterString] || "")) {
          afterString += 1;
        }
        className = source[afterString] === ":" ? "syntax-key" : "syntax-string";
      } else {
        var number = source.slice(index).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
        var literal = source.slice(index).match(/^(?:true|false|null)\b/);
        if (number) {
          tokenEnd = index + number[0].length;
          className = "syntax-number";
        } else if (literal) {
          tokenEnd = index + literal[0].length;
          className = "syntax-literal";
        }
      }
      if (className) {
        flushPlain(index);
        appendToken(fragment, className, source.slice(index, tokenEnd));
        index = tokenEnd;
        plainStart = index;
      } else {
        index += 1;
      }
    }
    flushPlain(source.length);
    target.replaceChildren(fragment);
  }

  function updateLineNumbers(textarea, lineNumbers) {
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

  function validatedSearchFlags(value) {
    var flags = value.trim();
    if (!/^[imsu]*$/.test(flags)) {
      throw new Error("Flags may contain only i, m, s, and u. Global matching is automatic.");
    }
    if (new Set(flags).size !== flags.length) {
      throw new Error("Each regex flag may be specified only once.");
    }
    return flags;
  }

  function advanceAfterEmptyMatch(source, index, unicode) {
    if (!unicode || index >= source.length) {
      return index + 1;
    }
    var first = source.charCodeAt(index);
    var second = source.charCodeAt(index + 1);
    var surrogatePair = first >= 0xd800 && first <= 0xdbff && second >= 0xdc00 && second <= 0xdfff;
    return index + (surrogatePair ? 2 : 1);
  }

  function createWorkspace(root, requestRemove) {
    function role(name) {
      return root.querySelector('[data-json-role="' + name + '"]');
    }
    function action(name) {
      return root.querySelector('[data-json-action="' + name + '"]');
    }

    var title = role("title");
    var input = role("input");
    var output = role("output");
    var sourceLabel = role("source-label");
    var outputLabel = role("output-label");
    var sourceShell = role("source-shell");
    var outputShell = role("output-shell");
    var inputLineNumbers = role("input-line-numbers");
    var outputLineNumbers = role("output-line-numbers");
    var inputHighlight = role("input-highlight");
    var outputHighlight = role("output-highlight");
    var inputHighlightCode = inputHighlight.querySelector("code");
    var outputHighlightCode = outputHighlight.querySelector("code");
    var status = role("status");
    var findWidget = role("find-widget");
    var pattern = role("pattern");
    var flagsInput = role("flags");
    var replacement = role("replacement");
    var patternLabel = role("pattern-label");
    var flagsLabel = role("flags-label");
    var replacementLabel = role("replacement-label");
    var findCount = role("find-count");
    var previousButton = action("previous");
    var nextButton = action("next");
    var replaceButton = action("replace");
    var replaceAllButton = action("replace-all");
    var removeButton = action("remove");
    var actionBar = root.querySelector('.button-bar[aria-label="JSON actions"]');
    var findState = { matches: [], total: 0, current: -1, tooMany: false, invalid: false };

    function setStatus(message, isError) {
      status.textContent = message;
      if (message === "") {
        delete status.dataset.state;
      } else {
        status.dataset.state = isError ? "error" : "success";
      }
    }

    function syncScroll(textarea, highlight, lineNumbers) {
      highlight.scrollTop = textarea.scrollTop;
      highlight.scrollLeft = textarea.scrollLeft;
      if (lineNumbers) {
        lineNumbers.scrollTop = textarea.scrollTop;
      }
    }

    function updateSourceHighlight() {
      renderHighlight(inputHighlightCode, input.value);
      updateLineNumbers(input, inputLineNumbers);
      syncScroll(input, inputHighlight, inputLineNumbers);
    }

    function updateOutputHighlight() {
      renderHighlight(outputHighlightCode, output.value);
      updateLineNumbers(output, outputLineNumbers);
      syncScroll(output, outputHighlight, outputLineNumbers);
    }

    function dispatchSourceInput() {
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }

    function transform(indentation, sourceOnly) {
      var source = input.value;
      if (source.trim() === "") {
        if (!sourceOnly) {
          output.value = "";
          updateOutputHighlight();
        }
        setStatus("Enter JSON to process.", true);
        input.focus();
        return;
      }
      try {
        var transformed = JSON.stringify(JSON.parse(source), null, indentation);
        if (sourceOnly) {
          input.value = transformed;
          input.setSelectionRange(0, 0);
          dispatchSourceInput();
          setStatus(indentation === 0 ? "Source minified." : "Source formatted.", false);
        } else {
          output.value = transformed;
          updateOutputHighlight();
          setStatus(indentation === 0 ? "JSON minified to output." : "JSON formatted to output.", false);
        }
      } catch (error) {
        if (!sourceOnly) {
          output.value = "";
          updateOutputHighlight();
        }
        setStatus(describeParseError(error, source), true);
      }
    }

    function resetFindState() {
      findState.matches = [];
      findState.total = 0;
      findState.current = -1;
      findState.tooMany = false;
      findState.invalid = false;
    }

    function updateFindCounter() {
      var navigable = !findState.invalid && !findState.tooMany && findState.total > 0;
      if (findState.invalid) {
        findCount.textContent = "Invalid";
        findCount.dataset.state = "error";
      } else if (findState.tooMany) {
        findCount.textContent = String(findState.total);
        findCount.dataset.state = "limit";
        findCount.title = findState.total + " matches. Refine the expression to navigate or replace one match.";
      } else {
        findCount.textContent = (findState.current < 0 ? 0 : findState.current + 1) + "/" + findState.total;
        delete findCount.dataset.state;
        findCount.removeAttribute("title");
      }
      previousButton.disabled = !navigable;
      nextButton.disabled = !navigable;
      replaceButton.disabled = !navigable;
      replaceAllButton.disabled = findState.invalid || findState.total === 0;
    }

    function setFindError(message) {
      resetFindState();
      findState.invalid = true;
      findCount.title = message;
      updateFindCounter();
    }

    function refreshFind(preferredPosition) {
      resetFindState();
      if (pattern.value === "") {
        updateFindCounter();
        return;
      }
      var searchFlags;
      var expression;
      try {
        searchFlags = validatedSearchFlags(flagsInput.value);
        expression = new RegExp(pattern.value, searchFlags + "g");
      } catch (error) {
        setFindError(error instanceof Error ? error.message : "The regular expression is invalid.");
        return;
      }
      var match;
      while ((match = expression.exec(input.value)) !== null) {
        findState.total += 1;
        if (findState.total <= maximumNavigableMatches) {
          findState.matches.push({ start: match.index, end: match.index + match[0].length });
        }
        if (match[0] === "") {
          expression.lastIndex = advanceAfterEmptyMatch(input.value, expression.lastIndex, searchFlags.indexOf("u") !== -1);
        }
      }
      findState.tooMany = findState.total > maximumNavigableMatches;
      if (!findState.tooMany && findState.total > 0) {
        var preferred = typeof preferredPosition === "number" ? preferredPosition : input.selectionStart;
        findState.current = findState.matches.findIndex(function (candidate) {
          return candidate.start >= preferred;
        });
        if (findState.current === -1) {
          findState.current = 0;
        }
      }
      updateFindCounter();
    }

    function selectCurrentMatch() {
      if (findState.current < 0 || findState.tooMany || findState.invalid) {
        return;
      }
      var match = findState.matches[findState.current];
      input.focus({ preventScroll: true });
      input.setSelectionRange(match.start, match.end);
      syncScroll(input, inputHighlight, inputLineNumbers);
      updateFindCounter();
    }

    function moveToMatch(direction) {
      if (findState.total === 0 || findState.tooMany || findState.invalid) {
        return;
      }
      findState.current = (findState.current + direction + findState.total) % findState.total;
      selectCurrentMatch();
    }

    function openFind() {
      findWidget.hidden = false;
      refreshFind(input.selectionStart);
      pattern.focus();
      pattern.select();
    }

    function closeFind() {
      findWidget.hidden = true;
      input.focus();
    }

    function replaceOne() {
      if (findState.invalid || findState.tooMany || findState.current < 0) {
        return;
      }
      var selected = findState.matches[findState.current];
      var searchFlags;
      var expression;
      try {
        searchFlags = validatedSearchFlags(flagsInput.value);
        expression = new RegExp(pattern.value, searchFlags + "y");
      } catch (error) {
        setFindError(error instanceof Error ? error.message : "The regular expression is invalid.");
        return;
      }
      expression.lastIndex = selected.start;
      var previousLength = input.value.length;
      var nextSource = input.value.replace(expression, replacement.value);
      var insertedLength = nextSource.length - (previousLength - (selected.end - selected.start));
      var nextPosition = selected.start + Math.max(0, insertedLength);
      input.value = nextSource;
      input.setSelectionRange(nextPosition, nextPosition);
      dispatchSourceInput();
      refreshFind(nextPosition);
      setStatus("Replaced one occurrence in the source.", false);
      if (findState.total > 0 && !findState.tooMany) {
        selectCurrentMatch();
      } else {
        input.focus();
        input.setSelectionRange(nextPosition, nextPosition);
      }
    }

    function replaceAll() {
      if (findState.invalid || findState.total === 0) {
        return;
      }
      var searchFlags;
      var expression;
      try {
        searchFlags = validatedSearchFlags(flagsInput.value);
        expression = new RegExp(pattern.value, searchFlags + "g");
      } catch (error) {
        setFindError(error instanceof Error ? error.message : "The regular expression is invalid.");
        return;
      }
      var replacedCount = findState.total;
      input.value = input.value.replace(expression, replacement.value);
      input.setSelectionRange(0, 0);
      dispatchSourceInput();
      refreshFind(0);
      setStatus("Replaced " + replacedCount + " occurrence" + (replacedCount === 1 ? "" : "s") + " in the source.", false);
    }

    function clearWorkspace() {
      input.value = "";
      output.value = "";
      pattern.value = "";
      flagsInput.value = "";
      replacement.value = "";
      findWidget.hidden = true;
      updateSourceHighlight();
      updateOutputHighlight();
      refreshFind(0);
      setStatus("", false);
      dispatchSourceInput();
      input.focus();
    }

    action("format").addEventListener("click", function () { transform(2, false); });
    action("minify").addEventListener("click", function () { transform(0, false); });
    action("format-source").addEventListener("click", function () { transform(2, true); });
    action("minify-source").addEventListener("click", function () { transform(0, true); });
    action("copy").addEventListener("click", async function () {
      if (output.value === "") {
        setStatus("There is no output to copy.", true);
        return;
      }
      try {
        await copyText(output.value);
        setStatus("Output copied.", false);
      } catch (error) {
        setStatus("Could not copy output. Select it and copy manually.", true);
      }
    });
    action("clear").addEventListener("click", clearWorkspace);
    removeButton.addEventListener("click", requestRemove);
    previousButton.addEventListener("click", function () { moveToMatch(-1); });
    nextButton.addEventListener("click", function () { moveToMatch(1); });
    action("close-find").addEventListener("click", closeFind);
    replaceButton.addEventListener("click", replaceOne);
    replaceAllButton.addEventListener("click", replaceAll);

    input.addEventListener("input", function () {
      updateSourceHighlight();
      if (!findWidget.hidden) {
        refreshFind(input.selectionStart);
      }
    });
    input.addEventListener("scroll", function () { syncScroll(input, inputHighlight, inputLineNumbers); });
    output.addEventListener("input", updateOutputHighlight);
    output.addEventListener("scroll", function () { syncScroll(output, outputHighlight, outputLineNumbers); });
    pattern.addEventListener("input", function () { refreshFind(input.selectionStart); });
    flagsInput.addEventListener("input", function () { refreshFind(input.selectionStart); });
    findWidget.addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        event.preventDefault();
        moveToMatch(event.shiftKey ? -1 : 1);
      }
    });

    sourceShell.classList.add("syntax-enabled");
    outputShell.classList.add("syntax-enabled");
    updateSourceHighlight();
    updateOutputHighlight();
    refreshFind(0);

    return {
      root: root,
      input: input,
      updateIndex: function (index) {
        var suffix = String(index);
        root.dataset.jsonIndex = suffix;
        title.textContent = "JSON " + suffix;
        input.id = "json-input-" + suffix;
        output.id = "json-output-" + suffix;
        inputHighlight.id = "json-input-highlight-" + suffix;
        outputHighlight.id = "json-output-highlight-" + suffix;
        if (inputLineNumbers) {
          inputLineNumbers.id = "json-input-line-numbers-" + suffix;
        }
        if (outputLineNumbers) {
          outputLineNumbers.id = "json-output-line-numbers-" + suffix;
        }
        sourceShell.id = "json-source-shell-" + suffix;
        outputShell.id = "json-output-shell-" + suffix;
        status.id = "json-status-" + suffix;
        findWidget.id = "json-find-widget-" + suffix;
        pattern.id = "json-search-pattern-" + suffix;
        flagsInput.id = "json-search-flags-" + suffix;
        replacement.id = "json-replacement-" + suffix;
        sourceLabel.htmlFor = input.id;
        outputLabel.htmlFor = output.id;
        patternLabel.htmlFor = pattern.id;
        flagsLabel.htmlFor = flagsInput.id;
        replacementLabel.htmlFor = replacement.id;
        output.setAttribute("aria-describedby", status.id);
        actionBar.setAttribute("aria-label", "JSON " + suffix + " actions");
        if (index === 1) {
          input.dataset.persistAlias = "json-input";
        } else {
          delete input.dataset.persistAlias;
        }
      },
      setRemovable: function (removable) {
        removeButton.disabled = !removable;
      },
      ownsFindFocus: function (activeElement) {
        return activeElement === input || findWidget.contains(activeElement);
      },
      findIsOpen: function () {
        return !findWidget.hidden;
      },
      openFind: openFind,
      closeFind: closeFind
    };
  }

  function initialize() {
    var container = document.getElementById("json-workspaces");
    var template = document.getElementById("json-workspace-template");
    var countInput = document.getElementById("json-workspace-count");
    var newButton = document.getElementById("json-new");
    var removeAllButton = document.getElementById("json-remove-all");
    if (!container || !template || !countInput || !newButton || !removeAllButton) {
      return;
    }

    var workspaces = [];

    function announceCount() {
      countInput.dispatchEvent(new Event("input", { bubbles: true }));
    }

    function syncWorkspaceState(announce) {
      workspaces.forEach(function (workspace, index) {
        workspace.updateIndex(index + 1);
        workspace.setRemovable(workspaces.length > 1);
      });
      countInput.value = String(workspaces.length);
      newButton.disabled = workspaces.length >= maximumWorkspaces;
      removeAllButton.disabled = workspaces.length <= 1;
      if (announce) {
        announceCount();
      }
    }

    function removeWorkspace(workspace, announce, moveFocus) {
      if (workspaces.length <= 1) {
        return;
      }
      var index = workspaces.indexOf(workspace);
      if (index === -1) {
        return;
      }
      workspace.root.remove();
      workspaces.splice(index, 1);
      syncWorkspaceState(announce);
      if (moveFocus) {
        workspaces[Math.min(index, workspaces.length - 1)].input.focus();
      }
    }

    function addWorkspace(announce, moveFocus) {
      if (workspaces.length >= maximumWorkspaces) {
        return null;
      }
      var fragment = template.content.cloneNode(true);
      var root = fragment.querySelector(".json-workspace");
      var workspace;
      workspace = createWorkspace(root, function () {
        removeWorkspace(workspace, true, true);
      });
      container.appendChild(fragment);
      workspaces.push(workspace);
      syncWorkspaceState(announce);
      if (moveFocus) {
        workspace.input.focus();
      }
      return workspace;
    }

    function reconcileCount() {
      var requested = Number.parseInt(countInput.value, 10);
      var desired = Number.isFinite(requested) ? requested : 1;
      desired = Math.max(1, Math.min(maximumWorkspaces, desired));
      while (workspaces.length < desired) {
        addWorkspace(false, false);
      }
      while (workspaces.length > desired) {
        var removed = workspaces.pop();
        removed.root.remove();
      }
      syncWorkspaceState(false);
    }

    addWorkspace(false, false);

    newButton.addEventListener("click", function () {
      addWorkspace(true, true);
    });
    removeAllButton.addEventListener("click", function () {
      while (workspaces.length > 1) {
        workspaces.pop().root.remove();
      }
      syncWorkspaceState(true);
      workspaces[0].input.focus();
    });
    countInput.addEventListener("input", reconcileCount);

    document.addEventListener("keydown", function (event) {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "f") {
        var activeElement = document.activeElement;
        var activeWorkspace = workspaces.find(function (workspace) {
          return workspace.ownsFindFocus(activeElement);
        });
        if (activeWorkspace) {
          event.preventDefault();
          activeWorkspace.openFind();
        }
        return;
      }
      if (event.key === "Escape") {
        var openWorkspace = workspaces.find(function (workspace) {
          return workspace.findIsOpen();
        });
        if (openWorkspace) {
          event.preventDefault();
          openWorkspace.closeFind();
        }
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();
