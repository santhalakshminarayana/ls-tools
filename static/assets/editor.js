(function () {
  "use strict";

  var pairs = {
    "(": ")",
    "[": "]",
    "{": "}",
    "\"": "\"",
    "'": "'",
    "`": "`"
  };
  var closingBrackets = {
    ")": true,
    "]": true,
    "}": true
  };

  function detectIndentUnit(textarea) {
    var language = document.body.dataset.language || "";
    var smallestSpaces = Infinity;
    var sawTab = false;

    textarea.value.split(/\r\n|\r|\n/).forEach(function (line) {
      var indentation = line.match(/^[\t ]+/);
      if (!indentation || line.trim() === "") {
        return;
      }
      if (indentation[0].indexOf("\t") !== -1) {
        sawTab = true;
      } else {
        smallestSpaces = Math.min(smallestSpaces, indentation[0].length);
      }
    });

    if (sawTab) {
      return "\t";
    }
    if (Number.isFinite(smallestSpaces) && smallestSpaces <= 8) {
      return " ".repeat(smallestSpaces);
    }
    if (language === "go") {
      return "\t";
    }
    if (language === "python") {
      return "    ";
    }
    return "  ";
  }

  function dispatchInput(textarea) {
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function indentSelection(textarea, unit) {
    var value = textarea.value;
    var start = textarea.selectionStart;
    var end = textarea.selectionEnd;

    if (start === end) {
      textarea.setRangeText(unit, start, end, "end");
      dispatchInput(textarea);
      return;
    }

    var blockStart = value.lastIndexOf("\n", start - 1) + 1;
    var blockEnd = end;
    var block = value.slice(blockStart, blockEnd);
    var replacement = unit + block.replace(/\n/g, "\n" + unit);
    textarea.setRangeText(replacement, blockStart, blockEnd, "select");
    textarea.setSelectionRange(blockStart, blockStart + replacement.length);
    dispatchInput(textarea);
  }

  function outdentSelection(textarea, unit) {
    var value = textarea.value;
    var start = textarea.selectionStart;
    var end = textarea.selectionEnd;
    var blockStart = value.lastIndexOf("\n", start - 1) + 1;
    var blockEnd = end === start ? value.indexOf("\n", end) : end;
    if (blockEnd === -1) {
      blockEnd = value.length;
    }

    var block = value.slice(blockStart, blockEnd);
    var lines = block.split("\n");
    var changed = false;
    lines = lines.map(function (line) {
      if (line[0] === "\t") {
        changed = true;
        return line.slice(1);
      }
      var removable = Math.min(unit.length, (line.match(/^ +/) || [""])[0].length);
      if (removable > 0) {
        changed = true;
        return line.slice(removable);
      }
      return line;
    });

    if (!changed) {
      return;
    }
    var replacement = lines.join("\n");
    textarea.setRangeText(replacement, blockStart, blockEnd, "select");
    if (start === end) {
      var removedBeforeCaret = block.length - replacement.length;
      var caret = Math.max(blockStart, start - removedBeforeCaret);
      textarea.setSelectionRange(caret, caret);
    } else {
      textarea.setSelectionRange(blockStart, blockStart + replacement.length);
    }
    dispatchInput(textarea);
  }

  function isEscaped(source, position) {
    var backslashes = 0;
    for (var index = position - 1; index >= 0 && source[index] === "\\"; index -= 1) {
      backslashes += 1;
    }
    return backslashes % 2 === 1;
  }

  function insertPair(textarea, opener) {
    var closer = pairs[opener];
    var start = textarea.selectionStart;
    var end = textarea.selectionEnd;
    var selected = textarea.value.slice(start, end);

    if (start !== end) {
      textarea.setRangeText(opener + selected + closer, start, end, "select");
      textarea.setSelectionRange(start + 1, end + 1);
    } else if (textarea.value[start] === closer && opener !== closer) {
      textarea.setRangeText(opener, start, start, "end");
    } else {
      textarea.setRangeText(opener + closer, start, end, "end");
      textarea.setSelectionRange(start + 1, start + 1);
    }
    dispatchInput(textarea);
  }

  function skipExistingCloser(textarea) {
    var caret = textarea.selectionStart + 1;
    textarea.setSelectionRange(caret, caret);
  }

  function deleteEmptyPair(textarea) {
    var caret = textarea.selectionStart;
    var opener = textarea.value[caret - 1];
    var closer = textarea.value[caret];
    if (caret === 0 || textarea.selectionEnd !== caret || pairs[opener] !== closer) {
      return false;
    }

    textarea.setRangeText("", caret - 1, caret + 1, "end");
    textarea.setSelectionRange(caret - 1, caret - 1);
    dispatchInput(textarea);
    return true;
  }

  function removeOneIndent(indent, unit) {
    if (indent.endsWith("\t")) {
      return indent.slice(0, -1);
    }
    if (unit !== "\t" && indent.endsWith(unit)) {
      return indent.slice(0, -unit.length);
    }
    var trailingSpaces = (indent.match(/ +$/) || [""])[0].length;
    var fallbackWidth = unit === "\t" ? 4 : unit.length;
    var removable = Math.min(trailingSpaces, fallbackWidth);
    return removable > 0 ? indent.slice(0, -removable) : indent;
  }

  function insertIndentedNewline(textarea) {
    var source = textarea.value;
    var start = textarea.selectionStart;
    var end = textarea.selectionEnd;
    var lineStart = source.lastIndexOf("\n", start - 1) + 1;
    var beforeCaret = source.slice(lineStart, start);
    var indentMatch = beforeCaret.match(/^[\t ]*/);
    var parentIndent = indentMatch ? indentMatch[0] : "";
    var statement = beforeCaret.trimEnd();
    var opener = statement.slice(-1);
    var closer = pairs[opener];
    var following = source.slice(end);
    var closingMatch = following.match(/^[\t ]*([)\]}])/);
    var unit = detectIndentUnit(textarea);
    var replacement;
    var replaceEnd = end;
    var caret;

    if (closer && closer !== opener && closingMatch && closingMatch[1] === closer) {
      var childIndent = parentIndent + unit;
      replaceEnd += closingMatch[0].length - 1;
      replacement = "\n" + childIndent + "\n" + parentIndent;
      caret = start + 1 + childIndent.length;
    } else {
      var nextIndent = closer && closer !== opener ? parentIndent + unit : parentIndent;
      if (closingMatch && (!closer || closingMatch[1] !== closer)) {
        nextIndent = removeOneIndent(parentIndent, unit);
      }
      replacement = "\n" + nextIndent;
      caret = start + replacement.length;
    }

    textarea.setRangeText(replacement, start, replaceEnd, "end");
    textarea.setSelectionRange(caret, caret);
    dispatchInput(textarea);
  }

  document.addEventListener("keydown", function (event) {
    var textarea = event.target;
    if (!(textarea instanceof HTMLTextAreaElement) || textarea.readOnly || textarea.disabled || event.isComposing) {
      return;
    }

    if (event.key === "Tab") {
      event.preventDefault();
      var unit = detectIndentUnit(textarea);
      if (event.shiftKey) {
        outdentSelection(textarea, unit);
      } else {
        indentSelection(textarea, unit);
      }
      return;
    }

    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      insertIndentedNewline(textarea);
      return;
    }

    if (event.key === "Backspace" && deleteEmptyPair(textarea)) {
      event.preventDefault();
      return;
    }

    if (event.key === "\"" || event.key === "'" || event.key === "`") {
      if (isEscaped(textarea.value, textarea.selectionStart)) {
        return;
      }
      event.preventDefault();
      if (textarea.selectionStart === textarea.selectionEnd && textarea.value[textarea.selectionStart] === event.key) {
        skipExistingCloser(textarea);
      } else {
        insertPair(textarea, event.key);
      }
      return;
    }

    if (pairs[event.key]) {
      event.preventDefault();
      insertPair(textarea, event.key);
      return;
    }

    if (closingBrackets[event.key] && textarea.selectionStart === textarea.selectionEnd && textarea.value[textarea.selectionStart] === event.key) {
      event.preventDefault();
      skipExistingCloser(textarea);
    }
  });
})();
