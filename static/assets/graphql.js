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

  function connectLineNumbers(textarea, lineNumbers) {
    if (!lineNumbers) {
      return function () {};
    }

    function update() {
      var displayedText = textarea.value || textarea.placeholder || "";
      var lineCount = displayedText.split(/\r\n|\r|\n/).length;
      var numbers = [];
      for (var lineNumber = 1; lineNumber <= lineCount; lineNumber += 1) {
        numbers.push(String(lineNumber));
      }
      lineNumbers.textContent = numbers.join("\n");
      lineNumbers.scrollTop = textarea.scrollTop;
    }

    textarea.addEventListener("input", update);
    textarea.addEventListener("scroll", function () {
      lineNumbers.scrollTop = textarea.scrollTop;
    });
    update();
    return update;
  }

  function initialize() {
    var input = document.getElementById("graphql-input");
    var output = document.getElementById("graphql-output");
    var inputLineNumbers = document.getElementById("graphql-input-line-numbers");
    var outputLineNumbers = document.getElementById("graphql-output-line-numbers");
    var formatButton = document.getElementById("graphql-format");
    var minifyButton = document.getElementById("graphql-minify");
    var copyButton = document.getElementById("graphql-copy");
    var clearButton = document.getElementById("graphql-clear");
    var status = document.getElementById("graphql-status");

    if (!input || !output || !formatButton || !minifyButton || !copyButton || !clearButton || !status) {
      return;
    }

    var updateInputLineNumbers = connectLineNumbers(input, inputLineNumbers);
    var updateOutputLineNumbers = connectLineNumbers(output, outputLineNumbers);

    function setOutput(value) {
      output.value = value;
      updateOutputLineNumbers();
    }

    function setStatus(message, isError) {
      status.textContent = message;
      status.dataset.state = isError ? "error" : "success";
    }

    function transform(minify) {
      if (input.value.trim() === "") {
        setOutput("");
        setStatus("Enter a GraphQL document.", true);
        input.focus();
        return;
      }

      try {
        var tokens = tokenize(input.value);
        var formatted = new Parser(tokens, input.value).parseDocument();
        setOutput(minify ? minifyTokens(tokens) : formatted);
        setStatus(minify ? "GraphQL minified." : "GraphQL formatted.", false);
      } catch (error) {
        setOutput("");
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
      input.value = "";
      setOutput("");
      updateInputLineNumbers();
      status.textContent = "";
      delete status.dataset.state;
      input.focus();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();
