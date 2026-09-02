// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Andreas Krueger
// This file is part of Ask First, a WebMCP demo. See LICENSE.

import { FIXTURE_MONTH, formatMoney, sumAmounts, type Store } from "../data/fixture";
import type { GovernedTool } from "../gate/gate";
import { asObject, isMonth, monthSchema, optionalString, rejectUnknownKeys } from "./common";

export interface SummariseInput {
  month: string;
}

export function summariseMonthTool(store: Store): GovernedTool<SummariseInput> {
  return {
    name: "summarise_month",
    title: "Summarise month",
    class: "open",
    summary: "Total a month's expenses by category and by member, and count the uncategorised ones.",
    returns: '{status:"ok", month, total, by_category, by_member, uncategorised_count}',
    inputSchema: {
      type: "object",
      properties: { month: monthSchema(`The month to summarise, formatted YYYY-MM. Defaults to ${FIXTURE_MONTH}.`) },
      additionalProperties: false,
    },
    validate(input) {
      const fields = asObject(input);
      const errors: string[] = [];
      rejectUnknownKeys(fields, ["month"], errors);
      const month = optionalString(fields, "month", errors) ?? FIXTURE_MONTH;
      if (!isMonth(month)) errors.push("month must be formatted YYYY-MM");
      return errors.length ? { ok: false, errors } : { ok: true, value: { month } };
    },
    effect: (input) => `Summarise ${input.month}`,
    run(input) {
      const expenses = store.expenses.filter((e) => e.date.startsWith(`${input.month}-`));
      const by_category: Record<string, string> = {};
      const by_member: Record<string, string> = {};
      const groups = (key: (e: (typeof expenses)[number]) => string, into: Record<string, string>) => {
        const buckets = new Map<string, string[]>();
        for (const e of expenses) {
          const k = key(e);
          buckets.set(k, [...(buckets.get(k) ?? []), e.amount]);
        }
        for (const [k, amounts] of [...buckets].sort()) into[k] = sumAmounts(amounts);
      };
      groups((e) => e.category ?? "uncategorised", by_category);
      groups((e) => e.member, by_member);
      return {
        status: "ok",
        month: input.month,
        currency: "EUR",
        total: sumAmounts(expenses.map((e) => e.amount)),
        by_category,
        by_member,
        uncategorised_count: expenses.filter((e) => e.category === null).length,
      };
    },
    outcome: (result) => `${String(result.month)} totals ${formatMoney(String(result.total))}`,
  };
}
