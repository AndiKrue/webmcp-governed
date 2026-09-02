// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Andreas Krueger
// This file is part of Governed Tool Calls, a WebMCP demo. See LICENSE.

import { CATEGORIES, type Category, type Expense, type Store } from "../data/fixture";
import type { GovernedTool } from "../gate/gate";
import { asObject, copy, expenseLabel, rejectUnknownKeys, requiredCategory, requiredExpense, requiredString } from "./common";

export interface CategoriseInput {
  expense_id: string;
  category: Category;
}

export function categoriseExpenseTool(store: Store): GovernedTool<CategoriseInput> {
  return {
    name: "categorise_expense",
    title: "Categorise expense",
    class: "gated",
    summary: "Assign a category to an expense.",
    why: "This changes another person's record",
    returns: '{status:"ok", expense}',
    inputSchema: {
      type: "object",
      properties: {
        expense_id: { type: "string", description: "The expense to categorise, e.g. E-007." },
        category: { type: "string", description: "The category to assign.", enum: [...CATEGORIES] },
      },
      required: ["expense_id", "category"],
      additionalProperties: false,
    },
    validate(input) {
      const fields = asObject(input);
      const errors: string[] = [];
      rejectUnknownKeys(fields, ["expense_id", "category"], errors);
      const id = requiredString(fields, "expense_id", errors);
      const category = requiredCategory(fields, "category", errors);
      const expense = requiredExpense(store, id, errors);
      if (expense?.status === "paid") errors.push(`${expense.id} is paid and can no longer be changed`);
      if (expense && expense.category === category) errors.push(`${expense.id} is already categorised as ${category}`);
      return errors.length || !expense || !category
        ? { ok: false, errors }
        : { ok: true, value: { expense_id: expense.id, category } };
    },
    effect(input) {
      const expense = store.expense(input.expense_id) as Expense;
      return `Set category of ${expenseLabel(expense)} to ${input.category}`;
    },
    args: (input) => [
      { label: "Expense", value: input.expense_id },
      { label: "Category", value: input.category },
    ],
    run(input) {
      const expense = store.expense(input.expense_id) as Expense;
      expense.category = input.category;
      store.notify();
      return { status: "ok", expense: copy(expense) };
    },
  };
}
