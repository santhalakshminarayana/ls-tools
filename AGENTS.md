# AGENT.md

This file is the operating guide for an agent or contributor changing LS Tools. Read it before editing code. Use [README.md](README.md) for the user-facing architecture and usage description; use the current checkout as the final authority when code, tests, and documentation disagree.

## Project identity

LS Tools is a small, local-first Go web application. The Go standard library serves an embedded `static/` browser application. JSON, Base64, JWT, and GraphQL are browser-local utilities. Python and Go execution, plus Go formatting, are explicit HTTP requests to a loopback server that starts local subprocesses.

The project values:

- a dependency-free implementation;
- direct Google/Golang-style tooling rather than a dashboard or promotional product surface;
- no third-party frontend runtime, build step, CDN, or remote data service;
- inert page visits and lazy runtime discovery;
- explicit limits, error reporting, and local-request validation;
- simple native HTML controls with keyboard access, status announcements, line numbers, and responsive light/dark themes.

Do not describe or refactor this application as a hosted code execution service. Its runners execute under the current operating-system user's permissions and are not a security sandbox.

## First-pass workflow for code changes

Before making a change:

1. Read this file and the relevant section of `README.md`.
2. Inspect the current checkout, including `go.mod`, `main.go`, `process.go`, `go_prepare.go`, the affected page, its JavaScript asset, shared assets, and nearby existing tests.
3. Trace the complete control flow before editing. For server behavior, follow route → local request policy → JSON decoding → concurrency gate → runtime resolution → preparation → process execution → response. For browser behavior, follow HTML element → event handler → transformation/API call → output/status/persistence.
4. Decide whether the request is analysis-only or asks for a change. For “check”, “review”, “validate”, or “just list” tasks, do not edit. Do not infer permission to build a new feature from a request that only asks for an explanation.
5. Make the smallest change that preserves neighboring contracts. Do not rewrite unrelated files or replace the no-build architecture with a framework.

Use patch-based edits, keep files in the repository scope, and preserve unrelated user changes. Do not use destructive repository commands to make a clean starting point. Do not add a new test suite or test file unless the task explicitly requests it; use the existing tests and focused checks for verification.

## Architectural contracts to preserve

### Server and HTTP

- The server binds IPv4 loopback at `127.0.0.1:8787`; the accepted alternate browser host is `localhost:8787` with its matching origin.
- `securityHeaders` and `requireLocalRequest` wrap every route. Do not add a route outside those wrappers.
- Execution and formatting `POST` requests require a matching `Origin` before any executable lookup. Malformed input must also fail before runtime discovery.
- JSON request bodies require `Content-Type: application/json`, reject unknown fields, contain one object, and obey the request/code/stdin limits in `main.go`.
- `activeRuns` limits process-backed work to four concurrent operations. Do not bypass it for a new process endpoint.
- Runtime lookup belongs inside the explicit run/format path. Startup, page reads, assets, and `/api/session` must not probe Python, Go, or `gofmt`.
- Responses distinguish infrastructure errors from snippet results. A compiler error or non-zero program exit is a runner result with stdout/stderr/exit code; failure to create or wait for the process is an infrastructure error.
- New process work must use the existing temporary-directory, bounded-output, timeout, and process-group behavior. Do not add an unbounded `exec.Command` path.

### Go runner

- The Go runner invokes the local toolchain with module and proxy behavior disabled. It is intended for short standard-library snippets, not dependency installation.
- `prepareGoCode` parses valid source, infers only unambiguous standard-library imports from unresolved selectors, removes known unused imports, and formats the result. Malformed source is left for compiler diagnostics.
- Keep `go_prepare.go` AST-based. Do not implement import insertion with string replacement; comments, aliases, local variables, and selector ambiguity are already part of the contract.
- `gofmt` is a separate explicit operation at `/api/format/go`; it must not be discovered just by visiting the Go page.

### Browser tools

- Keep pure transformations in the browser. They should not gain a server round trip merely to simplify JavaScript.
- Keep runtime-backed operations in `runner.js` and the existing `/api` contract instead of duplicating subprocess logic in page-specific scripts.
- The pages use plain JavaScript modules wrapped in IIFEs, `var`, DOM event listeners, and no module bundler. Follow the local style unless a deliberate migration is explicitly requested.
- User-controlled text must be rendered with `textContent`, DOM nodes, or the existing escaped highlighter. Do not insert raw user input into `innerHTML`.
- When adding a page, update the page map in `main.go`, home-page tool list, every page's shared navigation, and the embedded asset references. The application has no route generator.
- Preserve labels, headings, `aria-current`, live status regions, focus-visible styles, keyboard paths, and mobile layout when changing markup.

### Persistence and dynamic JSON workspaces

