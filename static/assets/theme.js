(function () {
  "use strict";

  var storageKey = "ls-tools-theme";
  var media = window.matchMedia("(prefers-color-scheme: dark)");
  var moonIcon = '<svg class="theme-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 14.4A8.5 8.5 0 0 1 9.6 3.5a8.5 8.5 0 1 0 10.9 10.9Z"></path></svg>';
  var sunIcon = '<svg class="theme-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.41M17.66 6.34l1.41-1.41"></path></svg>';

  function storedTheme() {
    try {
      var value = localStorage.getItem(storageKey);
      return value === "dark" || value === "light" ? value : null;
    } catch (error) {
      return null;
    }
  }

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    var button = document.getElementById("theme-toggle");
    if (button) {
      var dark = theme === "dark";
      var label = dark ? "Use light theme" : "Use dark theme";
      button.innerHTML = dark ? sunIcon : moonIcon;
      button.setAttribute("aria-label", label);
      button.setAttribute("title", label);
      button.setAttribute("aria-pressed", String(dark));
    }
  }

  applyTheme(storedTheme() || (media.matches ? "dark" : "light"));

  function initialize() {
    var button = document.getElementById("theme-toggle");
    if (!button) {
      return;
    }
    applyTheme(document.documentElement.dataset.theme || "light");
    button.addEventListener("click", function () {
      var next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      try {
        localStorage.setItem(storageKey, next);
      } catch (error) {
        // The selected theme still applies for this page when storage is unavailable.
      }
      applyTheme(next);
    });
  }

  media.addEventListener("change", function (event) {
    if (storedTheme() === null) {
      applyTheme(event.matches ? "dark" : "light");
    }
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();
