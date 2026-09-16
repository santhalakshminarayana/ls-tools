"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

class FakeEvent {
  constructor(type, options) {
    Object.assign(this, {
      type,
      bubbles: Boolean(options && options.bubbles),
      defaultPrevented: false,
      key: "",
      shiftKey: false,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      isComposing: false,
      target: null
    });
  }

  preventDefault() {
    this.defaultPrevented = true;
  }
}

class FakeTextArea {
  constructor(value) {
    this.value = value || "";
    this.selectionStart = 0;
    this.selectionEnd = 0;
    this.readOnly = false;
    this.disabled = false;
    this.inputEvents = 0;
  }

  setSelectionRange(start, end) {
    this.selectionStart = start;
    this.selectionEnd = end;
  }

  setRangeText(replacement, start, end, mode) {
    this.value = this.value.slice(0, start) + replacement + this.value.slice(end);
    if (mode === "select") {
      this.selectionStart = start;
      this.selectionEnd = start + replacement.length;
    } else {
      this.selectionStart = start + replacement.length;
      this.selectionEnd = this.selectionStart;
    }
  }

  dispatchEvent(event) {
    if (event.type === "input") {
      this.inputEvents += 1;
    }
    return true;
  }
}

function loadEditor(language) {
  let keydownListener;
  global.Event = FakeEvent;
  global.HTMLTextAreaElement = FakeTextArea;
  global.document = {
    body: { dataset: language ? { language } : {} },
    addEventListener(type, listener) {
      if (type === "keydown") {
        keydownListener = listener;
      }
    }
  };

  const source = fs.readFileSync(path.join(__dirname, "../static/assets/editor.js"), "utf8");
  vm.runInThisContext(source, { filename: "editor.js" });
  return keydownListener;
}

function press(listener, textarea, key, options) {
  const event = new FakeEvent("keydown");
  Object.assign(event, options, { key, target: textarea });
  listener(event);
  return event;
}

test("JSON Enter preserves parent indentation and expands bracket pairs", () => {
  const listener = loadEditor();
  const source = new FakeTextArea('{\n  "name": "tool",');
  source.setSelectionRange(source.value.length, source.value.length);

  press(listener, source, "Enter", {});
  assert.equal(source.value, '{\n  "name": "tool",\n  ');

  const block = new FakeTextArea("{}");
  block.setSelectionRange(1, 1);
  press(listener, block, "Enter", {});
  assert.equal(block.value, "{\n  \n}");
  assert.equal(block.selectionStart, 4);
});

test("brackets and quotes pair, wrap selections, skip closers, and delete together", () => {
  const listener = loadEditor();
  const source = new FakeTextArea();

  press(listener, source, "{", {});
  assert.equal(source.value, "{}");
  assert.equal(source.selectionStart, 1);

  press(listener, source, "}", {});
  assert.equal(source.value, "{}");
  assert.equal(source.selectionStart, 2);

  source.value = "value";
  source.setSelectionRange(0, 5);
  press(listener, source, "\"", {});
  assert.equal(source.value, '"value"');
  assert.deepEqual([source.selectionStart, source.selectionEnd], [1, 6]);

  source.value = "";
  source.setSelectionRange(0, 0);
  press(listener, source, "'", {});
  assert.equal(source.value, "''");
  press(listener, source, "Backspace", {});
  assert.equal(source.value, "");

  ["(", "[", "`"].forEach((opener) => {
    source.value = "";
    source.setSelectionRange(0, 0);
    press(listener, source, opener, {});
    assert.equal(source.value, opener + ({ "(": ")", "[": "]", "`": "`" })[opener]);
  });
});

test("Tab still indents and read-only editors remain untouched", () => {
  const listener = loadEditor("python");
  const source = new FakeTextArea("pass");
  source.setSelectionRange(0, 0);
  press(listener, source, "Tab", {});
  assert.equal(source.value, "    pass");

  const output = new FakeTextArea("{}");
  output.readOnly = true;
  output.setSelectionRange(1, 1);
  const event = press(listener, output, "Enter", {});
  assert.equal(event.defaultPrevented, false);
  assert.equal(output.value, "{}");
});
