// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Andreas Krueger
// This file is part of Ask First, a WebMCP demo. See LICENSE.

import { formatMoney, type Draft, type Payment, type Store } from "../data/fixture";
import type { GovernedTool } from "../gate/gate";
import { asObject, copy, rejectUnknownKeys, requiredString } from "./common";

export interface PayInput {
  draft_id: string;
}

export function payReimbursementTool(store: Store, now: () => Date = () => new Date()): GovernedTool<PayInput> {
  return {
    name: "pay_reimbursement",
    title: "Pay reimbursement",
    class: "sealed",
    summary: "Pay a reimbursement draft.",
    why: "Money leaves the budget and there is no undo",
    reversal: "Cost of reversal: total. There is no undo; the money is gone once this is approved.",
    returns: '{status:"ok", payment}',
    inputSchema: {
      type: "object",
      properties: { draft_id: { type: "string", description: "The draft to pay, e.g. D-001. It must be in status draft." } },
      required: ["draft_id"],
      additionalProperties: false,
    },
    validate(input) {
      const fields = asObject(input);
      const errors: string[] = [];
      rejectUnknownKeys(fields, ["draft_id"], errors);
      const id = requiredString(fields, "draft_id", errors);
      const draft = id ? store.draft(id) : undefined;
      if (id && !draft) errors.push(`unknown draft ${id}`);
      if (draft?.status === "paid") errors.push(`${draft.draft_id} is already paid`);
      if (draft && draft.expense_ids.length === 0) errors.push(`${draft.draft_id} covers no expenses`);
      return errors.length || !draft ? { ok: false, errors } : { ok: true, value: { draft_id: draft.draft_id } };
    },
    effect(input) {
      const draft = store.draft(input.draft_id) as Draft;
      const reference = draft.reference ? ` (${draft.reference})` : "";
      return `Pay ${formatMoney(draft.amount)} to ${draft.payee} for draft ${draft.draft_id}${reference}. Irreversible.`;
    },
    args(input) {
      const draft = store.draft(input.draft_id) as Draft;
      const rows = [
        { label: "Draft", value: draft.draft_id },
        { label: "Payee", value: draft.payee },
        { label: "Amount", value: formatMoney(draft.amount) },
        { label: "Covers", value: draft.expense_ids.join(", ") },
      ];
      if (draft.note) rows.push({ label: "Note", value: draft.note });
      return rows;
    },
    confirmation(input) {
      return (store.draft(input.draft_id) as Draft).amount;
    },
    run(input) {
      const draft = store.draft(input.draft_id) as Draft;
      const paid_at = now().toISOString();
      draft.status = "paid";
      draft.paid_at = paid_at;
      for (const id of draft.expense_ids) {
        const expense = store.expense(id);
        if (expense) expense.status = "paid";
      }
      const payment: Payment = {
        payment_id: store.nextPaymentId(),
        draft_id: draft.draft_id,
        payee: draft.payee,
        amount: draft.amount,
        currency: draft.currency,
        paid_at,
      };
      store.payments.push(payment);
      store.notify();
      return { status: "ok", payment: copy(payment) };
    },
    outcome: (result) => {
      const payment = result.payment as Payment;
      return `${payment.payment_id}: ${formatMoney(payment.amount)} paid to ${payment.payee}`;
    },
  };
}
