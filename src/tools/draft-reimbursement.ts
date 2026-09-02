// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Andreas Krueger
// This file is part of Ask First, a WebMCP demo. See LICENSE.

import { MEMBERS, findMember, formatMoney, sumAmounts, type Draft, type Member, type Store } from "../data/fixture";
import type { GovernedTool } from "../gate/gate";
import { asObject, copy, rejectUnknownKeys, requiredString } from "./common";

export interface DraftInput {
  payee: Member;
  expense_ids: string[];
}

export function draftReimbursementTool(store: Store): GovernedTool<DraftInput> {
  return {
    name: "draft_reimbursement",
    title: "Draft reimbursement",
    class: "gated",
    summary: "Create a payable reimbursement draft for a member from their submitted, categorised expenses.",
    why: "This prepares money to leave the budget",
    reversal: "Cost of reversal: medium. The draft is payable, but no money moves until it is paid.",
    returns: '{status:"ok", draft}',
    inputSchema: {
      type: "object",
      properties: {
        payee: { type: "string", description: `The member to reimburse. One of ${MEMBERS.join(", ")}.`, enum: [...MEMBERS] },
        expense_ids: {
          type: "array",
          description: "The expenses to include. Each must belong to the payee, be categorised, and be in status submitted.",
          items: { type: "string", description: "An expense id, e.g. E-002." },
          minItems: 1,
        },
      },
      required: ["payee", "expense_ids"],
      additionalProperties: false,
    },
    validate(input) {
      const fields = asObject(input);
      const errors: string[] = [];
      rejectUnknownKeys(fields, ["payee", "expense_ids"], errors);
      const payeeRaw = requiredString(fields, "payee", errors);
      const payee = findMember(payeeRaw);
      if (payeeRaw && !payee) errors.push(`unknown payee ${payeeRaw}; members are ${MEMBERS.join(", ")}`);
      const ids = fields["expense_ids"];
      if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => typeof id === "string")) {
        errors.push("expense_ids must be a non-empty array of expense ids");
      } else {
        const unique = [...new Set(ids as string[])];
        for (const id of unique) {
          const expense = store.expense(id);
          if (!expense) {
            errors.push(`unknown expense ${id}`);
            continue;
          }
          if (payee && expense.member !== payee) errors.push(`${id} belongs to ${expense.member}, not ${payee}`);
          if (expense.category === null) errors.push(`${id} is uncategorised`);
          if (expense.status === "flagged") errors.push(`${id} is flagged: ${expense.flag_reason ?? ""}`.trim());
          if (expense.status === "in_draft") errors.push(`${id} is already in draft ${expense.draft_id ?? ""}`.trim());
          if (expense.status === "paid") errors.push(`${id} is already paid`);
        }
        if (!errors.length && payee) return { ok: true, value: { payee, expense_ids: unique } };
      }
      return { ok: false, errors };
    },
    effect(input) {
      const total = sumAmounts(input.expense_ids.map((id) => store.expense(id)?.amount ?? "0.00"));
      const n = input.expense_ids.length;
      return `Create a payable draft of ${formatMoney(total)} for ${input.payee} covering ${n} expense${n === 1 ? "" : "s"} (${input.expense_ids.join(", ")})`;
    },
    args: (input) => [
      { label: "Payee", value: input.payee },
      { label: "Expenses", value: input.expense_ids.join(", ") },
      { label: "Total", value: formatMoney(sumAmounts(input.expense_ids.map((id) => store.expense(id)?.amount ?? "0.00"))) },
    ],
    run(input) {
      const draft: Draft = {
        draft_id: store.nextDraftId(),
        payee: input.payee,
        amount: sumAmounts(input.expense_ids.map((id) => store.expense(id)?.amount ?? "0.00")),
        currency: "EUR",
        expense_ids: [...input.expense_ids],
        status: "draft",
      };
      store.drafts.push(draft);
      for (const id of input.expense_ids) {
        const expense = store.expense(id);
        if (expense) {
          expense.status = "in_draft";
          expense.draft_id = draft.draft_id;
        }
      }
      store.notify();
      return { status: "ok", draft: copy(draft) };
    },
    outcome: (result) => {
      const draft = result.draft as Draft;
      return `${draft.draft_id}: ${formatMoney(draft.amount)} for ${draft.payee}`;
    },
  };
}
