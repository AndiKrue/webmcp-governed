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
npm install
npm run dev
```

Then open the local URL in a browser with WebMCP:

- **ChatGPT desktop app** — the in-app browser supports WebMCP by default.
- **Chrome 149+** — enable `chrome://flags/#enable-webmcp-testing` and restart.

Ask the agent to list this month's expenses. Then ask it to pay one.

## How it is implemented

Tools are registered on load:

```js
document.modelContext.registerTool({
  name: "search_products",
  description: "Search the product catalog",
  inputSchema: { /* ... */ },
  execute: async (input) => { /* ... */ }
});
```

Gated tools wrap `execute` in a proposal. The returned promise does not resolve until a human decides.
On approval it resolves with the real result; on refusal it resolves with a structured decline.

The gate is a single function each tool calls. The ledger is append-only and lives in memory.

## What this is not

**Not persistent.** State resets on reload. The fixture reseeds. This is deliberate for a demo and
removes an entire class of failure during judging.

**Not signed.** A production version would sign each receipt so the ledger is evidence rather than a
log. That is the right answer and it is not built here.

**Not multi-user.** The shared team budget is fiction in the fixture, not multi-tenancy in the code.

**Not authenticated.** The app is open. Adding auth would add a failure mode without demonstrating
anything about the mechanism.

**Not a permission dialog.** Browsers have those and they are dismissed reflexively, because they are
generic. These carry the actual arguments — this amount, this recipient, this record.

## What production would need

Signed receipts. Persistence with an audit trail that survives the session. A policy layer so classes
are configurable per deployment rather than declared in code. Multi-party approval for actions above a
threshold. And a way for the agent to request a class change and be refused.

None of that changes the mechanism this demonstrates.

## Licence

GNU Affero General Public License v3.0. See [LICENSE](LICENSE).

If you run a modified version of this as a network service, the AGPL requires you to publish your source.
