(function () {
  "use strict";

  var storageKey = "ls-tools-drafts-v1";
  var pageKey = window.location.pathname;
  var sessionID = "";
  var maxAgeMS = 24 * 60 * 60 * 1000;
  var ready = false;
  var applying = false;
  var saveTimer = 0;

  function textFields() {
    return Array.prototype.filter.call(document.querySelectorAll("textarea[id], input[data-persist-text][id]"), function (field) {
      return !field.disabled;
    });
  }

  function readStore() {
    try {
      var value = localStorage.getItem(storageKey);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      return null;
    }
  }

  function writeStore(store) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(store));
      return true;
    } catch (error) {
      return false;
    }
  }

  function removeStore() {
    try {
      localStorage.removeItem(storageKey);
    } catch (error) {
      // Text persistence remains unavailable when browser storage is disabled.
    }
  }

  function freshStore(now) {
    return {
      sessionID: sessionID,
      updatedAt: now,
      pages: {}
    };
  }

  function validStore(store, now) {
    return store &&
      store.sessionID === sessionID &&
      Number.isFinite(store.updatedAt) &&
      now - store.updatedAt < maxAgeMS &&
      store.pages && typeof store.pages === "object";
  }

  function notifyField(field) {
    field.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function applyPageState(state) {
    applying = true;
    function applyFields() {
      textFields().forEach(function (field) {
        var value = state && typeof state[field.id] === "string" ? state[field.id] : null;
        var alias = field.dataset ? field.dataset.persistAlias : "";
        if (value === null && alias && state && typeof state[alias] === "string") {
          value = state[alias];
        }
        var preserveDefault = field.dataset && Object.prototype.hasOwnProperty.call(field.dataset, "persistDefault");
        if (value !== null) {
          field.value = value;
        } else if (!preserveDefault) {
          field.value = "";
        }
        if (field.type !== "hidden" && typeof field.setSelectionRange === "function") {
          field.setSelectionRange(0, 0);
        }
        notifyField(field);
      });
    }
    applyFields();
    // Structural fields, such as the JSON workspace count, may create more
    // persisted editors during the first pass.
    applyFields();
    applying = false;
  }

  function pageSnapshot() {
    var state = {};
    textFields().forEach(function (field) {
      state[field.id] = field.value;
    });
    return state;
  }

  function saveNow() {
    if (!ready || sessionID === "" || textFields().length === 0) {
      return;
    }

    var now = Date.now();
    var store = readStore();
    if (!validStore(store, now)) {
      store = freshStore(now);
    }
    store.pages[pageKey] = pageSnapshot();
    store.updatedAt = now;
    writeStore(store);
  }

  function scheduleSave() {
    if (saveTimer) {
      clearTimeout(saveTimer);
    }
    saveTimer = setTimeout(function () {
      saveTimer = 0;
      saveNow();
    }, 200);
  }

  async function initialize() {
    var changedBeforeReady = false;

    document.addEventListener("input", function (event) {
      var target = event.target;
      var persistedInput = target && target.dataset && Object.prototype.hasOwnProperty.call(target.dataset, "persistText");
      if ((!persistedInput && !(target instanceof HTMLTextAreaElement)) || target.readOnly || applying) {
        return;
      }
      if (!ready) {
        changedBeforeReady = true;
        return;
      }
      scheduleSave();
    });

    window.addEventListener("pagehide", saveNow);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") {
        saveNow();
      }
    });

    try {
      var response = await fetch("/api/session", { cache: "no-store" });
      if (!response.ok) {
        return;
      }
      var session = await response.json();
      if (!session || typeof session.id !== "string" || session.id === "") {
        return;
      }

      sessionID = session.id;
      if (Number.isFinite(session.maxAgeMs) && session.maxAgeMs > 0) {
        maxAgeMS = session.maxAgeMs;
      }

      var now = Date.now();
      var store = readStore();
      if (!validStore(store, now)) {
        removeStore();
        store = freshStore(now);
      }

      if (!changedBeforeReady) {
        applyPageState(store.pages[pageKey]);
      }

      ready = true;
      if (textFields().length > 0) {
        saveNow();
      } else {
        writeStore(store);
      }
    } catch (error) {
      // Keep the page usable if the local session check is unavailable.
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();
