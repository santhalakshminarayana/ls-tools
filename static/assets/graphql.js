(function () {
  "use strict";

  function location(source, offset) {
    var lines = source.slice(0, offset).split(/\r\n|\r|\n/);
    return "line " + lines.length + ", column " + (lines[lines.length - 1].length + 1);
  }

  function graphQLError(source, offset, message) {
    return new Error(message + " at " + location(source, offset) + ".");
  }

  function tokenize(source) {
    var tokens = [];
    var index = 0;
    var punctuators = "!$&():=@[]{|}";

    while (index < source.length) {
      var character = source[index];

      if (character === "\ufeff" || character === "," || /\s/.test(character)) {
        index += 1;
        continue;
      }

      if (character === "#") {
        var commentStart = index;
        while (index < source.length && source[index] !== "\n" && source[index] !== "\r") {
          index += 1;
        }
        tokens.push({ kind: "comment", value: source.slice(commentStart, index), offset: commentStart });
        continue;
      }

      if (source.slice(index, index + 3) === "...") {
        tokens.push({ kind: "punctuator", value: "...", offset: index });
        index += 3;
        continue;
      }

      if (character === "\"") {
        var stringStart = index;

        if (source.slice(index, index + 3) === "\"\"\"") {
          index += 3;
          var blockClosed = false;
          while (index < source.length) {
            if (source.slice(index, index + 4) === "\\\"\"\"") {
              index += 4;
              continue;
            }
            if (source.slice(index, index + 3) === "\"\"\"") {
              index += 3;
              blockClosed = true;
              break;
            }
            index += 1;
          }
          if (!blockClosed) {
            throw graphQLError(source, stringStart, "Unterminated GraphQL block string");
          }
        } else {
          index += 1;
          var stringClosed = false;
          while (index < source.length) {
            var stringCharacter = source[index];
            if (stringCharacter === "\"") {
              index += 1;
              stringClosed = true;
              break;
            }
            if (stringCharacter === "\\") {
              if (index + 1 >= source.length) {
                throw graphQLError(source, stringStart, "Unterminated GraphQL string");
              }
              index += 2;
              continue;
            }
            if (stringCharacter === "\n" || stringCharacter === "\r" || stringCharacter.charCodeAt(0) < 0x20) {
              throw graphQLError(source, index, "GraphQL strings cannot contain an unescaped line break or control character");
            }
            index += 1;
          }
          if (!stringClosed) {
            throw graphQLError(source, stringStart, "Unterminated GraphQL string");
          }
        }

        tokens.push({ kind: "string", value: source.slice(stringStart, index), offset: stringStart });
        continue;
      }

      if (character === "-" || /[0-9]/.test(character)) {
        var numberMatch = source.slice(index).match(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/);
        if (!numberMatch) {
          throw graphQLError(source, index, "Invalid GraphQL number");
        }
        tokens.push({ kind: "number", value: numberMatch[0], offset: index });
        index += numberMatch[0].length;
        continue;
      }

      if (/[_A-Za-z]/.test(character)) {
        var nameMatch = source.slice(index).match(/^[_A-Za-z][_0-9A-Za-z]*/)[0];
        tokens.push({ kind: "name", value: nameMatch, offset: index });
        index += nameMatch.length;
        continue;
      }

      if (punctuators.indexOf(character) !== -1) {
        tokens.push({ kind: "punctuator", value: character, offset: index });
        index += 1;
        continue;
      }

      throw graphQLError(source, index, "Unexpected character " + JSON.stringify(character));
    }

    tokens.push({ kind: "eof", value: "", offset: source.length });
    return tokens;
  }

  function Parser(tokens, source) {
    this.tokens = tokens;
    this.source = source;
    this.index = 0;
  }

  Parser.prototype.current = function () {
    return this.tokens[this.index];
  };

  Parser.prototype.at = function (value) {
    return this.current().value === value;
  };

  Parser.prototype.discardComments = function () {
    while (this.current().kind === "comment") {
      this.index += 1;
    }
  };

  Parser.prototype.fail = function (message) {
    throw graphQLError(this.source, this.current().offset, message);
  };

  Parser.prototype.expect = function (value) {
    this.discardComments();
    if (!this.at(value)) {
      this.fail("Expected " + JSON.stringify(value) + " but found " + JSON.stringify(this.current().value || "end of input"));
    }
    this.index += 1;
  };

  Parser.prototype.expectName = function () {
    this.discardComments();
    if (this.current().kind !== "name") {
      this.fail("Expected a GraphQL name but found " + JSON.stringify(this.current().value || "end of input"));
    }
    var value = this.current().value;
    this.index += 1;
    return value;
  };

  Parser.prototype.spaces = function (depth) {
    return "  ".repeat(depth);
  };

  Parser.prototype.parseDocument = function () {
    var definitions = [];

    while (this.current().kind !== "eof") {
      if (this.current().kind === "comment") {
        definitions.push(this.current().value);
        this.index += 1;
        continue;
      }

      if (this.at("{")) {
        definitions.push(this.parseSelectionSet(0));
        continue;
      }

      if (this.current().kind !== "name") {
        this.fail("Expected a query, mutation, subscription, fragment, or selection set");
      }

      if (this.current().value === "fragment") {
        definitions.push(this.parseFragment());
      } else if (["query", "mutation", "subscription"].indexOf(this.current().value) !== -1) {
        definitions.push(this.parseOperation());
      } else {
        this.fail("Only executable GraphQL documents are supported; expected query, mutation, subscription, or fragment");
      }
    }

    if (definitions.length === 0) {
      this.fail("Enter a GraphQL document");
    }
    return definitions.join("\n\n");
  };

  Parser.prototype.parseOperation = function () {
    var operation = this.expectName();
    var header = operation;

    if (this.current().kind === "name") {
      header += " " + this.expectName();
    }
    if (this.at("(")) {
      header += this.parseVariableDefinitions();
    }
    header += this.parseDirectives();
    if (!this.at("{")) {
      this.fail("Expected a selection set for " + operation);
    }
    return header + " " + this.parseSelectionSet(0);
  };

  Parser.prototype.parseFragment = function () {
    this.expect("fragment");
    var name = this.expectName();
    this.expect("on");
    var typeName = this.expectName();
    var header = "fragment " + name + " on " + typeName + this.parseDirectives();
    if (!this.at("{")) {
      this.fail("Expected a selection set for fragment " + name);
    }
    return header + " " + this.parseSelectionSet(0);
  };

  Parser.prototype.parseVariableDefinitions = function () {
    var definitions = [];
    this.expect("(");

    while (!this.at(")")) {
      this.discardComments();
      if (this.at(")")) {
        break;
      }
      this.expect("$");
      var definition = "$" + this.expectName();
      this.expect(":");
      definition += ": " + this.parseType();
      if (this.at("=")) {
        this.expect("=");
        definition += " = " + this.parseValue();
      }
      definition += this.parseDirectives();
      definitions.push(definition);
    }

    this.expect(")");
    if (definitions.length === 0) {
      this.fail("Variable definition lists cannot be empty");
    }
    return "(" + definitions.join(", ") + ")";
  };

  Parser.prototype.parseType = function () {
    var value;
    if (this.at("[")) {
      this.expect("[");
      value = "[" + this.parseType() + "]";
      this.expect("]");
    } else {
      value = this.expectName();
    }
    if (this.at("!")) {
      this.expect("!");
      value += "!";
    }
    return value;
  };

  Parser.prototype.parseSelectionSet = function (depth) {
    var lines = [];
    this.expect("{");

    while (!this.at("}")) {
      if (this.current().kind === "eof") {
        this.fail("Unterminated selection set");
      }
      if (this.current().kind === "comment") {
        lines.push(this.spaces(depth + 1) + this.current().value);
        this.index += 1;
        continue;
      }
      lines.push(this.parseSelection(depth + 1));
    }

    if (lines.length === 0) {
      this.fail("Selection sets cannot be empty");
    }
    this.expect("}");
    return "{\n" + lines.join("\n") + "\n" + this.spaces(depth) + "}";
  };

  Parser.prototype.parseSelection = function (depth) {
    if (this.at("...")) {
      return this.parseFragmentSelection(depth);
    }

    var firstName = this.expectName();
    var field = firstName;
    if (this.at(":")) {
      this.expect(":");
      field += ": " + this.expectName();
    }
    if (this.at("(")) {
      field += this.parseArguments();
    }
    field += this.parseDirectives();
    if (this.at("{")) {
      field += " " + this.parseSelectionSet(depth);
    }
    return this.spaces(depth) + field;
  };

  Parser.prototype.parseFragmentSelection = function (depth) {
    this.expect("...");
    var value = "...";

    if (this.current().kind === "name" && this.current().value === "on") {
      this.expect("on");
      value += " on " + this.expectName();
      value += this.parseDirectives();
      if (!this.at("{")) {
        this.fail("Expected a selection set for inline fragment");
      }
      value += " " + this.parseSelectionSet(depth);
    } else if (this.at("@")) {
      value += this.parseDirectives();
      if (!this.at("{")) {
        this.fail("Expected a selection set for inline fragment");
      }
      value += " " + this.parseSelectionSet(depth);
    } else {
      value += this.expectName();
      value += this.parseDirectives();
    }

    return this.spaces(depth) + value;
  };

  Parser.prototype.parseArguments = function () {
    var argumentsList = [];
    this.expect("(");

    while (!this.at(")")) {
      this.discardComments();
      if (this.at(")")) {
        break;
      }
      var argument = this.expectName();
      this.expect(":");
      argument += ": " + this.parseValue();
      argumentsList.push(argument);
    }

    this.expect(")");
    if (argumentsList.length === 0) {
      this.fail("Argument lists cannot be empty");
    }
    return "(" + argumentsList.join(", ") + ")";
  };

  Parser.prototype.parseDirectives = function () {
    var directives = [];
    while (this.at("@")) {
      this.expect("@");
      var directive = "@" + this.expectName();
      if (this.at("(")) {
        directive += this.parseArguments();
      }
      directives.push(directive);
    }
    return directives.length === 0 ? "" : " " + directives.join(" ");
  };

  Parser.prototype.parseValue = function () {
    this.discardComments();
    var token = this.current();

    if (this.at("$")) {
      this.expect("$");
      return "$" + this.expectName();
    }
    if (token.kind === "string" || token.kind === "number" || token.kind === "name") {
      this.index += 1;
      return token.value;
    }
    if (this.at("[")) {
      var items = [];
      this.expect("[");
      while (!this.at("]")) {
        if (this.current().kind === "eof") {
          this.fail("Unterminated list value");
        }
        items.push(this.parseValue());
      }
      this.expect("]");
      return "[" + items.join(", ") + "]";
    }
    if (this.at("{")) {
      var fields = [];
      this.expect("{");
      while (!this.at("}")) {
        if (this.current().kind === "eof") {
          this.fail("Unterminated object value");
        }
        var field = this.expectName();
        this.expect(":");
        field += ": " + this.parseValue();
        fields.push(field);
      }
      this.expect("}");
      return fields.length === 0 ? "{}" : "{ " + fields.join(", ") + " }";
    }

    this.fail("Expected a GraphQL value");
  };

  function minifyTokens(tokens) {
    var output = "";
    var previous = null;

    tokens.forEach(function (token) {
      if (token.kind === "comment" || token.kind === "eof") {
        return;
      }

      var wordLike = token.kind === "name" || token.kind === "number" || token.kind === "string";
      var previousWordLike = previous && (previous.kind === "name" || previous.kind === "number" || previous.kind === "string");
      if (previousWordLike && wordLike) {
        output += " ";
      }
      output += token.value;
      previous = token;
    });

    return output;
  }

  async function copyText(value) {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return;
    }

    var temporary = document.createElement("textarea");
    temporary.value = value;
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

  function nextNonWhitespace(source, position) {
    while (position < source.length && /\s/.test(source[position])) {
      position += 1;
    }
    return source[position] || "";
  }

  function bracketClass(brackets, character) {
    var pairs = { "{": "}", "[": "]", "(": ")" };
    if (pairs[character]) {
      var className = "syntax-bracket syntax-bracket-" + String((brackets.length % 3) + 1);
      brackets.push({ closer: pairs[character], className: className });
      return className;
    }
    var opener = brackets[brackets.length - 1];
    if (opener && opener.closer === character) {
      brackets.pop();
      return opener.className;
    }
    return "syntax-bracket syntax-bracket-error";
  }

  function candidateTouches(candidates, start, end) {
    return candidates.some(function (candidate) {
      return candidate >= start && candidate < end;
    });
  }

  function matchingPairRanges(source, selectionStart, selectionEnd) {
    if (selectionStart !== selectionEnd) {
      return [];
    }
    var candidates = [];
    if (selectionStart < source.length) {
      candidates.push(selectionStart);
    }
    if (selectionStart > 0) {
      candidates.push(selectionStart - 1);
    }

    var pairs = { "{": "}", "[": "]", "(": ")" };
    var brackets = [];

    for (var index = 0; index < source.length; index += 1) {
      var character = source[index];
      if (character === "#") {
        while (index < source.length && source[index] !== "\n" && source[index] !== "\r") {
          index += 1;
        }
        continue;
      }
      if (character === "\"") {
        var quoteLength = source.slice(index, index + 3) === "\"\"\"" ? 3 : 1;
        var cursor = index + quoteLength;
        var closed = false;
        while (cursor < source.length) {
          if (quoteLength === 3) {
            if (source.slice(cursor, cursor + 4) === "\\\"\"\"") {
              cursor += 4;
              continue;
            }
            if (source.slice(cursor, cursor + 3) === "\"\"\"") {
              closed = true;
              break;
            }
            cursor += 1;
            continue;
          }
          if (source[cursor] === "\\") {
            cursor += 2;
            continue;
          }
          if (source[cursor] === "\"") {
            closed = true;
            break;
          }
          cursor += 1;
        }
        if (closed && (candidateTouches(candidates, index, index + quoteLength) || candidateTouches(candidates, cursor, cursor + quoteLength))) {
          return [{ start: index, end: index + quoteLength }, { start: cursor, end: cursor + quoteLength }];
        }
        index = closed ? cursor + quoteLength - 1 : source.length;
        continue;
      }
      if (pairs[character]) {
        brackets.push({ character: character, index: index });
      } else if (character === "}" || character === "]" || character === ")") {
        var opener = brackets[brackets.length - 1];
        if (opener && pairs[opener.character] === character) {
          brackets.pop();
          if (candidates.indexOf(opener.index) !== -1 || candidates.indexOf(index) !== -1) {
            return [{ start: opener.index, end: opener.index + 1 }, { start: index, end: index + 1 }];
          }
        }
      }
    }
    return [];
  }

  function classWithMatch(className, start, length, matchRanges) {
    var end = start + length;
    var matches = matchRanges.some(function (range) {
      return start < range.end && range.start < end;
    });
    return matches ? className + " syntax-match" : className;
  }

  function appendStringToken(fragment, source, start, matchRanges) {
    var quote = source.slice(start, start + 3) === "\"\"\"" ? "\"\"\"" : "\"";
    var position = start + quote.length;
    var contentStart = position;
    var closed = false;

    while (position < source.length) {
      if (quote.length === 3) {
        if (source.slice(position, position + 4) === "\\\"\"\"") {
          position += 4;
          continue;
        }
        if (source.slice(position, position + 3) === quote) {
          position += 3;
          closed = true;
          break;
        }
        position += 1;
        continue;
      }

      if (source[position] === "\\") {
        position = Math.min(source.length, position + 2);
        continue;
      }
      if (source[position] === quote) {
        position += 1;
        closed = true;
        break;
      }
      position += 1;
    }

    appendToken(fragment, classWithMatch("syntax-quote", start, quote.length, matchRanges), quote);
    var contentEnd = closed ? position - quote.length : position;
    if (contentEnd > contentStart) {
      appendToken(fragment, "syntax-string", source.slice(contentStart, contentEnd));
    }
    if (closed) {
      appendToken(fragment, classWithMatch("syntax-quote", position - quote.length, quote.length, matchRanges), quote);
    }
    return position;
  }

  function identifierClass(value, source, end, state) {
    if (["query", "mutation", "subscription"].indexOf(value) !== -1) {
      state.expectOperationName = true;
      return "syntax-keyword";
    }
    if (value === "fragment") {
      state.expectFragmentName = true;
      return "syntax-keyword";
    }
    if (value === "on") {
      state.expectFragmentReference = false;
      return "syntax-keyword";
    }
    if (["true", "false", "null"].indexOf(value) !== -1) {
      return "syntax-literal";
    }
    if (state.expectOperationName) {
      state.expectOperationName = false;
      return "syntax-operation";
    }
    if (state.expectFragmentName) {
      state.expectFragmentName = false;
      return "syntax-fragment";
    }
    if (state.expectFragmentReference) {
      state.expectFragmentReference = false;
      return "syntax-fragment";
    }
    if (/^[A-Z]/.test(value)) {
      return "syntax-type";
    }
    if (nextNonWhitespace(source, end) === ":") {
      return "syntax-property";
    }
    return "syntax-field";
  }

  function renderHighlight(target, source, matchRanges) {
    var fragment = document.createDocumentFragment();
    var plainStart = 0;
    var index = 0;
    var brackets = [];
    var state = { expectOperationName: false, expectFragmentName: false, expectFragmentReference: false };

    function flushPlain(end) {
      if (end > plainStart) {
        fragment.appendChild(document.createTextNode(source.slice(plainStart, end)));
      }
    }

    function appendHighlighted(className, start, end) {
      flushPlain(start);
      appendToken(fragment, className, source.slice(start, end));
      index = end;
      plainStart = end;
    }

    while (index < source.length) {
      var character = source[index];
      if (character === "#") {
        var commentEnd = index;
        while (commentEnd < source.length && source[commentEnd] !== "\n" && source[commentEnd] !== "\r") {
          commentEnd += 1;
        }
        appendHighlighted("syntax-comment", index, commentEnd);
        continue;
      }
      if (character === "\"") {
        flushPlain(index);
        index = appendStringToken(fragment, source, index, matchRanges);
        plainStart = index;
        continue;
      }
      if (character === "{" || character === "[" || character === "(" || character === "}" || character === "]" || character === ")") {
        if (character === "{" || character === "(") {
          state.expectOperationName = false;
        }
        appendHighlighted(classWithMatch(bracketClass(brackets, character), index, 1, matchRanges), index, index + 1);
        continue;
      }
      if (source.slice(index, index + 3) === "...") {
        state.expectFragmentReference = true;
        appendHighlighted("syntax-punctuation", index, index + 3);
        continue;
      }
      if ((character === "$" || character === "@") && /[_A-Za-z]/.test(source[index + 1] || "")) {
        state.expectOperationName = false;
        var nameEnd = index + 2;
        while (/[_0-9A-Za-z]/.test(source[nameEnd] || "")) {
          nameEnd += 1;
        }
        flushPlain(index);
        appendToken(fragment, "syntax-punctuation", character);
        appendToken(fragment, character === "$" ? "syntax-variable" : "syntax-decorator", source.slice(index + 1, nameEnd));
        index = nameEnd;
        plainStart = index;
        continue;
      }
      if (/[_A-Za-z]/.test(character)) {
        var identifierEnd = index + 1;
        while (/[_0-9A-Za-z]/.test(source[identifierEnd] || "")) {
          identifierEnd += 1;
        }
        var className = identifierClass(source.slice(index, identifierEnd), source, identifierEnd, state);
        if (className) {
          appendHighlighted(className, index, identifierEnd);
        } else {
          index = identifierEnd;
        }
        continue;
      }
      var number = source.slice(index).match(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/);
      if (number) {
        appendHighlighted("syntax-number", index, index + number[0].length);
        continue;
      }
      if ("!$&:=@|,".indexOf(character) !== -1) {
        if (character === "$" || character === "@") {
          state.expectOperationName = false;
        }
        appendHighlighted("syntax-punctuation", index, index + 1);
        continue;
      }
      index += 1;
    }
    flushPlain(source.length);
    target.replaceChildren(fragment);
  }

  function createHighlighter(textarea, highlight, lineNumbers) {
    var shell = textarea.closest(".code-editor-shell");
    var highlightedCode = highlight ? highlight.querySelector("code") : null;
    if (!shell || !highlightedCode) {
      return function () {};
    }

    function syncScroll() {
      highlight.scrollTop = textarea.scrollTop;
      highlight.scrollLeft = textarea.scrollLeft;
      if (lineNumbers) {
        lineNumbers.scrollTop = textarea.scrollTop;
      }
    }

    function update() {
      if (lineNumbers) {
        var displayedText = textarea.value || textarea.placeholder || "";
        var lineCount = displayedText.split(/\r\n|\r|\n/).length;
        var numbers = [];
        for (var lineNumber = 1; lineNumber <= lineCount; lineNumber += 1) {
          numbers.push(String(lineNumber));
        }
        lineNumbers.textContent = numbers.join("\n");
      }
      renderHighlight(highlightedCode, textarea.value, matchingPairRanges(textarea.value, textarea.selectionStart, textarea.selectionEnd));
      syncScroll();
    }

    textarea.addEventListener("input", update);
    textarea.addEventListener("scroll", syncScroll);
    textarea.addEventListener("click", update);
    textarea.addEventListener("keyup", update);
    textarea.addEventListener("select", update);
    shell.classList.add("syntax-enabled");
    update();
    return update;
  }

  function initialize() {
    var input = document.getElementById("graphql-input");
    var output = document.getElementById("graphql-output");
    var inputLineNumbers = document.getElementById("graphql-input-line-numbers");
    var outputLineNumbers = document.getElementById("graphql-output-line-numbers");
    var inputHighlight = document.getElementById("graphql-input-highlight");
    var outputHighlight = document.getElementById("graphql-output-highlight");
    var formatButton = document.getElementById("graphql-format");
    var minifyButton = document.getElementById("graphql-minify");
    var copyButton = document.getElementById("graphql-copy");
    var clearButton = document.getElementById("graphql-clear");
    var status = document.getElementById("graphql-status");

    if (!input || !output || !formatButton || !minifyButton || !copyButton || !clearButton || !status) {
      return;
    }

    createHighlighter(input, inputHighlight, inputLineNumbers);
    createHighlighter(output, outputHighlight, outputLineNumbers);
    var synchronizing = false;

    function dispatchInput(field) {
      field.dispatchEvent(new Event("input", { bubbles: true }));
    }

    function synchronizeFrom(source, target) {
      if (synchronizing || target.value === source.value) {
        return;
      }
      synchronizing = true;
      target.value = source.value;
      dispatchInput(target);
      synchronizing = false;
    }

    function setDocument(value) {
      synchronizing = true;
      input.value = value;
      output.value = value;
      input.setSelectionRange(0, 0);
      output.setSelectionRange(0, 0);
      dispatchInput(input);
      dispatchInput(output);
      synchronizing = false;
    }

    function setStatus(message, isError) {
      status.textContent = message;
      status.dataset.state = isError ? "error" : "success";
    }

    function transform(minify) {
      if (input.value.trim() === "") {
        setDocument("");
        setStatus("Enter a GraphQL document.", true);
        input.focus();
        return;
      }

      try {
        var tokens = tokenize(input.value);
        var formatted = new Parser(tokens, input.value).parseDocument();
        setDocument(minify ? minifyTokens(tokens) : formatted);
        setStatus(minify ? "GraphQL minified." : "GraphQL formatted.", false);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "The GraphQL document could not be processed.", true);
      }
    }

    formatButton.addEventListener("click", function () {
      transform(false);
    });

    minifyButton.addEventListener("click", function () {
      transform(true);
    });

    copyButton.addEventListener("click", async function () {
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

    clearButton.addEventListener("click", function () {
      setDocument("");
      status.textContent = "";
      delete status.dataset.state;
      input.focus();
    });

    input.addEventListener("input", function () {
      if (!synchronizing) {
        synchronizeFrom(input, output);
      }
    });
    output.addEventListener("input", function () {
      if (!synchronizing) {
        synchronizeFrom(output, input);
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();
