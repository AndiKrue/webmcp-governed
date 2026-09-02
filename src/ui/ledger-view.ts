// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Andreas Krueger
// This file is part of Governed Tool Calls, a WebMCP demo. See LICENSE.

import type { Ledger, LedgerRow } from "../ledger/ledger";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function exportFilename(date = new Date()): string {
  return `ledger-${date.toISOString().replace(/[:.]/g, "-")}.json`;
}

function decisionLabel(row: LedgerRow): string {
  switch (row.decision) {
    case "executed":
      return "executed";
    case "approved":
      return "approved";
    case "declined":
      return "declined";
    case "cancelled_by_caller":
      return "cancelled by caller";
    case "invalid":
      return "invalid";
  }
}

export function mountLedgerView(container: HTMLElement, ledger: Ledger): { update(): void } {
  const section = el("section", "ledger-panel");
  section.id = "ledger";
  section.setAttribute("aria-label", "Ledger");
  const head = el("div", "ledger-head");
  const heading = el("h2", undefined, "Ledger (0 rows)");
  const exportButton = el("button", "btn btn-outline btn-export", "Export JSON");
  exportButton.type = "button";
  head.append(heading, exportButton);
  const note = el("p", "muted", "Append-only, in memory, newest first. Not signed: a log, not evidence.");
  const list = el("ol", "ledger-rows");
  list.reversed = true;
  section.append(head, note, list);
  container.append(section);

  exportButton.addEventListener("click", () => {
    const blob = new Blob([ledger.export()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = exportFilename();
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  function render(row: LedgerRow): HTMLElement {
    const li = el("li", `ledger-row decision-${row.decision}`);
    li.id = `ledger-${row.id}`;
    li.dataset["id"] = row.id;
    li.dataset["decision"] = row.decision;
    const top = el("div", "ledger-top");
    top.append(
      el("span", "mono", row.id),
      el("span", `pill pill-${row.decision}`, decisionLabel(row)),
      el("span", "ledger-title", row.title),
      el("span", `tag tag-${row.tool_class}`, row.tool_class),
    );
    const meta = el("div", "ledger-meta muted");
    meta.textContent = `${row.ts_decided.replace("T", " ").slice(0, 19)} · ${row.decider} · ${row.latency_ms} ms · ${row.transport} · ${row.api}`;
    const outcome = el("div", "ledger-outcome", row.effect ?? row.outcome);
    li.append(top, meta, outcome);
    if (row.effect && row.outcome) li.append(el("div", "ledger-outcome muted", row.outcome));
    if (row.reason) li.append(el("div", "ledger-reason", `Reason: ${row.reason}`));
    if (row.retry_hint) li.append(el("div", "muted", `retry_hint: ${row.retry_hint}`));
    const raw = el("details", "ledger-raw");
    raw.append(el("summary", undefined, "Row JSON"), el("pre", undefined, JSON.stringify(row, null, 2)));
    li.append(raw);
    return li;
  }

  function update(): void {
    heading.textContent = `Ledger (${ledger.size} row${ledger.size === 1 ? "" : "s"})`;
    list.replaceChildren(...[...ledger.rows].reverse().map(render));
  }

  ledger.subscribe(update);
  update();
  return { update };
}
