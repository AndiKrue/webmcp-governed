// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Andreas Krueger
// This file is part of Governed Tool Calls, a WebMCP demo. See LICENSE.

import { CATEGORIES, MEMBERS, STATUSES, findMember, type Category, type ExpenseStatus, type Member, type Store } from "../data/fixture";
import type { GovernedTool } from "../gate/gate";
import { asObject, copy, isMonth, monthSchema, optionalString, rejectUnknownKeys } from "./common";

export interface ListInput {
  member?: Member;
  month?: string;
  category?: Category | "uncategorised";
  status?: ExpenseStatus;
}

export function listExpensesTool(store: Store): GovernedTool<ListInput> {
  return {
    name: "list_expenses",
    title: "List expenses",
    class: "open",
    summary: "List the team's expenses, optionally filtered by member, month, category or status.",
    returns: '{status:"ok", count, expenses}',
    inputSchema: {
      type: "object",
      properties: {
        member: { type: "string", description: `Only this member's expenses. One of ${MEMBERS.join(", ")}.`, enum: [...MEMBERS] },
        month: monthSchema("Only expenses dated in this month, formatted YYYY-MM, e.g. 2026-08."),
        category: {
          type: "string",
          description: 'Only this category, or "uncategorised" for expenses without one.',
          enum: [...CATEGORIES, "uncategorised"],
        },
        status: { type: "string", description: `Only expenses in this status. One of ${STATUSES.join(", ")}.`, enum: [...STATUSES] },
      },
      additionalProperties: false,
    },
    validate(input) {
      const fields = asObject(input);
      const errors: string[] = [];
      rejectUnknownKeys(fields, ["member", "month", "category", "status"], errors);
      const value: ListInput = {};
      const member = optionalString(fields, "member", errors);
      if (member !== undefined) {
        const found = findMember(member);
        if (!found) errors.push(`unknown member ${member}; members are ${MEMBERS.join(", ")}`);
        else value.member = found;
      }
      const month = optionalString(fields, "month", errors);
      if (month !== undefined) {
        if (!isMonth(month)) errors.push("month must be formatted YYYY-MM");
        else value.month = month;
      }
      const category = optionalString(fields, "category", errors);
      if (category !== undefined) {
        const lower = category.toLowerCase();
        if (lower === "uncategorised" || lower === "uncategorized") value.category = "uncategorised";
        else if ((CATEGORIES as readonly string[]).includes(lower)) value.category = lower as Category;
        else errors.push(`category must be one of ${CATEGORIES.join(", ")} or "uncategorised"`);
      }
      const status = optionalString(fields, "status", errors);
      if (status !== undefined) {
        if (!(STATUSES as readonly string[]).includes(status)) errors.push(`status must be one of ${STATUSES.join(", ")}`);
        else value.status = status as ExpenseStatus;
      }
      return errors.length ? { ok: false, errors } : { ok: true, value };
    },
    effect(input) {
      const parts = Object.entries(input).map(([k, v]) => `${k}=${v}`);
      return `List expenses${parts.length ? ` (${parts.join(", ")})` : ""}`;
    },
    run(input) {
      const expenses = store.expenses.filter((expense) => {
        if (input.member && expense.member !== input.member) return false;
        if (input.month && !expense.date.startsWith(`${input.month}-`)) return false;
        if (input.category === "uncategorised" && expense.category !== null) return false;
        if (input.category && input.category !== "uncategorised" && expense.category !== input.category) return false;
        if (input.status && expense.status !== input.status) return false;
        return true;
      });
      return { status: "ok", count: expenses.length, expenses: copy(expenses) };
    },
    outcome: (result) => `${String(result.count)} expenses listed`,
  };
}
