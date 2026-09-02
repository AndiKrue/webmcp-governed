// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Andreas Krueger
// This file is part of Ask First, a WebMCP demo. See LICENSE.

import { describe, expect, it } from "vitest";
import { MEMBERS, Store, seedDrafts, seedExpenses, sumAmounts, toCents } from "../src/data/fixture";
import { nearDuplicates } from "../src/tools/find-duplicates";

describe("fixture", () => {
  const expenses = seedExpenses();
  const drafts = seedDrafts();

  it("has 24–30 expenses across exactly 4 members, all in 2026-08, amounts with two places", () => {
    expect(expenses.length).toBeGreaterThanOrEqual(24);
    expect(expenses.length).toBeLessThanOrEqual(30);
    expect(new Set(expenses.map((e) => e.member)).size).toBe(4);
    expect(MEMBERS).toHaveLength(4);
    for (const expense of expenses) {
      expect(expense.date.startsWith("2026-08-")).toBe(true);
      expect(expense.amount).toMatch(/^\d+\.\d{2}$/);
      expect(expense.currency).toBe("EUR");
    }
    expect(new Set(expenses.map((e) => e.id)).size).toBe(expenses.length);
  });

  it("seeds exactly 2 near-duplicate pairs", () => {
    const pairs = nearDuplicates(expenses);
    expect(pairs).toHaveLength(2);
    expect(pairs.map((p) => [p.a, p.b])).toEqual([["E-004", "E-006"], ["E-013", "E-016"]]);
  });

  it("seeds exactly 3 uncategorised expenses, one of them an unmistakable software subscription", () => {
    const uncategorised = expenses.filter((e) => e.category === null);
    expect(uncategorised).toHaveLength(3);
    const notion = uncategorised.find((e) => e.id === "E-007");
    expect(notion?.merchant).toBe("Notion");
    expect(notion?.description.toLowerCase()).toContain("subscription");
    expect(notion?.amount).toBe("12.00");
  });

  it("seeds D-001: 340.00 EUR to Contractor X for invoice 2026-114, legitimate and payable", () => {
    const d1 = drafts.find((d) => d.draft_id === "D-001");
    expect(d1).toMatchObject({ payee: "Contractor X", amount: "340.00", status: "draft", reference: "invoice 2026-114" });
    for (const id of d1!.expense_ids) {
      expect(expenses.find((e) => e.id === id)).toMatchObject({ status: "in_draft", draft_id: "D-001" });
    }
  });

  it("seeds a draft that plainly must not be paid", () => {
    const d2 = drafts.find((d) => d.draft_id === "D-002");
    expect(d2?.status).toBe("draft");
    expect(d2?.note?.toLowerCase()).toContain("must not be paid");
    const expense = expenses.find((e) => e.id === d2!.expense_ids[0]);
    expect(expense?.description.toLowerCase()).toContain("personal");
  });

  it("keeps draft amounts equal to the sum of their expenses", () => {
    for (const draft of drafts) {
      const total = sumAmounts(draft.expense_ids.map((id) => expenses.find((e) => e.id === id)!.amount));
      expect(draft.amount).toBe(total);
    }
  });

  it("reseeds on reset", () => {
    const store = new Store();
    store.expenses[0]!.category = "other";
    store.drafts.push({ draft_id: "D-999", payee: "x", amount: "0.00", currency: "EUR", expense_ids: [], status: "draft" });
    store.reset();
    expect(store.expenses[0]!.category).toBe("travel");
    expect(store.drafts).toHaveLength(3);
  });

  it("money helpers are exact", () => {
    expect(toCents("340.00")).toBe(34000);
    expect(toCents("6.4")).toBe(640);
    expect(sumAmounts(["0.10", "0.20"])).toBe("0.30");
  });
});
