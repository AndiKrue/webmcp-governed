# Verification status

What was verified, where, and what remains for the author. Everything below was run from a fresh
`npm ci` on Node 22 on Linux x86_64. "Polyfill" means the page's own `document.modelContext`
implementation (`src/webmcp/polyfill.ts`), installed in full only when the browser offers none.
"Native" means a browser-provided `modelContext`. Two native cases are known so far:

| Browser | Where the API lives | Methods provided | What the page does |
|---|---|---|---|
| Chrome for Testing 148.0.7778.97 (Linux, Puppeteer's build) with `--enable-features=WebMCPTesting` or any of the other flags below | `navigator.modelContext` only | `registerTool` | aliases it onto `document`, keeps native `registerTool`, adds `getTools`, `executeTool` and `toolchange` on top (badge: *native WebMCP (partial, completed by the page)*) |
| Chrome 150.0.7871.182 (Windows) with `chrome://flags/#enable-webmcp-testing`, reported by the author on the deployed preview with `?nopolyfill=1` | `document.modelContext` | `registerTool`, `getTools`, `executeTool`, `ontoolchange` | nothing added; registration succeeded natively, `getTools()` listed the tools, and `executeTool` invoked them natively and returned the correct JSON with `receipt_id` (badge: *native WebMCP*) |

Native invocation on Chrome 150 works. What first looked like a failure was the argument shape, not a
missing method: Chrome 150's `executeTool` takes the input as a **JSON string** and rejects an object
with `UnknownError: Failed to parse input arguments`, while the draft IDL takes an object. The
page's polyfill accepts both shapes, and the tool console sends the string form first against a
native API and falls back to the object form on `UnknownError`.

Feature detection is per method (`installModelContext` in `src/webmcp/polyfill.ts` returns which
methods were native and which were shimmed; the diagnostics panel shows both).

## Verified here

| What | Where | Result |
|---|---|---|
| `npm run check` (typecheck, 44 unit tests, build, SPDX header lint) | Node 22, vitest + happy-dom | green |
| Gate: pending until decided; approve → result; decline → `{status:"declined", reason, retry_hint}`; sealed refuses a wrong confirmation and accepts `340`, `340.00`, `340,00`; abort → `cancelled_by_caller`; open tools never produce a card; class read from the definition, not the input | unit tests (`tests/gate.test.ts`) | green |
| Two-call token lifecycle: pending → approved → consumed → invalid; refusal committed; unknown token invalid | unit tests | green |
| Polyfill: register/list/execute round trip, duplicate and malformed names rejected, unregister on signal abort, thrown `execute` → opaque `UnknownError`, caller abort propagated to the tool's signal | unit tests (`tests/polyfill.test.ts`) | green |
| Fixture invariants: 26 expenses, 4 members, exactly 2 near-duplicate pairs, exactly 3 uncategorised (one a Notion subscription), D-001 = 340.00 EUR to Contractor X for invoice 2026-114, D-002 plainly must not be paid | unit tests (`tests/fixture.test.ts`) | green |
| The seven tools: success values, `invalid` on bad ids / foreign expenses / uncategorised or flagged expenses in a draft / already drafted or paid / empty reason; effect-line text; `commit_approved_action` only under two-call | unit tests (`tests/tools.test.ts`) | green |
| Full demo path through `document.modelContext.executeTool`: open call with no card; gated approve; gated decline with reason reaching the caller as a structured refusal, then a re-proposal with different arguments; sealed payment with wrong amount refused (also when the button is forced) and right amount paying, draft and expense turning `paid`; must-not-pay draft declined with `never`; caller abort withdrawing the card and writing `cancelled_by_caller`; export download containing every decision kind with `latency_ms`; reset | Polyfill, Chrome 148 headless, both transports (`npm run e2e`) | green, 175 checks |
| `executeTool` accepts both argument shapes (object per the draft IDL, JSON string as Chrome 150 sends it) and rejects a malformed string as `UnknownError: Failed to parse input arguments`; the tool console reports which shape it used | unit tests and e2e, polyfill and Chrome 148 (shimmed) | green |
| Same demo path in native mode, plus: diagnostics name the native and shimmed methods, the object is not the polyfill, the console sends the JSON string form first | Chrome 148 + `WebMCPTesting`, both transports (`npm run e2e -- --native`) | green; see the caveat below |
| Per-method completion: full polyfill when nothing exists; complete native object untouched; `registerTool`-only object gains the other three with native `registerTool` still called for every registration; `navigator`-only object aliased and completed | unit tests (`tests/shim.test.ts`) | green |
| Bare URL shows no console; `?console=1` shows it; `?transport=two-call` registers `commit_approved_action`; default transport is `hold`; in-page transport switch re-registers tools; `toolchange` fires once per change for `ontoolchange` and for listeners | Polyfill, Chrome 148 | green |
| No console errors and no outbound requests on the bare page, with `?nopolyfill=1`, and along the demo path | Chrome 148, Puppeteer request logging | green |
| `npm run build` writes `dist/index.html`; `vite preview` serves it at `/` | Node 22 | green |

## Native probe (Chrome for Testing 148.0.7778.97)

`e2e/native-probe.mjs` loads `/?nopolyfill=1` under five flag sets and records the API shape before
the page's script runs. With every one of `--enable-features=WebMCPTesting`,
`--enable-features=WebMCP`, `--enable-features=WebMCP,WebMCPTesting`,
`--enable-experimental-web-platform-features` and `--enable-blink-features=WebMCP` the browser
provides `navigator.modelContext` with **only `registerTool`** on its prototype; `document.modelContext`
is absent. Without a flag there is nothing on either.

Caveat: registration of all seven tools succeeds natively in that build (a duplicate name is refused
with `InvalidStateError`), but nothing in it can invoke a tool, so the native e2e run calls through
the page-added `executeTool`, which reaches the same registered `execute` and the same gate. Whether
a real client keeps a 15-second pending gated call open could therefore **not** be observed here. The
ledger's `latency_ms` and any `cancelled_by_caller` rows are how the author reads that from the
ChatGPT test. Chrome 150 (see the table above) invokes natively, so that observation is possible
there once an agent is attached.

## Remaining for the author

| What | Where | How to read the result |
|---|---|---|
| Open the deployed URL, confirm the "Site tools" panel lists three read and four write tools | ChatGPT desktop app, built-in browser | the open/gated split is visible before any call |
| Shots 1–4 of `VIDEO-SHOTLIST.md` | ChatGPT desktop app | every gated call is the probe: an `approved`/`declined` row with a `latency_ms` of seconds means the client held the call; a `cancelled_by_caller` row or the agent reporting a failed call means it did not — then set `DEFAULT_TRANSPORT = "two-call"` in `src/gate/config.ts`, redeploy, repeat |
| Same shots | Chrome 149+ with `chrome://flags/#enable-webmcp-testing` and an agent attached | same reading |
| Cloudflare Pages production build (`npm run build`, output `dist`, Node from `.node-version`) | Pages dashboard | if the build image ignores `.node-version`, set `NODE_VERSION=22` on the project |
| Fill the `**Live:**` and `**Video:**` placeholders in the README | repository | — |
