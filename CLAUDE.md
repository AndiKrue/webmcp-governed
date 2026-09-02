# Governed Tool Calls

A WebMCP demo: an agent proposes consequential actions through tools registered with
`document.modelContext.registerTool`, and a human approves or declines each one on the page, with an
append-only ledger as the receipt. Built for the WebMCP Challenge. Product name: "Governed Tool Calls".

## Commands

- `npm ci` — install (zero runtime dependencies; everything is a devDependency).
- `npm run dev` — Vite dev server.
- `npm run build` — static site in `dist/`, served from the site root (`base: "/"`).
- `npm run preview` — serve `dist/` on port 4173.
- `npm run typecheck` — `tsc --noEmit` (strict).
- `npm run test` — vitest (happy-dom), dot reporter.
- `npm run e2e` — Puppeteer smoke test against `vite preview`.
- `npm run lint:headers` — every `.ts/.mjs/.css/.html` must carry the SPDX header.
- `npm run check` — typecheck + test + build + lint:headers. Must be green before any push.

## Layout

```
index.html  src/main.ts  src/styles.css
src/webmcp/{register,polyfill,types}.ts     registration, spec-shaped polyfill, types
src/gate/{gate,config,transport-hold,transport-twocall}.ts   the approval gate and its two transports
src/ledger/ledger.ts                        append-only in-memory ledger
src/data/fixture.ts                         the seeded team budget
src/tools/*.ts                              the seven tools
src/ui/{table,card,ledger-view,diagnostics,harness}.ts
tests/*.test.ts  e2e/smoke.mjs  scripts/check-headers.mjs
docs/VERIFICATION.md  SUBMISSION.md  VIDEO-SHOTLIST.md
```

## Where the transport default lives

`src/gate/config.ts` exports `DEFAULT_TRANSPORT` (`"hold"` or `"two-call"`). The URL parameter
`?transport=` overrides it per page load. Flip the constant only if a real WebMCP client is shown to
abandon held `execute` promises.

## Rules

- This repository is standalone. Do not reference other projects, companies, funding, or contest
  strategy anywhere: not in code, comments, docs, commit messages, or pull requests. Do not invent an
  organisation name.
- Licence is AGPL-3.0-or-later. Never modify `LICENSE`. Every `.ts`, `.mjs`, `.css` and `.html` file
  starts with the SPDX header (`SPDX-License-Identifier: AGPL-3.0-or-later`, copyright Andreas
  Krueger, "This file is part of Governed Tool Calls, a WebMCP demo. See LICENSE.").
- README claims must match what is built. Keep the "What this is not" section. Never describe the
  ledger as evidence, signed, or tamper-proof.
- Write the WebMCP code here; do not copy from other demos or polyfills.
- State is in memory by design — do not add persistence, auth, signing, or multi-user.
- `execute` never throws: refusals, validation failures and pending states are resolved JSON values,
  because a rejected promise reaches the agent as an opaque `UnknownError`.
