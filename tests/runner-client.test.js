"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

class FakeElement {
  constructor(options) {
    const values = options || {};
    this.value = values.value || "";
    this.textContent = values.textContent || "";
    this.innerHTML = "";
    this.dataset = {};
    this.hidden = false;
    this.disabled = false;
    this.scrollTop = 0;
    this.scrollLeft = 0;
    this.listeners = {};
    this.closestValues = {};
    this.queryValues = {};
    this.classes = new Set();
    this.classList = {
      add: (...names) => names.forEach((name) => this.classes.add(name))
    };
  }

  addEventListener(type, listener) {
    this.listeners[type] = listener;
  }

  closest(selector) {
    return this.closestValues[selector] || null;
  }

  querySelector(selector) {
    return this.queryValues[selector] || null;
  }
}

function renderHighlight(language, source) {
  const code = new FakeElement({ value: source });
  const stdin = new FakeElement();
  const run = new FakeElement({ textContent: "Run" });
  const format = language === "go" ? new FakeElement({ textContent: "Format" }) : null;
  const output = new FakeElement();
  const status = new FakeElement();
  const runtime = new FakeElement();
  const shell = new FakeElement();
  const highlight = new FakeElement();
  const highlightedCode = new FakeElement();
  const form = new FakeElement();

  code.closestValues[".code-editor-shell"] = shell;
  run.closestValues.form = form;
  highlight.queryValues.code = highlightedCode;

  const elements = {
    [`${language}-code`]: code,
    [`${language}-stdin`]: stdin,
    [`${language}-run`]: run,
    [`${language}-output`]: output,
    [`${language}-status`]: status,
    [`${language}-runtime`]: runtime,
    [`${language}-highlight`]: highlight
  };
  if (format) {
    elements["go-format"] = format;
  }

  const document = {
    readyState: "complete",
    body: { dataset: { language } },
    getElementById(id) {
      return elements[id] || null;
    }
  };

  const script = fs.readFileSync(path.join(__dirname, "../static/assets/runner.js"), "utf8");
  vm.runInNewContext(script, { document }, { filename: "runner.js" });

  assert.equal(shell.classes.has("syntax-enabled"), true);
  return highlightedCode.innerHTML;
}

function assertToken(html, className, token) {
  assert.match(html, new RegExp(`<span class="${className}">${token}</span>`));
}

test("Python runner highlights VS Code-like semantic token groups", () => {
  const html = renderHighlight("python", `@dataclass
class User:
    name: str

def greet(user):
    print("Hello", user.name, None, 42)  # greeting
`);

  assertToken(html, "syntax-decorator", "dataclass");
  assertToken(html, "syntax-declaration", "class");
  assertToken(html, "syntax-type", "User");
  assertToken(html, "syntax-type", "str");
  assertToken(html, "syntax-function", "greet");
  assertToken(html, "syntax-builtin", "print");
  assertToken(html, "syntax-string", '"Hello"');
  assertToken(html, "syntax-namespace", "user");
  assertToken(html, "syntax-property", "name");
  assertToken(html, "syntax-literal", "None");
  assertToken(html, "syntax-number", "42");
  assertToken(html, "syntax-comment", "# greeting");
});

test("Go runner highlights VS Code-like semantic token groups", () => {
  const html = renderHighlight("go", `package main

import (
    "fmt"
    "strings"
)

type User struct { Name string }

func main() {
    fmt.Println(strings.ToUpper("hello"), true, 42)
    _ = config.Name
}
`);

  assertToken(html, "syntax-declaration", "package");
  assertToken(html, "syntax-type", "User");
  assertToken(html, "syntax-type", "string");
  assertToken(html, "syntax-function", "main");
  assertToken(html, "syntax-namespace", "fmt");
  assertToken(html, "syntax-namespace", "strings");
  assertToken(html, "syntax-function", "Println");
  assertToken(html, "syntax-function", "ToUpper");
  assertToken(html, "syntax-property", "Name");
  assertToken(html, "syntax-string", '"hello"');
  assertToken(html, "syntax-literal", "true");
  assertToken(html, "syntax-number", "42");
});
