# Governed Tool Calls

**A WebMCP demo where an agent proposes consequential actions and a human approves them, one at a
time, with a receipt.**

Built for the [WebMCP Challenge](https://webmcp.devpost.com/), August-September 2026.

**Live:** *(URL)*
**Video:** *(URL)*

---

## The problem

Delegating a task to an agent is currently all-or-nothing. You grant it a session and it decides what
to do within that session, or you grant nothing and it can only read.

There is no middle. No way to say *yes to this, not to that* at the moment the action is proposed,
with a record of who decided what.

That middle is exactly what a page can provide, because WebMCP puts the tool implementation on the
page — where the human already is.

## What this does

Seven tools are registered through `document.modelContext.registerTool`. Each declares a class:

**`open`** — executes immediately. Listing expenses, finding duplicates, summarising a month. No
friction, because none is warranted.

**`gated`** — proposes. The tool does not execute. An approval card appears with the tool, its
arguments, and a one-line statement of what will happen. The human approves or declines, optionally
with a reason.

**`sealed`** — proposes with a stronger confirmation. One action in this demo is irreversible; it is
treated as such.

The class belongs to the tool, not to the caller. An agent cannot escalate by asking differently.

## What happens when you decline

The call returns a structured refusal, not an error. It carries the reason and whether re-proposing
with different arguments is worth trying.

This matters more than the approval path. An agent that is told *no* and continues sensibly is the
thing that makes delegation safe; an agent that treats refusal as failure is not usable this way.

## The receipt

Every proposal and every decision is appended to a ledger: timestamp, tool, arguments, class,
decision, decider, reason, outcome.

Rendered beside the conversation, exportable as JSON.

Not *"the agent had access from 14:00 to 15:00"* but *"the agent proposed eleven actions, eight were
approved, and here is each one."*

## Why WebMCP specifically

Three properties, none of which exist elsewhere.

**The page owns the tool.** `registerTool` means the site author writes `execute`. The gate is not
middleware bolted on top — it is the implementation.

**The human and the agent share a surface.** The approval card renders next to the conversation. No
notification, no second device, no context switch.

**Refusals are structured.** The agent receives a value it can reason about, in the same channel it
called through.

Server-side MCP cannot do this. An approval would have to reach a human who is somewhere else, through
a channel that does not exist.

## Running it

```
npm ci
npm run dev
```

Then open the local URL in a browser with WebMCP:

- **ChatGPT desktop app** — the in-app browser supports WebMCP by default. The address bar's "Site
  tools" panel lists the seven tools, three read and four write.
- **Chrome 149+** — enable `chrome://flags/#enable-webmcp-testing` and restart.

Ask the agent to list this month's uncategorised expenses. Then ask it to categorise one, decline it
with a reason, and watch it come back. Then ask it to pay draft D-001.

Without an agent the page installs its own small `document.modelContext` (the header badge says
*polyfill — no agent attached*) so everything still runs. Feature detection is per method: a browser
that provides only part of the surface keeps what it has and gets the rest added (the badge then says
*native WebMCP (partial, completed by the page)*). Add `?harness=1` to get a form that calls
tools the way an agent would. Add `?transport=two-call` to try the fallback transport (the default is
`hold`; the constant lives in `src/gate/config.ts`). Add `?nopolyfill=1` to see what the browser
provides on its own.

```
npm run check   # typecheck, unit tests, build, licence headers
npm run e2e     # headless Chrome through document.modelContext, both transports
```

`npm run build` writes a static `dist/` that serves from the site root.

## How it is implemented

Tools are registered on load, one call each, in `src/webmcp/register.ts`:

```ts
await document.modelContext.registerTool({
  name: tool.name,
  title: tool.title,
  description: tool.description,
  inputSchema: tool.inputSchema,
  annotations: tool.annotations,
  execute: tool.execute,
}, { signal: controller.signal });
```

`execute` is the gate's wrapper (`src/gate/gate.ts`). The class — `open`, `gated`, `sealed` — is a
property of the tool definition. The gate reads it from there, never from the input.

**Two transports.** In `hold`, the default, a gated `execute` returns a promise that does not resolve
until a human decides on the card. On approval it resolves with the real result; on refusal with the
structured decline. The spec defines no timeout for `execute`, so this is conformant, and it is the
simplest thing that can work: one call, one answer. In `two-call`, for clients that will not hold a
call open, `execute` resolves at once with `{status:"pending_approval", approval_token}` and an
eighth tool, `commit_approved_action`, returns the result or the refusal once the human has decided.
Tokens are single-use. The card and the ledger are identical in both. `?transport=` selects one per
page load; `DEFAULT_TRANSPORT` in `src/gate/config.ts` is the one constant to flip if a real client
abandons held calls.

**`readOnlyHint`.** The three open tools declare `annotations: { readOnlyHint: true }`, so a client
can show them as read tools and call them without ceremony. The four write tools do not.

**Structured refusals.** Every result is a resolved plain-JSON value: `{status:"ok", …}`,
`{status:"declined", reason, retry_hint}`, `{status:"invalid", errors}`. Nothing throws out of
`execute`, because a rejected promise reaches the caller as an opaque `"UnknownError"` DOMException
and the reason would be lost. Each result carries a `receipt_id`, the ledger row it belongs to.

**`signal`.** `execute` receives `options.signal`. If the caller aborts while a card is up, the ledger
records `cancelled_by_caller`, the card is withdrawn, and the promise resolves anyway.

**Sealed confirmation.** For `pay_reimbursement` the human types the amount. The gate checks it
(`decide(id, "approve", { confirmation })` refuses a wrong value); the button state only reflects it.

The ledger is append-only and lives in memory. `latency_ms` on each row (proposal to decision) and
any `cancelled_by_caller` rows are how you can tell, from any client, whether it held the call open.

## Verification status

See [docs/VERIFICATION.md](docs/VERIFICATION.md): unit tests, an end-to-end run through
`document.modelContext.executeTool` in headless Chrome for Testing 148 in both transports, and a
probe of that build's own API (`navigator.modelContext` with `registerTool` only; the page aliases it
and adds the missing methods per feature detection). Chrome 150 with the flag provides the complete
`document.modelContext` and registered the tools natively. The ChatGPT in-app browser remains to be
tried on the deployed URL.

## What this is not

**Not persistent.** State resets on reload. The fixture reseeds. This is deliberate for a demo and
removes an entire class of failure during judging.

**Not signed.** A production version would sign each receipt so the ledger is evidence rather than a
log. That is the right answer and it is not built here.

**Not multi-user.** The shared team budget is fiction in the fixture, not multi-tenancy in the code.

**Not authenticated.** The app is open. Adding auth would add a failure mode without demonstrating
anything about the mechanism.

**Not a permission dialog.** Browsers have those and they are dismissed reflexively, because they are
generic. These carry the actual arguments — this amount, this recipient, this record. The two are
different layers: a browser such as ChatGPT's may show its own generic prompt before `execute` runs
at all; the page's card appears after, inside the tool, with the arguments on it. Both can happen for
the same payment, and the ledger records only the page's decision.

## What production would need

Signed receipts. Persistence with an audit trail that survives the session. A policy layer so classes
are configurable per deployment rather than declared in code. Multi-party approval for actions above a
threshold. And a way for the agent to request a class change and be refused.

None of that changes the mechanism this demonstrates.

## Licence

GNU Affero General Public License v3.0. See [LICENSE](LICENSE).

If you run a modified version of this as a network service, the AGPL requires you to publish your source.
