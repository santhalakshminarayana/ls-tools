(function () {
  "use strict";

  function bytesToBinary(bytes) {
    var chunks = [];
    var chunkSize = 32768;

    for (var offset = 0; offset < bytes.length; offset += chunkSize) {
      chunks.push(String.fromCharCode.apply(null, bytes.subarray(offset, offset + chunkSize)));
    }

    return chunks.join("");
  }

  function encodeUtf8(value) {
    var bytes = new TextEncoder().encode(value);
    return {
      value: btoa(bytesToBinary(bytes)),
      byteLength: bytes.length
    };
  }

  function normalizeBase64(value) {
    var compact = value.replace(/\s/g, "");

    if (compact === "") {
      throw new Error("Enter Base64 to decode.");
    }
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(compact)) {
      throw new Error("Base64 may contain only A-Z, a-z, 0-9, +, /, padding, and whitespace.");
    }

    var firstPadding = compact.indexOf("=");
    if (firstPadding !== -1 && compact.length % 4 !== 0) {
      throw new Error("Base64 padding is incomplete.");
    }

    var remainder = compact.length % 4;
    if (remainder === 1) {
      throw new Error("Base64 has an invalid length.");
    }
    if (firstPadding === -1 && remainder !== 0) {
      compact += "=".repeat(4 - remainder);
    }

    return compact;
  }

  function decodeUtf8(value) {
    var normalized = normalizeBase64(value);
    var binary;

    try {
      binary = atob(normalized);
    } catch (error) {
      throw new Error("Base64 is malformed.");
    }

    if (btoa(binary) !== normalized) {
      throw new Error("Base64 contains invalid trailing bits or padding.");
    }

    var bytes = new Uint8Array(binary.length);
    for (var index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }

    try {
      return {
        value: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
        byteLength: bytes.length
      };
    } catch (error) {
      throw new Error("Decoded bytes are not valid UTF-8 text.");
    }
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

  function initializeSection(name, transform, actionLabel) {
    var input = document.getElementById("base64-" + name + "-input");
    var output = document.getElementById("base64-" + name + "-output");
    var runButton = document.getElementById("base64-" + name + "-run");
    var copyButton = document.getElementById("base64-" + name + "-copy");
    var clearButton = document.getElementById("base64-" + name + "-clear");
    var status = document.getElementById("base64-" + name + "-status");

    if (!input || !output || !runButton || !copyButton || !clearButton || !status) {
      return;
    }

    function setStatus(message, isError) {
      status.textContent = message;
      status.dataset.state = isError ? "error" : "success";
    }

    runButton.addEventListener("click", function () {
      try {
        var result = transform(input.value);
        output.value = result.value;
        setStatus(actionLabel + " " + result.byteLength + " byte" + (result.byteLength === 1 ? "." : "s."), false);
      } catch (error) {
        output.value = "";
        setStatus(error instanceof Error ? error.message : "The value could not be processed.", true);
      }
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
      output.value = "";
      status.textContent = "";
      delete status.dataset.state;
      input.focus();
    });
  }

  function initialize() {
    initializeSection("encoder", encodeUtf8, "Encoded");
    initializeSection("decoder", decodeUtf8, "Decoded");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();
