(function () {
  "use strict";

  function decodeBase64URL(segment, label) {
    if (segment === "" || !/^[A-Za-z0-9_-]+$/.test(segment)) {
      throw new Error("The JWT " + label + " segment is not valid Base64URL.");
    }

    var standard = segment.replace(/-/g, "+").replace(/_/g, "/");
    var remainder = standard.length % 4;
    if (remainder === 1) {
      throw new Error("The JWT " + label + " segment has an invalid length.");
    }
    if (remainder !== 0) {
      standard += "=".repeat(4 - remainder);
    }

    var binary;
    try {
      binary = atob(standard);
    } catch (error) {
      throw new Error("The JWT " + label + " segment is malformed.");
    }

    var canonical = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    if (canonical !== segment) {
      throw new Error("The JWT " + label + " segment has invalid trailing bits.");
    }

    var bytes = new Uint8Array(binary.length);
    for (var index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }

    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch (error) {
      throw new Error("The JWT " + label + " is not valid UTF-8 text.");
    }
  }

  function encodeBase64URL(source) {
    var bytes = new TextEncoder().encode(source);
    var binary = "";
    for (var index = 0; index < bytes.length; index += 1) {
      binary += String.fromCharCode(bytes[index]);
    }
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function parseJSONObject(source, label) {
    var value;
    try {
      value = JSON.parse(source);
    } catch (error) {
      throw new Error("The JWT " + label + " is not valid JSON.");
    }

    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("The JWT " + label + " must be a JSON object.");
    }
    return value;
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

  function matchingJSONPairRanges(source, selectionStart, selectionEnd) {
    if (selectionStart !== selectionEnd) {
      return [];
    }
    var candidates = {};
    if (selectionStart < source.length) {
      candidates[selectionStart] = true;
    }
    if (selectionStart > 0) {
      candidates[selectionStart - 1] = true;
    }

    var brackets = [];
    var stringStart = -1;
    var escaped = false;
    var pairs = { "{": "}", "[": "]" };

    for (var index = 0; index < source.length; index += 1) {
      var character = source[index];
      if (stringStart !== -1) {
        if (escaped) {
          escaped = false;
        } else if (character === "\\") {
          escaped = true;
        } else if (character === "\"") {
          if (candidates[stringStart] || candidates[index]) {
            return [{ start: stringStart, end: stringStart + 1 }, { start: index, end: index + 1 }];
          }
          stringStart = -1;
        }
        continue;
      }

      if (character === "\"") {
        stringStart = index;
      } else if (pairs[character]) {
        brackets.push({ character: character, index: index });
      } else if (character === "}" || character === "]") {
        var opener = brackets[brackets.length - 1];
        if (opener && pairs[opener.character] === character) {
          brackets.pop();
          if (candidates[opener.index] || candidates[index]) {
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

  function appendJSONString(fragment, className, value, closed, start, matchRanges) {
    appendToken(fragment, classWithMatch("syntax-quote", start, 1, matchRanges), "\"");
    var contentEnd = value.length - (closed ? 1 : 0);
    if (contentEnd > 1) {
      appendToken(fragment, className, value.slice(1, contentEnd));
    }
    if (closed) {
      appendToken(fragment, classWithMatch("syntax-quote", start + value.length - 1, 1, matchRanges), "\"");
    }
  }

  function jsonBracketClass(brackets, character) {
    var pairs = { "{": "}", "[": "]" };
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

  function renderJSONHighlight(target, source, matchRanges) {
    var fragment = document.createDocumentFragment();
    var plainStart = 0;
    var index = 0;
    var brackets = [];

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
        var closed = false;
        while (tokenEnd < source.length) {
          var character = source[tokenEnd];
          tokenEnd += 1;
          if (escaped) {
            escaped = false;
          } else if (character === "\\") {
            escaped = true;
          } else if (character === "\"") {
            closed = true;
            break;
          }
        }
        var afterString = tokenEnd;
        while (/\s/.test(source[afterString] || "")) {
          afterString += 1;
        }
        className = source[afterString] === ":" ? "syntax-key" : "syntax-string";
        flushPlain(index);
        appendJSONString(fragment, className, source.slice(index, tokenEnd), closed, index, matchRanges);
        index = tokenEnd;
        plainStart = index;
        continue;
      }
      if (source[index] === "{" || source[index] === "[" || source[index] === "}" || source[index] === "]") {
        flushPlain(index);
        appendToken(fragment, classWithMatch(jsonBracketClass(brackets, source[index]), index, 1, matchRanges), source[index]);
        index += 1;
        plainStart = index;
        continue;
      }
      var number = source.slice(index).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
      var literal = source.slice(index).match(/^(?:true|false|null)\b/);
      if (number) {
        tokenEnd = index + number[0].length;
        className = "syntax-number";
      } else if (literal) {
        tokenEnd = index + literal[0].length;
        className = "syntax-literal";
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

  function createJSONHighlighter(textarea, highlight, lineNumbers) {
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
      renderJSONHighlight(highlightedCode, textarea.value, matchingJSONPairRanges(textarea.value, textarea.selectionStart, textarea.selectionEnd));
      updateLineNumbers(textarea, lineNumbers);
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

  function renderTokenHighlight(target, source) {
    var fragment = document.createDocumentFragment();
    var offset = 0;
    var bearer = source.match(/^Bearer(\s+)/i);
    if (bearer) {
      appendToken(fragment, "syntax-jwt-prefix", source.slice(0, 6));
      fragment.appendChild(document.createTextNode(bearer[1]));
      offset = bearer[0].length;
    }

    var token = source.slice(offset);
    var segments = token.split(".");
    segments.forEach(function (segment, index) {
      var className = index === 0 ? "syntax-jwt-header" : (index === 1 ? "syntax-jwt-payload" : "syntax-jwt-signature");
      if (segment !== "") {
        appendToken(fragment, className, segment);
      }
      if (index < segments.length - 1) {
        appendToken(fragment, "syntax-jwt-separator", ".");
      }
    });
    target.replaceChildren(fragment);
  }

  function createTokenHighlighter(textarea, highlight) {
    var shell = textarea.closest(".jwt-token-shell");
    var highlightedCode = highlight ? highlight.querySelector("code") : null;
    if (!shell || !highlightedCode) {
      return function () {};
    }

    function syncScroll() {
      highlight.scrollTop = textarea.scrollTop;
      highlight.scrollLeft = textarea.scrollLeft;
    }

    function update() {
      renderTokenHighlight(highlightedCode, textarea.value);
      syncScroll();
    }

    textarea.addEventListener("input", update);
    textarea.addEventListener("scroll", syncScroll);
    shell.classList.add("syntax-enabled");
    update();
    return update;
  }

  function initialize() {
    var input = document.getElementById("jwt-input");
    var header = document.getElementById("jwt-header");
    var payload = document.getElementById("jwt-payload");
    var inputHighlight = document.getElementById("jwt-input-highlight");
    var headerHighlight = document.getElementById("jwt-header-highlight");
    var payloadHighlight = document.getElementById("jwt-payload-highlight");
    var headerLineNumbers = document.getElementById("jwt-header-line-numbers");
    var payloadLineNumbers = document.getElementById("jwt-payload-line-numbers");
    var decodeButton = document.getElementById("jwt-decode");
    var copyButton = document.getElementById("jwt-copy-payload");
    var clearButton = document.getElementById("jwt-clear");
    var status = document.getElementById("jwt-status");

    if (!input || !header || !payload || !decodeButton || !copyButton || !clearButton || !status) {
      return;
    }

    createTokenHighlighter(input, inputHighlight);
    createJSONHighlighter(header, headerHighlight, headerLineNumbers);
    createJSONHighlighter(payload, payloadHighlight, payloadLineNumbers);
    var synchronizing = false;

    function setStatus(message, isError) {
      status.textContent = message;
      status.dataset.state = isError ? "error" : "success";
    }

    function setWarning(message) {
      status.textContent = message;
      status.dataset.state = "warning";
    }

    function dispatchInput(field) {
      field.dispatchEvent(new Event("input", { bubbles: true }));
    }

    function tokenParts(value) {
      var bearer = value.match(/^\s*Bearer\s+/i);
      var prefix = bearer ? bearer[0] : "";
      var token = value.slice(prefix.length).trim();
      return { prefix: prefix, token: token, segments: token === "" ? [] : token.split(".") };
    }

    function setDecodedValues(headerValue, payloadValue) {
      synchronizing = true;
      header.value = JSON.stringify(headerValue, null, 2);
      payload.value = JSON.stringify(payloadValue, null, 2);
      header.setSelectionRange(0, 0);
      payload.setSelectionRange(0, 0);
      dispatchInput(header);
      dispatchInput(payload);
      synchronizing = false;
    }

    function clearDecodedValues() {
      synchronizing = true;
      header.value = "";
      payload.value = "";
      dispatchInput(header);
      dispatchInput(payload);
      synchronizing = false;
    }

    function decodeFromToken(reportError) {
      var parts = tokenParts(input.value);
      if (parts.token === "") {
        clearDecodedValues();
        if (reportError) {
          setStatus("Enter a JWT to decode.", true);
          input.focus();
        }
        return false;
      }
      if (parts.segments.length !== 3) {
        if (reportError) {
          setStatus("A compact signed JWT must contain exactly three dot-separated segments.", true);
        }
        return false;
      }

      try {
        var headerValue = parseJSONObject(decodeBase64URL(parts.segments[0], "header"), "header");
        var payloadValue = parseJSONObject(decodeBase64URL(parts.segments[1], "payload"), "payload");
        setDecodedValues(headerValue, payloadValue);
        if (reportError) {
          setStatus("Decoded header and payload. Signature not verified.", false);
        }
        return true;
      } catch (error) {
        if (reportError) {
          setStatus(error instanceof Error ? error.message : "The JWT could not be decoded.", true);
        }
        return false;
      }
    }

    function synchronizeTokenFromDecoded() {
      if (synchronizing || header.value.trim() === "" || payload.value.trim() === "") {
        return;
      }
      try {
        var headerValue = parseJSONObject(header.value, "header");
        var payloadValue = parseJSONObject(payload.value, "payload");
        var parts = tokenParts(input.value);
        var signature = parts.segments.length === 3 ? parts.segments[2] : "";
        synchronizing = true;
        input.value = parts.prefix + encodeBase64URL(JSON.stringify(headerValue)) + "." + encodeBase64URL(JSON.stringify(payloadValue)) + "." + signature;
        dispatchInput(input);
        synchronizing = false;
        setWarning("Header and payload synchronized to the compact token. Its existing signature is not valid for edited data.");
      } catch (error) {
        // Keep the compact token stable while either edited JSON pane is incomplete.
      }
    }

    decodeButton.addEventListener("click", function () {
      decodeFromToken(true);
    });

    copyButton.addEventListener("click", async function () {
      if (payload.value === "") {
        setStatus("There is no decoded payload to copy.", true);
        return;
      }

      try {
        await copyText(payload.value);
        setStatus("Payload copied. Signature not verified.", false);
      } catch (error) {
        setStatus("Could not copy the payload. Select it and copy manually.", true);
      }
    });

    clearButton.addEventListener("click", function () {
      synchronizing = true;
      input.value = "";
      header.value = "";
      payload.value = "";
      dispatchInput(input);
      dispatchInput(header);
      dispatchInput(payload);
      synchronizing = false;
      status.textContent = "";
      delete status.dataset.state;
      input.focus();
    });

    input.addEventListener("input", function () {
      if (!synchronizing) {
        decodeFromToken(false);
      }
    });
    header.addEventListener("input", synchronizeTokenFromDecoded);
    payload.addEventListener("input", synchronizeTokenFromDecoded);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();
