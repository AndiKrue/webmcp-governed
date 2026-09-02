// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Andreas Krueger
// This file is part of Governed Tool Calls, a WebMCP demo. See LICENSE.

import { beforeEach, describe, expect, it } from "vitest";
import { Store } from "../src/data/fixture";
import type { Gate } from "../src/gate/gate";
import { twoCallTransport } from "../src/gate/transport-twocall";
import { createTools } from "../src/tools";
import { makeGate } from "./helpers";

let store: Store;
let gate: Gate;
let tools: ReturnType<typeof createTools>;
const tool = (name: string) => tools.find((t) => t.name === name)!;

beforeEach(() => {
  store = new Store();
  gate = makeGate().gate;
  tools = createTools(store);
});

async function approveFirst(options?: { confirmation?: string }) {
  const card = gate.pending[0]!;
  const outcome = gate.decide(card.id, "approve", options);
  if (!outcome.ok) throw new Error(outcome.error);
  return card;
}

describe("tool set", () => {
  it("registers seven tools with the fixed names, classes and schemas", () => {
    expect(tools.map((t) => [t.name, t.class])).toEqual([
      ["list_expenses", "open"], ["find_duplicates", "open"], ["summarise_month", "open"],
      ["categorise_expense", "gated"], ["flag_expense", "gated"], ["draft_reimbursement", "gated"],
      ["pay_reimbursement", "sealed"],
    ]);
    for (const t of tools) {
      expect(t.inputSchema.additionalProperties).toBe(false);
      for (const prop of Object.values(t.inputSchema.properties ?? {})) expect(prop.description).toBeTruthy();
      expect(t.name).toMatch(/^[A-Za-z0-9_.-]{1,128}$/);
    }
    const category = tool("categorise_expense").inputSchema.properties?.["category"];
    expect(category?.enum).toEqual(["travel", "meals", "software", "hardware", "office", "other"]);
  });

  it("commit_approved_action exists only in the two-call transport", () => {
    expect(gate.transport.extraTools(gate)).toEqual([]);
    const twoCall = makeGate({ transport: twoCallTransport }).gate;
    expect(twoCall.transport.extraTools(twoCall).map((t) => t.name)).toEqual(["commit_approved_action"]);
  });
});

describe("list_expenses", () => {
  it("lists everything, filters, and maps uncategorised", async () => {
    const all = await gate.execute(tool("list_expenses"), {});
    expect(all).toMatchObject({ status: "ok", count: 26 });
    const dana = await gate.execute(tool("list_expenses"), { member: "dana", month: "2026-08" });
    expect(dana).toMatchObject({ status: "ok", count: 7 });
    const unc = await gate.execute(tool("list_expenses"), { category: "uncategorised" });
    expect((unc as unknown as { expenses: { id: string }[] }).expenses.map((e) => e.id)).toEqual(["E-007", "E-019", "E-020"]);
    const flagged = await gate.execute(tool("list_expenses"), { status: "flagged" });
    expect(flagged).toMatchObject({ count: 1 });
    expect(gate.pending).toHaveLength(0);
  });

  it("resolves invalid filters", async () => {
    expect(await gate.execute(tool("list_expenses"), { member: "Zed" })).toMatchObject({ status: "invalid" });
    expect(await gate.execute(tool("list_expenses"), { month: "August" })).toMatchObject({ status: "invalid" });
    expect(await gate.execute(tool("list_expenses"), { bogus: 1 })).toMatchObject({ status: "invalid" });
  });
});

describe("find_duplicates and summarise_month", () => {
  it("finds the two seeded pairs", async () => {
    const result = await gate.execute(tool("find_duplicates"), {});
    expect(result).toMatchObject({ status: "ok" });
    expect((result as unknown as { pairs: { a: string; b: string }[] }).pairs.map((p) => `${p.a}/${p.b}`)).toEqual(["E-004/E-006", "E-013/E-016"]);
  });

  it("summarises the fixture month by default", async () => {
    const result = await gate.execute(tool("summarise_month"), {});
    expect(result).toMatchObject({ status: "ok", month: "2026-08", uncategorised_count: 3 });
    const r = result as unknown as { total: string; by_member: Record<string, string>; by_category: Record<string, string> };
    expect(Object.keys(r.by_member).sort()).toEqual(["Dana", "Femi", "Lin", "Rafael"]);
    expect(r.by_category["uncategorised"]).toBe("61.20");
    expect(r.total).toMatch(/^\d+\.\d{2}$/);
    expect(await gate.execute(tool("summarise_month"), { month: "2026-13" })).toMatchObject({ status: "invalid" });
  });
});

