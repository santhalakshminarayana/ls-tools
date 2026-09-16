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
    this.target = null;
  }
}

class FakeTextArea {
  constructor(id, value) {
    this.id = id;
    this.value = value || "";
    this.dataset = {};
    this.readOnly = false;
    this.disabled = false;
    this.document = null;
  }

  setSelectionRange() {}

  dispatchEvent(event) {
    event.target = this;
    this.document.dispatch(event);
  }
}

function storageWith(initial) {
  const values = new Map(Object.entries(initial || {}));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    }
  };
}

async function loadPersistence({ serverID, stored, initialValue, preserveDefault }) {
  const listeners = new Map();
  const windowListeners = new Map();
  const field = new FakeTextArea("json-input", initialValue);
  if (preserveDefault) field.dataset.persistDefault = "";
  const document = {
    readyState: "complete",
    visibilityState: "visible",
    querySelectorAll() {
      return [field];
    },
    addEventListener(type, listener) {
      const list = listeners.get(type) || [];
      list.push(listener);
      listeners.set(type, list);
    },
    dispatch(event) {
      (listeners.get(event.type) || []).forEach((listener) => listener(event));
    }
  };
  field.document = document;
  const localStorage = storageWith(stored);
  const window = {
    location: { pathname: "/json" },
    addEventListener(type, listener) {
      const list = windowListeners.get(type) || [];
      list.push(listener);
      windowListeners.set(type, list);
    }
  };

  global.document = document;
  global.window = window;
  global.HTMLTextAreaElement = FakeTextArea;
  global.Event = FakeEvent;
  global.fetch = async () => ({
    ok: true,
    async json() {
      return { id: serverID, maxAgeMs: 24 * 60 * 60 * 1000 };
    }
  });
  Object.defineProperty(globalThis, "localStorage", {
    value: localStorage,
    writable: true,
    configurable: true
  });

  const source = fs.readFileSync(path.join(__dirname, "../static/assets/persistence.js"), "utf8");
  vm.runInThisContext(source, { filename: "persistence.js" });
  await new Promise((resolve) => setImmediate(resolve));

  return {
    field,
    document,
    localStorage,
    pagehide() {
      (windowListeners.get("pagehide") || []).forEach((listener) => listener());
    }
  };
}

test("drafts restore for the same server and save current edits", async () => {
  const key = "ls-tools-drafts-v1";
  const stored = JSON.stringify({
    sessionID: "server-one",
    updatedAt: Date.now(),
    pages: { "/json": { "json-input": "saved text" } }
  });
  const page = await loadPersistence({
    serverID: "server-one",
    stored: { [key]: stored },
    initialValue: ""
  });

  assert.equal(page.field.value, "saved text");
  page.field.value = "changed text";
  page.document.dispatch(Object.assign(new FakeEvent("input"), { target: page.field }));
  page.pagehide();
  assert.equal(JSON.parse(page.localStorage.getItem(key)).pages["/json"]["json-input"], "changed text");
});

test("a new server session and expired drafts both start empty", async () => {
  const key = "ls-tools-drafts-v1";
  const oldServer = JSON.stringify({
    sessionID: "old-server",
    updatedAt: Date.now(),
    pages: { "/json": { "json-input": "old text" } }
  });
  const restarted = await loadPersistence({
    serverID: "new-server",
    stored: { [key]: oldServer },
    initialValue: "static default"
  });
  assert.equal(restarted.field.value, "");
  assert.equal(JSON.parse(restarted.localStorage.getItem(key)).sessionID, "new-server");

  const expired = JSON.stringify({
    sessionID: "same-server",
    updatedAt: Date.now() - (25 * 60 * 60 * 1000),
    pages: { "/json": { "json-input": "expired text" } }
  });
  const expiredPage = await loadPersistence({
    serverID: "same-server",
    stored: { [key]: expired },
    initialValue: "static default"
  });
  assert.equal(expiredPage.field.value, "");
});

test("a declared editor scaffold survives a new server session", async () => {
  const key = "ls-tools-drafts-v1";
  const oldDraft = JSON.stringify({
    sessionID: "old-server",
    updatedAt: Date.now(),
    pages: { "/json": { "json-input": "old code" } }
  });
  const page = await loadPersistence({
    serverID: "new-server",
    stored: { [key]: oldDraft },
    initialValue: "package main\n\nfunc main() {}\n",
    preserveDefault: true
  });
  assert.equal(page.field.value, "package main\n\nfunc main() {}\n");
});
