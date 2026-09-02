// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Andreas Krueger
// This file is part of Governed Tool Calls, a WebMCP demo. See LICENSE.

// The seeded team budget for 2026-08. Four fictional members, in-memory state, reseeded on reload or
// on "Reset to fixture". Amounts are decimal strings with two places.

export const CATEGORIES = ["travel", "meals", "software", "hardware", "office", "other"] as const;
export type Category = (typeof CATEGORIES)[number];
export const STATUSES = ["submitted", "flagged", "in_draft", "paid"] as const;
export type ExpenseStatus = (typeof STATUSES)[number];
export const MEMBERS = ["Dana", "Femi", "Lin", "Rafael"] as const;
export type Member = (typeof MEMBERS)[number];
export const FIXTURE_MONTH = "2026-08";
export const CURRENCY = "EUR";

export interface Expense {
  id: string;
  member: Member;
  date: string;
  merchant: string;
  description: string;
  amount: string;
  currency: string;
  category: Category | null;
  status: ExpenseStatus;
  flag_reason?: string;
  draft_id?: string;
}

export interface Draft {
  draft_id: string;
  payee: string;
  amount: string;
  currency: string;
  expense_ids: string[];
  status: "draft" | "paid";
  /** Plain-language note shown on the page and in effect lines, e.g. an invoice reference. */
  note?: string;
  reference?: string;
  paid_at?: string;
}

export interface Payment {
  payment_id: string;
  draft_id: string;
  payee: string;
  amount: string;
  currency: string;
  paid_at: string;
}

type Seed = [
  id: string, member: Member, date: string, merchant: string, description: string, amount: string,
  category: Category | null, status: ExpenseStatus, extra?: Partial<Expense>,
];

const EXPENSE_SEED: Seed[] = [
  ["E-001", "Dana", "2026-08-01", "Deutsche Bahn", "Train to Munich, client workshop", "89.00", "travel", "submitted"],
  ["E-002", "Dana", "2026-08-03", "Hotel Lux", "One night, Munich workshop", "142.00", "travel", "submitted"],
  ["E-003", "Dana", "2026-08-03", "Bäckerei Krause", "Breakfast, workshop day", "6.40", "meals", "submitted"],
  ["E-004", "Femi", "2026-08-04", "Taxi Berlin", "Taxi to airport", "23.40", "travel", "submitted"],
  ["E-005", "Femi", "2026-08-04", "Lufthansa", "Flight BER–VIE, partner meeting", "218.00", "travel", "submitted"],
  ["E-006", "Femi", "2026-08-06", "Taxi Berlin", "Taxi from airport", "23.40", "travel", "submitted"],
  ["E-007", "Dana", "2026-08-05", "Notion", "Notion subscription", "12.00", null, "submitted"],
  ["E-008", "Lin", "2026-08-07", "Figma", "Figma seat, August", "15.00", "software", "paid", { draft_id: "D-003" }],
  ["E-009", "Dana", "2026-08-08", "Contractor X", "Invoice 2026-114, landing page design", "340.00", "other", "in_draft", { draft_id: "D-001" }],
  ["E-010", "Lin", "2026-08-09", "REWE", "Snacks for sprint review", "21.30", "meals", "paid", { draft_id: "D-003" }],
  ["E-011", "Femi", "2026-08-11", "Figlmüller", "Dinner with partner team, 3 people", "96.50", "meals", "submitted"],
  ["E-012", "Rafael", "2026-08-12", "Hetzner", "Staging server, August", "39.00", "software", "submitted"],
  ["E-013", "Dana", "2026-08-14", "Uber", "Ride to client site, shared with Lin", "27.50", "travel", "submitted"],
  ["E-014", "Femi", "2026-08-15", "Zum Löwen", "Team dinner, 8 people", "312.00", "meals", "flagged", { flag_reason: "receipt missing" }],
  ["E-015", "Rafael", "2026-08-16", "MediaMarkt", "Monitor for the shared desk", "229.00", "hardware", "submitted"],
  ["E-016", "Lin", "2026-08-14", "Uber", "Ride to client site", "27.50", "travel", "submitted"],
  ["E-017", "Lin", "2026-08-18", "Conrad", "USB hub and HDMI adapter", "48.90", "hardware", "submitted"],
  ["E-018", "Rafael", "2026-08-19", "Staples", "Whiteboard markers, sticky notes", "17.60", "office", "submitted"],
  ["E-019", "Dana", "2026-08-22", "Amazon", "USB-C cables and snacks for the office", "34.20", null, "submitted"],
  ["E-020", "Femi", "2026-08-25", "Parkhaus Mitte", "Parking near the venue", "15.00", null, "submitted"],
  ["E-021", "Rafael", "2026-08-24", "Bose", "Headphones for home use — personal purchase, submitted by mistake", "249.00", "hardware", "in_draft", { draft_id: "D-002" }],
  ["E-022", "Lin", "2026-08-26", "Deutsche Bahn", "Train to Hamburg, user interviews", "76.00", "travel", "submitted"],
  ["E-023", "Rafael", "2026-08-27", "Pizzeria Roma", "Working lunch, 2 people", "31.80", "meals", "submitted"],
  ["E-024", "Femi", "2026-08-29", "JetBrains", "IDE licence renewal", "149.00", "software", "submitted"],
  ["E-025", "Lin", "2026-08-30", "Coffee Fellows", "Coffee with interviewee", "8.20", "meals", "submitted"],
  ["E-026", "Rafael", "2026-08-31", "Namecheap", "Domain renewal", "14.00", "software", "submitted"],
];

