# Video shot list — under three minutes, screen and voice only

No slides. One browser window with the deployed page open in the ChatGPT desktop app's built-in
browser (or Chrome 149+ with `chrome://flags/#enable-webmcp-testing` and an agent attached), the
conversation visible beside it.

## Pre-flight

- Open the bare production URL (no `?console=1`, no `?transport=`). The header badge must read
  **native WebMCP** and **transport: hold**.
- Click **Reset to fixture**. The ledger heading must read "Ledger (0 rows)".
- Window size 1440×900 or larger, page zoom 110% so the card text is readable in the recording.
- Check the browser's "Site tools" panel: three read tools, four write tools.
- Have the amount **340.00** in your head; you will type it in shot 4.

## Shots

| # | Prompt to type | What appears on screen | What to say | Seconds |
|---|---|---|---|---|
| 1 | *List this month's uncategorised expenses.* | The agent calls `list_expenses`; three rows come back; no card; the ledger gains one `executed` row, decider `policy:open`. | "Read tools just run. Nothing to approve, and the ledger still records it." | 20 |
| 2 | *Categorise E-020 as travel.* | An amber-edged card: "Set category of E-020 (Parking near the venue, 15.00 EUR) to travel". Click **Approve**. The table row updates, the card collapses into a receipt, the agent reports success. | "A write tool does not execute. It proposes. The page holds the call until I decide." | 25 |
| 3 | *Categorise the Notion subscription as meals.* | A card for E-007 → meals. Click **Decline**, type the reason "Notion is software", leave `different_arguments`, confirm. The agent receives a structured refusal, reads the reason, and proposes E-007 → software. Approve that one. | "This is the shot that matters. The agent was told no, in a value it can reason about, and it came back with a better proposal instead of failing." | 45 |
| 4 | *Pay draft D-001. Then pay draft D-002.* | The browser may show its own generic confirmation first: accept it. Then the page's heavier **sealed** card: "Pay 340.00 EUR to Contractor X for draft D-001 (invoice 2026-114). Irreversible." Approve is disabled; type `340` and it enables; approve. Draft and expense turn `paid`. The second card for D-002 (the personal purchase): Decline, reason "personal purchase", hint `never`. | "The browser's prompt is generic. This card carries the amount, the payee and the invoice, and it makes me type the amount. The second draft must not be paid, and the agent is told never to ask again." | 45 |
| 5 | — | Two-second pan down the ledger: executed, approved, declined, approved, approved, declined. Click **Export JSON**; the download appears. | "Every proposal and every decision, with who decided and how long it took. Exportable. Not signed, and the README says so." | 15 |

Total speaking time about 150 seconds, leaving room for the agent's own replies.

## Decision rule (before recording)

Run shots 1–4 once as a rehearsal and read the ledger. If a gated call is abandoned before you decide
(a `cancelled_by_caller` row appears, or the agent reports the call failed while the card is still
up), the client does not hold `execute` promises open. Then:

1. set `DEFAULT_TRANSPORT = "two-call"` in `src/gate/config.ts`,
2. redeploy,
3. record the two-call variant of shots 2–4: the agent's first call returns `pending_approval` with a
   token, the card is identical, and after you decide the agent calls `commit_approved_action` and
   receives the same result or refusal. Say, once: "This client returns at once, so the page hands
   the agent a token and it commits after I decide. Same card, same ledger."
