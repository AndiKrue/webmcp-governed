// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Andreas Krueger
// This file is part of Governed Tool Calls, a WebMCP demo. See LICENSE.

import { formatMoney, type Store } from "../data/fixture";

function cell(text: string, className?: string): HTMLTableCellElement {
  const td = document.createElement("td");
  td.textContent = text;
  if (className) td.className = className;
  return td;
}

export function mountTable(container: HTMLElement, store: Store): { update(): void } {
  const section = document.createElement("section");
  section.className = "panel";
  const heading = document.createElement("h2");
  heading.textContent = "Team budget, August 2026";
  const intro = document.createElement("p");
  intro.className = "muted";
  intro.textContent = "Four members, one shared budget. The agent reads freely; anything that changes a row below needs a decision on the right.";
  const wrap = document.createElement("div");
  wrap.className = "table-wrap";
  const table = document.createElement("table");
  table.className = "expenses";
  table.id = "expenses";
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const label of ["ID", "Member", "Date", "Merchant", "Description", "Amount", "Category", "Status"]) {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = label;
    headRow.append(th);
  }
  thead.append(headRow);
  const tbody = document.createElement("tbody");
  table.append(thead, tbody);
  wrap.append(table);

  const draftsHeading = document.createElement("h3");
  draftsHeading.textContent = "Reimbursement drafts";
  const drafts = document.createElement("ul");
  drafts.className = "drafts";
  drafts.id = "drafts";
  section.append(heading, intro, wrap, draftsHeading, drafts);
  container.append(section);

  function update(): void {
    tbody.replaceChildren();
    for (const e of store.expenses) {
      const tr = document.createElement("tr");
      tr.dataset["id"] = e.id;
      tr.className = `status-${e.status}`;
      tr.append(
        cell(e.id, "mono"),
        cell(e.member),
        cell(e.date, "mono"),
        cell(e.merchant),
        cell(e.description),
        cell(formatMoney(e.amount), "amount"),
        cell(e.category ?? "—", e.category ? "" : "uncategorised"),
      );
      const status = cell("", "status");
      const pill = document.createElement("span");
      pill.className = `pill pill-${e.status}`;
      pill.textContent = e.status === "in_draft" ? `in draft ${e.draft_id ?? ""}`.trim() : e.status;
      if (e.status === "flagged" && e.flag_reason) pill.title = e.flag_reason;
      status.append(pill);
      if (e.status === "flagged" && e.flag_reason) {
        const why = document.createElement("span");
        why.className = "muted";
        why.textContent = ` ${e.flag_reason}`;
        status.append(why);
      }
      tr.append(status);
      tbody.append(tr);
    }
    drafts.replaceChildren();
    for (const d of store.drafts) {
      const li = document.createElement("li");
      li.dataset["id"] = d.draft_id;
      li.className = `draft draft-${d.status}`;
      const head = document.createElement("div");
      head.className = "draft-head";
      const id = document.createElement("span");
      id.className = "mono";
      id.textContent = d.draft_id;
      const text = document.createElement("span");
      text.textContent = ` ${formatMoney(d.amount)} to ${d.payee}, covering ${d.expense_ids.join(", ") || "nothing"}`;
      const pill = document.createElement("span");
      pill.className = `pill pill-${d.status}`;
      pill.textContent = d.status;
      head.append(id, text, pill);
      li.append(head);
      if (d.note) {
        const note = document.createElement("div");
        note.className = "muted";
        note.textContent = d.note;
        li.append(note);
      }
      drafts.append(li);
    }
  }

  store.subscribe(update);
  update();
  return { update };
}
