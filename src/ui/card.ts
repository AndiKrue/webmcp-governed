// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Andreas Krueger
// This file is part of Governed Tool Calls, a WebMCP demo. See LICENSE.

// The approval card. Inline, one per pending proposal, oldest first, each decided independently.
// The gate enforces every rule; the card only reflects them (the Approve button for a sealed
// proposal is disabled until the typed amount matches, but the gate checks again on decide).

import { confirmationMatches, type Gate, type Proposal, type RetryHint } from "../gate/gate";

const RETRY_HINTS: { value: RetryHint; label: string }[] = [
  { value: "different_arguments", label: "different_arguments — the agent may propose again with changed arguments" },
  { value: "not_now", label: "not_now — do not retry in this session" },
  { value: "never", label: "never — do not propose this again" },
];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function mountCards(container: HTMLElement, gate: Gate): { update(): void } {
  const section = el("section", "cards-panel");
  section.id = "cards";
  section.setAttribute("aria-label", "Pending proposals");
  const heading = el("h2", undefined, "Proposals");
  const live = el("div", "visually-hidden");
  live.id = "cards-live";
  live.setAttribute("aria-live", "polite");
  const empty = el("p", "muted empty", "Nothing pending. Gated proposals from the agent appear here.");
  const list = el("div", "cards");
  section.append(heading, live, empty, list);
  container.append(section);

  const nodes = new Map<string, { element: HTMLElement; state: Proposal["state"] }>();

  function receipt(proposal: Proposal): HTMLElement {
    const line = el("div", `receipt receipt-${proposal.state}`);
    line.id = `card-${proposal.id}`;
    line.dataset["state"] = proposal.state;
    const label =
      proposal.state === "approved" ? "Approved" : proposal.state === "declined" ? "Declined" : "Withdrawn by the caller";
    line.append(el("span", "receipt-state", label), el("span", "receipt-effect", ` ${proposal.effect} `));
    const link = el("a", "receipt-link", proposal.id);
    link.href = `#ledger-${proposal.id}`;
    link.setAttribute("aria-label", `Ledger row ${proposal.id}`);
    line.append(link);
    return line;
  }

  function card(proposal: Proposal): HTMLElement {
    const sealed = proposal.tool.class === "sealed";
    const root = el("article", `card card-${proposal.tool.class}`);
    root.id = `card-${proposal.id}`;
    root.tabIndex = -1;
    root.dataset["proposal"] = proposal.id;
    root.setAttribute("aria-labelledby", `card-${proposal.id}-title`);

    const head = el("header", "card-head");
    const title = el("h3", undefined, proposal.tool.title);
    title.id = `card-${proposal.id}-title`;
    head.append(title);
    const tags = el("div", "card-tags");
    tags.append(el("span", `tag tag-${proposal.tool.class}`, proposal.tool.class));
    if (sealed) tags.append(el("span", "tag tag-irreversible", "Irreversible"));
    head.append(tags);

    const effect = el("p", "card-effect", proposal.effect);

    const args = el("dl", "card-args");
    for (const { label, value } of proposal.args) {
      args.append(el("dt", undefined, label), el("dd", undefined, value));
    }
    const raw = el("details", "card-raw");
    raw.append(el("summary", undefined, "Raw arguments"));
    raw.append(el("pre", undefined, JSON.stringify(proposal.input, null, 2)));

    const error = el("p", "card-error");
    error.setAttribute("role", "alert");
    error.hidden = true;

    const actions = el("div", "card-actions");
    const approve = el("button", "btn btn-approve", "Approve");
    approve.type = "button";
    const decline = el("button", "btn btn-outline btn-decline", "Decline");
    decline.type = "button";
    actions.append(approve, decline);

    let confirmInput: HTMLInputElement | null = null;
    if (sealed && proposal.expectedConfirmation !== null) {
      const wrap = el("div", "card-confirm");
      const label = el("label", undefined, `Type the amount (${proposal.expectedConfirmation}) to enable Approve`);
      label.htmlFor = `confirm-${proposal.id}`;
      confirmInput = el("input");
      confirmInput.id = `confirm-${proposal.id}`;
      confirmInput.type = "text";
      confirmInput.inputMode = "decimal";
      confirmInput.autocomplete = "off";
      confirmInput.placeholder = "0.00";
      confirmInput.setAttribute("aria-describedby", `card-${proposal.id}-title`);
      wrap.append(label, confirmInput);
      root.append(head, effect, args, raw, wrap);
      approve.disabled = true;
      confirmInput.addEventListener("input", () => {
        approve.disabled = !confirmationMatches(proposal.expectedConfirmation as string, confirmInput?.value);
        error.hidden = true;
      });
    } else {
      root.append(head, effect, args, raw);
    }

    const declineForm = el("div", "card-decline");
    declineForm.hidden = true;
    const reasonLabel = el("label", undefined, "Reason (optional, the agent will read it)");
    reasonLabel.htmlFor = `reason-${proposal.id}`;
    const reason = el("textarea");
    reason.id = `reason-${proposal.id}`;
    reason.rows = 2;
    const hintLabel = el("label", undefined, "What the agent should do next");
    hintLabel.htmlFor = `hint-${proposal.id}`;
    const hint = el("select");
    hint.id = `hint-${proposal.id}`;
    for (const { value, label } of RETRY_HINTS) {
      const option = el("option", undefined, label);
      option.value = value;
      hint.append(option);
    }
    const confirmDecline = el("button", "btn btn-outline btn-decline-confirm", "Confirm decline");
    confirmDecline.type = "button";
    const cancelDecline = el("button", "btn btn-link", "Back");
    cancelDecline.type = "button";
    const declineActions = el("div", "card-actions");
    declineActions.append(confirmDecline, cancelDecline);
    declineForm.append(reasonLabel, reason, hintLabel, hint, declineActions);

    root.append(error, actions, declineForm);

    approve.addEventListener("click", () => {
      const outcome = gate.decide(proposal.id, "approve", confirmInput ? { confirmation: confirmInput.value } : {});
      if (!outcome.ok) {
        error.textContent = outcome.error;
        error.hidden = false;
      }
    });
    decline.addEventListener("click", () => {
      actions.hidden = true;
      declineForm.hidden = false;
      reason.focus();
    });
    cancelDecline.addEventListener("click", () => {
      declineForm.hidden = true;
      actions.hidden = false;
      decline.focus();
    });
    confirmDecline.addEventListener("click", () => {
      const outcome = gate.decide(proposal.id, "decline", {
        reason: reason.value,
        retry_hint: hint.value as RetryHint,
      });
      if (!outcome.ok) {
        error.textContent = outcome.error;
        error.hidden = false;
      }
    });
    return root;
  }

  function update(): void {
    const proposals = gate.proposals;
    const seen = new Set<string>();
    let announce: Proposal | null = null;
    for (const proposal of proposals) {
      seen.add(proposal.id);
      const existing = nodes.get(proposal.id);
      if (!existing) {
        const element = proposal.state === "pending" ? card(proposal) : receipt(proposal);
        list.append(element);
        nodes.set(proposal.id, { element, state: proposal.state });
        if (proposal.state === "pending") announce = proposal;
      } else if (existing.state !== proposal.state) {
        const element = receipt(proposal);
        existing.element.replaceWith(element);
        nodes.set(proposal.id, { element, state: proposal.state });
      }
    }
    for (const [id, node] of nodes) {
      if (!seen.has(id)) {
        node.element.remove();
        nodes.delete(id);
      }
    }
    const pending = gate.pending.length;
    empty.hidden = pending > 0 || nodes.size > 0;
    heading.textContent = pending > 0 ? `Proposals (${pending} pending)` : "Proposals";
    if (announce) {
      live.textContent = `New proposal from the agent: ${announce.tool.title}. ${announce.effect}`;
      nodes.get(announce.id)?.element.focus();
    }
  }

  gate.subscribe(update);
  update();
  return { update };
}
