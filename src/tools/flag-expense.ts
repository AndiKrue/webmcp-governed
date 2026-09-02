// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Andreas Krueger
// This file is part of Ask First, a WebMCP demo. See LICENSE.

import { sumAmounts, type Expense, type Store } from "../data/fixture";
import type { GovernedTool } from "../gate/gate";
import { asObject, copy, expenseLabel, rejectUnknownKeys, requiredExpense, requiredString } from "./common";

export interface FlagInput {
  expense_id: string;
  reason: string;
}

export function flagExpenseTool(store: Store): GovernedTool<FlagInput> {
  return {
    name: "flag_expense",
    title: "Flag expense",
    class: "gated",
    summary: "Flag an expense for review, with a reason.",
    why: "This puts a hold on someone's reimbursement",
    reversal: "Cost of reversal: low. Nothing leaves the budget; the flag only holds the expense back.",
    returns: '{status:"ok", expense}',
    inputSchema: {
      type: "object",
      properties: {
        expense_id: { type: "string", description: "The expense to flag, e.g. E-014." },
        reason: { type: "string", description: "Why it needs review, shown to the team. Must not be empty.", minLength: 1 },
      },
      required: ["expense_id", "reason"],
      additionalProperties: false,
    },
    validate(input) {
      const fields = asObject(input);
      const errors: string[] = [];
      rejectUnknownKeys(fields, ["expense_id", "reason"], errors);
      const id = requiredString(fields, "expense_id", errors);
      const reason = requiredString(fields, "reason", errors);
      const expense = requiredExpense(store, id, errors);
      if (expense?.status === "flagged") errors.push(`${expense.id} is already flagged: ${expense.flag_reason ?? ""}`.trim());
      if (expense?.status === "paid") errors.push(`${expense.id} is paid and can no longer be flagged`);
      return errors.length || !expense ? { ok: false, errors } : { ok: true, value: { expense_id: expense.id, reason } };
    },
    effect(input) {
      const expense = store.expense(input.expense_id) as Expense;
      return `Flag ${expenseLabel(expense)} for review: "${input.reason}"`;
    },
    args: (input) => [
      { label: "Expense", value: input.expense_id },
      { label: "Reason", value: input.reason },
    ],
    run(input) {
      const expense = store.expense(input.expense_id) as Expense;
      if (expense.status === "in_draft" && expense.draft_id) {
        // A flagged expense leaves its draft; the draft shrinks accordingly.
        const draft = store.draft(expense.draft_id);
        if (draft && draft.status === "draft") {
          draft.expense_ids = draft.expense_ids.filter((id) => id !== expense.id);
          draft.amount = sumAmounts(draft.expense_ids.map((id) => store.expense(id)?.amount ?? "0.00"));
        }
        delete expense.draft_id;
      }
      expense.status = "flagged";
      expense.flag_reason = input.reason;
      store.notify();
      return { status: "ok", expense: copy(expense) };
    },
  };
}
