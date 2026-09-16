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

  function initialize() {
    var input = document.getElementById("jwt-input");
    var header = document.getElementById("jwt-header");
    var payload = document.getElementById("jwt-payload");
    var decodeButton = document.getElementById("jwt-decode");
    var copyButton = document.getElementById("jwt-copy-payload");
    var clearButton = document.getElementById("jwt-clear");
    var status = document.getElementById("jwt-status");

    if (!input || !header || !payload || !decodeButton || !copyButton || !clearButton || !status) {
      return;
    }

    function setStatus(message, isError) {
      status.textContent = message;
      status.dataset.state = isError ? "error" : "success";
    }

    decodeButton.addEventListener("click", function () {
      var token = input.value.trim().replace(/^Bearer\s+/i, "");
      var segments = token.split(".");

      header.value = "";
      payload.value = "";

      if (token === "") {
        setStatus("Enter a JWT to decode.", true);
        input.focus();
        return;
      }
      if (segments.length !== 3) {
        setStatus("A compact signed JWT must contain exactly three dot-separated segments.", true);
        return;
      }

      try {
        var headerValue = parseJSONObject(decodeBase64URL(segments[0], "header"), "header");
        var payloadValue = parseJSONObject(decodeBase64URL(segments[1], "payload"), "payload");
        header.value = JSON.stringify(headerValue, null, 2);
        payload.value = JSON.stringify(payloadValue, null, 2);
        setStatus("Decoded header and payload. Signature not verified.", false);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "The JWT could not be decoded.", true);
      }
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
      input.value = "";
      header.value = "";
      payload.value = "";
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
