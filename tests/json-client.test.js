"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

class FakeEvent {
  constructor(type, options) {
    this.type = type;
    this.bubbles = Boolean(options && options.bubbles);
    this.defaultPrevented = false;
    this.key = "";
    this.ctrlKey = false;
    this.metaKey = false;
    this.altKey = false;
    this.shiftKey = false;
    this.target = null;
  }

  preventDefault() {
    this.defaultPrevented = true;
  }
}

class FakeClassList {
  constructor(values) {
    this.values = new Set(values || []);
  }

  add(value) {
    this.values.add(value);
  }

  contains(value) {
    return this.values.has(value);
  }
}

class FakeNode {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName;
    this.ownerDocument = ownerDocument;
    this.id = "";
    this.value = "";
    this.textContent = "";
    this.className = "";
    this.classList = new FakeClassList();
    this.dataset = {};
    this.attributes = {};
    this.hidden = false;
    this.disabled = false;
    this.readOnly = false;
    this.type = "";
    this.selectionStart = 0;
    this.selectionEnd = 0;
    this.scrollTop = 0;
    this.scrollLeft = 0;
    this.children = [];
    this.listeners = new Map();
    this.parentNode = null;
    this.style = {};
    this.title = "";
  }

  addEventListener(type, listener) {
    const list = this.listeners.get(type) || [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  dispatchEvent(event) {
    event.target = event.target || this;
    (this.listeners.get(event.type) || []).forEach((listener) => listener.call(this, event));
    return !event.defaultPrevented;
  }

  appendChild(child) {
    if (child.tagName === "#fragment") {
      [...child.children].forEach((nested) => this.appendChild(nested));
      child.children = [];
      return child;
    }
    if (child.parentNode) {
      const oldIndex = child.parentNode.children.indexOf(child);
      if (oldIndex >= 0) child.parentNode.children.splice(oldIndex, 1);
    }
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  replaceChildren(...children) {
    this.children.forEach((child) => { child.parentNode = null; });
    this.children = [];
    children.forEach((child) => this.appendChild(child));
  }

  remove() {
    if (!this.parentNode) return;
    const index = this.parentNode.children.indexOf(this);
    if (index >= 0) this.parentNode.children.splice(index, 1);
    this.parentNode = null;
  }

  cloneNode(deep) {
    const clone = new FakeNode(this.tagName, this.ownerDocument);
    Object.assign(clone, {
      id: this.id,
      value: this.value,
      textContent: this.textContent,
      className: this.className,
      dataset: { ...this.dataset },
      attributes: { ...this.attributes },
      hidden: this.hidden,
      disabled: this.disabled,
      readOnly: this.readOnly,
      type: this.type,
      title: this.title
    });
    clone.classList = new FakeClassList(this.classList.values);
    if (deep) this.children.forEach((child) => clone.appendChild(child.cloneNode(true)));
    return clone;
  }

  matches(selector) {
    let match = selector.match(/^\[data-json-role="([^"]+)"\]$/);
    if (match) return this.dataset.jsonRole === match[1];
    match = selector.match(/^\[data-json-action="([^"]+)"\]$/);
    if (match) return this.dataset.jsonAction === match[1];
    if (selector === ".json-workspace") return this.classList.contains("json-workspace");
    if (selector === "code") return this.tagName === "code";
    if (selector === '.button-bar[aria-label="JSON actions"]') {
      return this.classList.contains("button-bar") && this.attributes["aria-label"] === "JSON actions";
    }
    return false;
  }

  querySelector(selector) {
    const queue = [...this.children];
    while (queue.length) {
      const candidate = queue.shift();
      if (candidate.matches(selector)) return candidate;
      queue.push(...candidate.children);
    }
    return null;
  }

  contains(candidate) {
    let node = candidate;
    while (node) {
      if (node === this) return true;
      node = node.parentNode;
    }
    return false;
  }

  focus() {
    this.ownerDocument.activeElement = this;
  }

  select() {
    this.selectionStart = 0;
    this.selectionEnd = this.value.length;
  }

  setSelectionRange(start, end) {
    this.selectionStart = start;
    this.selectionEnd = end;
  }

  setRangeText(replacement, start, end) {
    this.value = this.value.slice(0, start) + replacement + this.value.slice(end);
    this.selectionStart = start + replacement.length;
    this.selectionEnd = this.selectionStart;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === "readonly") this.readOnly = true;
  }

  removeAttribute(name) {
    delete this.attributes[name];
    if (name === "title") this.title = "";
  }
}

class FakeDocument {
  constructor() {
    this.elements = new Map();
    this.listeners = new Map();
    this.readyState = "complete";
    this.activeElement = null;
    this.body = new FakeNode("body", this);
  }

  add(id, tagName) {
    const element = new FakeNode(tagName || "div", this);
    element.id = id;
    this.elements.set(id, element);
    return element;
  }

  getElementById(id) {
    return this.elements.get(id) || null;
  }

  createElement(tagName) {
    return new FakeNode(tagName, this);
  }

  createTextNode(value) {
    const node = new FakeNode("#text", this);
    node.textContent = value;
    return node;
  }

  createDocumentFragment() {
    return new FakeNode("#fragment", this);
  }

  addEventListener(type, listener) {
    const list = this.listeners.get(type) || [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  dispatchEvent(event) {
    event.target = event.target || this.activeElement || this;
    (this.listeners.get(event.type) || []).forEach((listener) => listener.call(this, event));
    return !event.defaultPrevented;
  }

  execCommand() {
    return true;
  }
}

function addNode(parent, tagName, options) {
  const node = new FakeNode(tagName, parent.ownerDocument);
  const settings = options || {};
  if (settings.className) {
    node.className = settings.className;
    node.classList = new FakeClassList(settings.className.split(/\s+/));
  }
  if (settings.role) node.dataset.jsonRole = settings.role;
  if (settings.action) node.dataset.jsonAction = settings.action;
  if (settings.ariaLabel) node.attributes["aria-label"] = settings.ariaLabel;
  if (settings.hidden) node.hidden = true;
  if (settings.readOnly) node.readOnly = true;
  parent.appendChild(node);
  return node;
}

function buildWorkspaceTemplate(document) {
  const fragment = new FakeNode("#fragment", document);
  const root = addNode(fragment, "section", { className: "json-workspace" });
  const header = addNode(root, "div");
  addNode(header, "h2", { role: "title" });
  addNode(header, "button", { action: "remove" });

  const actions = addNode(root, "div", { className: "button-bar", ariaLabel: "JSON actions" });
  ["format", "minify", "format-source", "minify-source", "copy", "clear"].forEach((name) => {
    addNode(actions, "button", { action: name });
  });

  const panes = addNode(root, "div");
  const sourceGroup = addNode(panes, "div");
  addNode(sourceGroup, "label", { role: "source-label" });
  const sourceShell = addNode(sourceGroup, "div", { role: "source-shell" });
  const inputHighlight = addNode(sourceShell, "pre", { role: "input-highlight" });
  addNode(inputHighlight, "code");
  const find = addNode(sourceShell, "div", { role: "find-widget", hidden: true });
  addNode(find, "label", { role: "pattern-label" });
  addNode(find, "input", { role: "pattern" });
  addNode(find, "label", { role: "flags-label" });
  addNode(find, "input", { role: "flags" });
  addNode(find, "span", { role: "find-count" });
  ["previous", "next", "close-find"].forEach((name) => addNode(find, "button", { action: name }));
  addNode(find, "label", { role: "replacement-label" });
  addNode(find, "input", { role: "replacement" });
  addNode(find, "button", { action: "replace" });
  addNode(find, "button", { action: "replace-all" });
  addNode(sourceShell, "textarea", { role: "input" });

  const outputGroup = addNode(panes, "div");
  addNode(outputGroup, "label", { role: "output-label" });
  const outputShell = addNode(outputGroup, "div", { role: "output-shell" });
  const outputHighlight = addNode(outputShell, "pre", { role: "output-highlight" });
  addNode(outputHighlight, "code");
  addNode(outputShell, "textarea", { role: "output", readOnly: true });
  addNode(root, "p", { role: "status" });
  return fragment;
}

function role(workspace, name) {
  return workspace.querySelector(`[data-json-role="${name}"]`);
}

function action(workspace, name) {
  return workspace.querySelector(`[data-json-action="${name}"]`);
}

function click(element) {
  element.dispatchEvent(new FakeEvent("click"));
}

function input(element) {
  element.dispatchEvent(new FakeEvent("input", { bubbles: true }));
}

function buildPage() {
  const document = new FakeDocument();
  const container = document.add("json-workspaces");
  const template = document.add("json-workspace-template", "template");
  template.content = buildWorkspaceTemplate(document);
  const count = document.add("json-workspace-count", "input");
  count.value = "1";
  const newButton = document.add("json-new", "button");
  const removeAll = document.add("json-remove-all", "button");

  global.document = document;
  global.window = { isSecureContext: false };
  Object.defineProperty(globalThis, "navigator", { value: {}, writable: true, configurable: true });
  global.Event = FakeEvent;

  const source = fs.readFileSync(path.join(__dirname, "../static/assets/json.js"), "utf8");
  vm.runInThisContext(source, { filename: "json.js" });
  return { document, container, count, newButton, removeAll };
}

test("JSON workspaces add up to ten and remove individually or globally", () => {
  const page = buildPage();
  assert.equal(page.container.children.length, 1);
  assert.equal(page.removeAll.disabled, true);
  assert.equal(action(page.container.children[0], "remove").disabled, true);

  role(page.container.children[0], "input").value = "keep first";
  for (let index = 1; index < 10; index += 1) click(page.newButton);
  assert.equal(page.container.children.length, 10);
  assert.equal(page.count.value, "10");
  assert.equal(page.newButton.disabled, true);
  assert.equal(role(page.container.children[9], "title").textContent, "JSON 10");

  click(action(page.container.children[4], "remove"));
  assert.equal(page.container.children.length, 9);
  assert.equal(role(page.container.children[4], "title").textContent, "JSON 5");

  click(page.removeAll);
  assert.equal(page.container.children.length, 1);
  assert.equal(page.count.value, "1");
  assert.equal(role(page.container.children[0], "input").value, "keep first");
});

test("each JSON workspace formats and diagnoses independently", () => {
  const page = buildPage();
  click(page.newButton);
  const first = page.container.children[0];
  const second = page.container.children[1];
  role(first, "input").value = '{"name":"first","active":true}';
  input(role(first, "input"));
  click(action(first, "format"));
  assert.match(role(first, "output").value, /\n  "name": "first"/);
  assert.equal(role(second, "output").value, "");

  role(second, "input").value = '{"name":"second",}';
  input(role(second, "input"));
  click(action(second, "format"));
  assert.match(role(second, "status").textContent, /line 1, column 17 \(character 17\)/);
  assert.match(role(second, "status").textContent, /Trailing commas are not allowed/);

  const tokenClasses = role(first, "input-highlight").querySelector("code").children
    .map((node) => node.className).filter(Boolean);
  assert.ok(tokenClasses.includes("syntax-key"));
  assert.ok(tokenClasses.includes("syntax-string"));
  assert.ok(tokenClasses.includes("syntax-literal"));
});

test("find and replace stays scoped to its active workspace", () => {
  const page = buildPage();
  click(page.newButton);
  const first = page.container.children[0];
  const second = page.container.children[1];
  const source = role(second, "input");
  source.value = "a a";
  input(source);
  source.focus();

  const findEvent = new FakeEvent("keydown");
  Object.assign(findEvent, { key: "f", ctrlKey: true, target: source });
  page.document.dispatchEvent(findEvent);
  assert.equal(findEvent.defaultPrevented, true);
  assert.equal(role(first, "find-widget").hidden, true);
  assert.equal(role(second, "find-widget").hidden, false);

  role(second, "pattern").value = "a";
  input(role(second, "pattern"));
  assert.equal(role(second, "find-count").textContent, "1/2");
  click(action(second, "next"));
  assert.equal(role(second, "find-count").textContent, "2/2");
  assert.equal(source.selectionStart, 2);

  source.value = "a".repeat(101);
  input(source);
  assert.equal(role(second, "find-count").textContent, "101");
  assert.equal(action(second, "next").disabled, true);
  assert.equal(action(second, "replace").disabled, true);
  role(second, "replacement").value = "b";
  click(action(second, "replace-all"));
  assert.equal(source.value, "b".repeat(101));
});