const DRAFT_SEED: Draft[] = [
  {
    draft_id: "D-001", payee: "Contractor X", amount: "340.00", currency: CURRENCY, expense_ids: ["E-009"],
    status: "draft", reference: "invoice 2026-114",
    note: "External payee. Invoice 2026-114 for the landing page design, submitted by Dana. Due.",
  },
  {
    draft_id: "D-002", payee: "Rafael", amount: "249.00", currency: CURRENCY, expense_ids: ["E-021"],
    status: "draft",
    note: "Reimburses E-021, a personal purchase (headphones for home use) submitted by mistake. Must not be paid.",
  },
  {
    draft_id: "D-003", payee: "Lin", amount: "36.30", currency: CURRENCY, expense_ids: ["E-008", "E-010"],
    status: "paid", paid_at: "2026-08-10T09:12:00.000Z", note: "Paid on 10 August.",
  },
];

export function seedExpenses(): Expense[] {
  return EXPENSE_SEED.map(([id, member, date, merchant, description, amount, category, status, extra]) => ({
    id, member, date, merchant, description, amount, currency: CURRENCY, category, status, ...extra,
  }));
}

export function seedDrafts(): Draft[] {
  return DRAFT_SEED.map((draft) => ({ ...draft, expense_ids: [...draft.expense_ids] }));
}

// ---- money helpers -------------------------------------------------------------------------

export function toCents(amount: string): number {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(amount.trim());
  if (!match) throw new Error(`bad amount ${amount}`);
  const whole = Number(match[1]);
  const frac = (match[2] ?? "0").padEnd(2, "0");
  return whole * 100 + Number(frac);
}

export function fromCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

export function sumAmounts(amounts: string[]): string {
  return fromCents(amounts.reduce((total, amount) => total + toCents(amount), 0));
}

export function formatMoney(amount: string, currency = CURRENCY): string {
  return `${amount} ${currency}`;
}

export function isCategory(value: unknown): value is Category {
  return typeof value === "string" && (CATEGORIES as readonly string[]).includes(value);
}

export function isMember(value: unknown): value is Member {
  return typeof value === "string" && (MEMBERS as readonly string[]).includes(value);
}

/** Case-insensitive lookup of a member name. */
export function findMember(value: unknown): Member | null {
  if (typeof value !== "string") return null;
  const lower = value.trim().toLowerCase();
  return MEMBERS.find((member) => member.toLowerCase() === lower) ?? null;
}

// ---- the in-memory store --------------------------------------------------------------------

export type StoreListener = (store: Store) => void;

export class Store {
  expenses: Expense[] = seedExpenses();
  drafts: Draft[] = seedDrafts();
  payments: Payment[] = [];
  #listeners = new Set<StoreListener>();

  reset(): void {
    this.expenses = seedExpenses();
    this.drafts = seedDrafts();
    this.payments = [];
    this.notify();
  }

  subscribe(listener: StoreListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  notify(): void {
    for (const listener of this.#listeners) listener(this);
  }

  expense(id: string): Expense | undefined {
    return this.expenses.find((expense) => expense.id === id);
  }

  draft(id: string): Draft | undefined {
    return this.drafts.find((draft) => draft.draft_id === id);
  }

  nextDraftId(): string {
    return `D-${String(this.drafts.length + 1).padStart(3, "0")}`;
  }

  nextPaymentId(): string {
    return `P-${String(this.payments.length + 1).padStart(3, "0")}`;
  }
}