- Drafts live in browser `localStorage`, not in the Go server. `GET /api/session` supplies the server-process identity and maximum age.
- The storage key is `ls-tools-drafts-v1`; state is page-scoped and valid only for the current server session and 24-hour age window.
- Do not overwrite a user's edit that occurs before persistence initialization completes. Do not turn drafts into a server-side or cross-user store without an explicit product decision.
- JSON workspaces are cloned from `#json-workspace-template`, have a maximum of ten, and are addressed through `data-json-role` and `data-json-action` attributes. Do not write behavior that depends on fixed IDs for workspace instances.
- The first JSON input retains the persistence alias `json-input`; workspace count is a persisted structural field. If IDs or aliases change, trace restore, dynamic creation, removal, and reindexing together.

## Themes and interaction design

The visual direction is compact, calm, and tool-like. Preserve the following themes:

- Light and dark themes use CSS custom properties in `styles.css`; changes must remain legible in both palettes.
- Navigation is restrained and functional. Avoid ornamental cards, marketing copy, metrics, dashboards, badges, or AI-style filler.
- Editors should remain readable plain controls with monospace text, line numbers or overlays where already established, visible focus, and synchronized scroll positions.
- Status text should explain what happened: success, parse error, unavailable runtime, non-zero exit, timeout, copy failure, or truncation. Do not replace useful failure detail with a generic “Something went wrong.”
- Browser shortcuts must not interfere with normal typing. Keep `Ctrl/Command + Enter` for runner execution and workspace-scoped find behavior consistent with the existing editor code.
- Use existing spacing, borders, button classes, syntax color vocabulary, and responsive breakpoints before adding new visual primitives.

## Code style

### Go

- Run `gofmt` on changed Go files.
- Prefer the standard library and small named helpers. Keep the existing `main` package and dependency-free module.
- Preserve the existing error vocabulary and JSON response shapes unless the task explicitly changes the API.
- Keep path, host, origin, limit, and timeout policy close to the constants or functions that enforce it.
- Use `http.Handler` composition for cross-cutting behavior and keep handlers responsible for method/status decisions.
- Avoid global mutable state unless it is already part of a bounded, intentionally shared mechanism such as `activeRuns` or the standard-package cache.
- For subprocess changes, consider child processes, output backpressure, timeout cleanup, environment inheritance, temporary-file cleanup, and platform build tags.

### JavaScript

- Match the existing browser style: strict-mode IIFEs, `var`, small functions, event listeners, and graceful no-op initialization when expected elements are absent.
- Keep browser-only tools independent of network access. Use `fetch` only for the established session and runner endpoints.
- Validate input before transformation; clear stale output on a failed transformation; put actionable detail in the status region.
- Keep copy behavior compatible with both the secure Clipboard API and the existing textarea fallback.
- When changing an editor overlay, update the textarea, highlight layer, line numbers, scroll synchronization, selection, and persistence input event together.

### HTML and CSS

- Prefer semantic headings, `label` associations, `button` elements for actions, `details` for optional input, and live regions for asynchronous status.
- Reuse the shared header, navigation, page widths, `.field-group`, `.button-bar`, `.two-pane`, editor, and status patterns.
- Keep inline scripts and external asset paths compatible with the strict self-only Content Security Policy.
- Do not add external fonts, JavaScript, images, or CSS dependencies without an explicit architectural decision.

## Using prior context and memory

Prior task notes can help identify fragile behavior, but they are context rather than proof. Verify any remembered route, limit, fixture, browser behavior, or runtime result against the current checkout before documenting or changing it. In particular, re-check:

- whether the current start path is `make run`/`./run.sh` or `go run .` rather than `go run main.go`;
- the exact local host/origin and API paths;
- the current execution limits and Go environment overrides;
- the current JSON workspace roles, alias, and maximum;
- whether a browser behavior is covered by a current client test or only remembered from an earlier iteration.

Do not store secrets, tokens, personal data, or machine-specific runtime paths in this repository's documentation or agent notes. If a prior decision conflicts with current code, explain the discrepancy and follow the current code until the user explicitly requests a new contract.

## Verification expectations

Choose checks that match the risk:

```sh
gofmt -w <changed-go-files>
go test ./...
node --test tests/*.test.js
```

For HTTP changes, also exercise the relevant route with a local `httptest`-style existing test or a running local server, checking status, headers, body shape, invalid input, and local `Host`/`Origin` behavior. For runner changes, verify missing runtimes, non-zero exits, timeouts, stderr, output truncation, and child-process cleanup where relevant. For UI changes, inspect both themes and narrow/wide layouts and verify keyboard/focus behavior.

Documentation-only changes should be checked for route names, limits, commands, file paths, and claims against the current source. Do not claim live runtime proof from static inspection alone.

## Definition of done

A change is complete when:

- the requested scope is implemented and unrelated behavior is untouched;
- the browser/server boundary and local trust model remain accurate;
- relevant existing tests or focused checks pass;
- changed Go code is formatted;
- user-facing limits, routes, storage behavior, or workflow changes are reflected in `README.md` when appropriate;
- the final handoff names the changed files, verification performed, and any environment-dependent limitation.