describe("categorise_expense", () => {
  it("proposes with the documented effect line and applies on approval", async () => {
    const call = gate.execute(tool("categorise_expense"), { expense_id: "E-007", category: "meals" });
    expect(gate.pending[0]?.effect).toBe("Set category of E-007 (Notion subscription, 12.00 EUR) to meals");
    expect(store.expense("E-007")?.category).toBeNull();
    await approveFirst();
    expect(await call).toMatchObject({ status: "ok", expense: { id: "E-007", category: "meals" } });
    expect(store.expense("E-007")?.category).toBe("meals");
  });

  it("leaves the record untouched on decline and returns the refusal", async () => {
    const call = gate.execute(tool("categorise_expense"), { expense_id: "E-007", category: "meals" });
    gate.decide(gate.pending[0]!.id, "decline", { reason: "Notion is software, not meals", retry_hint: "different_arguments" });
    expect(await call).toMatchObject({ status: "declined", reason: "Notion is software, not meals", retry_hint: "different_arguments" });
    expect(store.expense("E-007")?.category).toBeNull();
  });

  it("validates ids, enum and paid state", async () => {
    expect(await gate.execute(tool("categorise_expense"), { expense_id: "E-999", category: "meals" })).toMatchObject({ status: "invalid", errors: ["unknown expense E-999"] });
    expect(await gate.execute(tool("categorise_expense"), { expense_id: "E-007", category: "fun" })).toMatchObject({ status: "invalid" });
    expect(await gate.execute(tool("categorise_expense"), { expense_id: "E-008", category: "meals" })).toMatchObject({ status: "invalid" });
    expect(gate.pending).toHaveLength(0);
  });
});

describe("flag_expense", () => {
  it("proposes, applies with reason, refuses empty reasons and double flags", async () => {
    expect(await gate.execute(tool("flag_expense"), { expense_id: "E-011", reason: " " })).toMatchObject({ status: "invalid", errors: ["reason is required"] });
    expect(await gate.execute(tool("flag_expense"), { expense_id: "E-014", reason: "again" })).toMatchObject({ status: "invalid" });
    const call = gate.execute(tool("flag_expense"), { expense_id: "E-011", reason: "no receipt attached" });
    expect(gate.pending[0]?.effect).toBe('Flag E-011 (Dinner with partner team, 3 people, 96.50 EUR) for review: "no receipt attached"');
    await approveFirst();
    expect(await call).toMatchObject({ status: "ok", expense: { status: "flagged", flag_reason: "no receipt attached" } });
  });
});

describe("draft_reimbursement", () => {
  it("creates a draft of the right total and moves expenses into it", async () => {
    const call = gate.execute(tool("draft_reimbursement"), { payee: "Dana", expense_ids: ["E-001", "E-002", "E-003"] });
    expect(gate.pending[0]?.effect).toBe("Create a payable draft of 237.40 EUR for Dana covering 3 expenses (E-001, E-002, E-003)");
    await approveFirst();
    const result = await call;
    expect(result).toMatchObject({ status: "ok", draft: { draft_id: "D-004", payee: "Dana", amount: "237.40", status: "draft" } });
    expect(store.expense("E-001")).toMatchObject({ status: "in_draft", draft_id: "D-004" });
  });

  it("rejects foreign, uncategorised, flagged, drafted and paid expenses", async () => {
    const result = await gate.execute(tool("draft_reimbursement"), { payee: "Dana", expense_ids: ["E-004", "E-007", "E-009"] });
    expect(result.status).toBe("invalid");
    const errors = (result as { errors: string[] }).errors.join("\n");
    expect(errors).toContain("E-004 belongs to Femi");
    expect(errors).toContain("E-007 is uncategorised");
    expect(errors).toContain("E-009 is already in draft D-001");
    expect(await gate.execute(tool("draft_reimbursement"), { payee: "Femi", expense_ids: ["E-014"] })).toMatchObject({ status: "invalid" });
    expect(await gate.execute(tool("draft_reimbursement"), { payee: "Lin", expense_ids: ["E-008"] })).toMatchObject({ status: "invalid" });
    expect(await gate.execute(tool("draft_reimbursement"), { payee: "Lin", expense_ids: [] })).toMatchObject({ status: "invalid" });
    expect(gate.pending).toHaveLength(0);
  });
});

describe("pay_reimbursement", () => {
  it("is sealed: needs the typed amount, then pays and marks everything paid", async () => {
    const call = gate.execute(tool("pay_reimbursement"), { draft_id: "D-001" });
    const card = gate.pending[0]!;
    expect(card.effect).toBe("Pay 340.00 EUR to Contractor X for draft D-001 (invoice 2026-114). Irreversible.");
    expect(card.expectedConfirmation).toBe("340.00");
    expect(gate.decide(card.id, "approve", { confirmation: "34" }).ok).toBe(false);
    expect(store.draft("D-001")?.status).toBe("draft");
    await approveFirst({ confirmation: "340,00" });
    expect(await call).toMatchObject({ status: "ok", payment: { payment_id: "P-001", draft_id: "D-001", amount: "340.00", payee: "Contractor X" } });
    expect(store.draft("D-001")?.status).toBe("paid");
    expect(store.expense("E-009")?.status).toBe("paid");
    expect(gate.ledger.rows[0]).toMatchObject({ tool_class: "sealed", decision: "approved", confirmation_used: true });
    expect(await gate.execute(tool("pay_reimbursement"), { draft_id: "D-001" })).toMatchObject({ status: "invalid", errors: ["D-001 is already paid"] });
  });

  it("declines the must-not-pay draft without touching state", async () => {
    const call = gate.execute(tool("pay_reimbursement"), { draft_id: "D-002" });
    gate.decide(gate.pending[0]!.id, "decline", { reason: "personal purchase", retry_hint: "never" });
    expect(await call).toMatchObject({ status: "declined", retry_hint: "never" });
    expect(store.draft("D-002")?.status).toBe("draft");
    expect(await gate.execute(tool("pay_reimbursement"), { draft_id: "D-999" })).toMatchObject({ status: "invalid" });
  });
});
