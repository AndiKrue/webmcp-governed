// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Andreas Krueger
// This file is part of Ask First, a WebMCP demo. See LICENSE.

import { formatMoney, type Expense, type Store } from "../data/fixture";
import type { GovernedTool } from "../gate/gate";
import { asObject, rejectUnknownKeys } from "./common";

export interface DuplicatePair {
  a: string;
  b: string;
  reason: string;
}

function daysApart(a: string, b: string): number {
  return Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;
}

/** Same member + same amount within 3 days, or same merchant + same amount. */
export function nearDuplicates(expenses: Expense[]): DuplicatePair[] {
  const pairs: DuplicatePair[] = [];
  for (let i = 0; i < expenses.length; i += 1) {
    for (let j = i + 1; j < expenses.length; j += 1) {
      const a = expenses[i]!;
      const b = expenses[j]!;
      if (a.amount !== b.amount) continue;
      const reasons: string[] = [];
      const gap = daysApart(a.date, b.date);
      if (a.member === b.member && gap <= 3) {
        reasons.push(`same member (${a.member}), same amount (${formatMoney(a.amount)}), ${gap} day(s) apart`);
      }
      if (a.merchant === b.merchant) {
        reasons.push(`same merchant (${a.merchant}) and amount (${formatMoney(a.amount)}), submitted by ${a.member} and ${b.member}`);
      }
      if (reasons.length) pairs.push({ a: a.id, b: b.id, reason: reasons.join("; ") });
    }
  }
  return pairs;
}

export function findDuplicatesTool(store: Store): GovernedTool<Record<string, never>> {
  return {
    name: "find_duplicates",
    title: "Find duplicates",
    class: "open",
    summary: "Find pairs of expenses that look like duplicate submissions (same member and amount within three days, or same merchant and amount).",
    returns: '{status:"ok", pairs:[{a, b, reason}]} where a and b are expense ids',
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    validate(input) {
      const errors: string[] = [];
      rejectUnknownKeys(asObject(input), [], errors);
      return errors.length ? { ok: false, errors } : { ok: true, value: {} };
    },
    effect: () => "Find duplicate submissions",
    run() {
      return { status: "ok", pairs: nearDuplicates(store.expenses) };
    },
    outcome: (result) => `${(result.pairs as DuplicatePair[]).length} candidate pair(s)`,
  };
}
