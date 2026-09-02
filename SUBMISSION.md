# Submission text

## Why this use case fits WebMCP

An agent working a shared team budget changes colleagues' records and moves money. Today the choice
is a blanket session grant or read-only. WebMCP
puts the tool implementation on the page, where the human already is: the page that registers
`pay_reimbursement` can decline to execute it, and the person who should decide is looking at it.
Server-side MCP cannot: the approval would have to reach a human somewhere else.

## How it improves the experience

Seven tools, one gate. Read tools run at once and declare `readOnlyHint`. Write tools do not execute:
an inline card shows the tool, its arguments and one line saying what will happen. The human approves
or declines, with a reason; the one irreversible tool requires typing the amount. That is the middle
between a session grant and no delegation: yes to this, not to that.

## What people and agents can do together

Per-action authority with a receipt. The agent proposes, the human decides, and an append-only ledger
records each proposal, decision, decider, reason and latency, exportable as JSON. Delegate spending
without delegating the wallet. The novelty is the refusal: a declined call resolves
`{status:"declined", reason, retry_hint}`, and the agent re-proposes with different arguments or stops.

## How WebMCP was implemented

Every tool is registered with `document.modelContext.registerTool`. The gate wraps `execute`: gated
and sealed tools become a proposal whose promise is held until the human decides, then resolves with
the real result or the structured refusal. Refusals are resolved values because a rejected promise
reaches the caller as an opaque `UnknownError`. `options.signal` is honoured: an aborting caller gets
a `cancelled_by_caller` row and the card is withdrawn. A two-call transport (token plus
`commit_approved_action`) covers clients that will not hold a call open. The explainer lists
user prompting and elicitation as an open question (issues #165, #50); this demo is a page-level
answer using only the existing primitive, a held `execute` promise.

## Deliberately not built

No persistence, authentication, multi-user or signed receipts: the ledger is a log, not evidence. The mechanism is the demo.
