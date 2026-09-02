// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Andreas Krueger
// This file is part of Ask First, a WebMCP demo. See LICENSE.

// Append-only, in-memory ledger. A row id is reserved when a proposal is made and the row is appended
// when the proposal settles, so ids are stable and rows are never edited. Not signed: this is a log.

import type { TransportName } from "../gate/config";

export type ToolClass = "open" | "gated" | "sealed";
export type LedgerApi = "native" | "polyfill" | "none";
export type Decision = "executed" | "approved" | "declined" | "cancelled_by_caller" | "invalid";
export type Decider = "policy:open" | "human" | "policy:validation";
export type RetryHint = "different_arguments" | "not_now" | "never";

export interface LedgerRow {
  id: string;
  tool: string;
  title: string;
  tool_class: ToolClass;
  transport: TransportName;
  api: LedgerApi;
  arguments: unknown;
  effect: string | null;
  ts_proposed: string;
  ts_decided: string;
  latency_ms: number;
  decision: Decision;
  decider: Decider;
  reason: string | null;
  retry_hint: RetryHint | null;
  confirmation_used: boolean;
  outcome: string;
}

export type LedgerListener = (rows: readonly LedgerRow[]) => void;

export class Ledger {
  #rows: LedgerRow[] = [];
  #reserved = 0;
  #listeners = new Set<LedgerListener>();

  /** Rows in append order (oldest first). */
  get rows(): readonly LedgerRow[] {
    return this.#rows;
  }

  get size(): number {
    return this.#rows.length;
  }

  /** Reserves the id a future row will carry; results quote it as `receipt_id`. */
  reserveId(): string {
    this.#reserved += 1;
    return `L-${String(this.#reserved).padStart(4, "0")}`;
  }

  append(row: LedgerRow): LedgerRow {
    if (this.#rows.some((existing) => existing.id === row.id)) {
      throw new Error(`ledger row ${row.id} already exists`);
    }
    const frozen = Object.freeze({ ...row });
    this.#rows.push(frozen);
    for (const listener of this.#listeners) listener(this.#rows);
    return frozen;
  }

  find(id: string): LedgerRow | undefined {
    return this.#rows.find((row) => row.id === id);
  }

  subscribe(listener: LedgerListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  toJSON(): LedgerRow[] {
    return [...this.#rows];
  }

  export(): string {
    return JSON.stringify(this.#rows, null, 2);
  }

  /** Clears rows and the id counter. Only "Reset to fixture" calls this. */
  reset(): void {
    this.#rows = [];
    this.#reserved = 0;
    for (const listener of this.#listeners) listener(this.#rows);
  }
}
