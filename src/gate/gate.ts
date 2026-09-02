// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Andreas Krueger
// This file is part of Ask First, a WebMCP demo. See LICENSE.

// The gate owns every decision. A tool's class is a property of its definition, never of the input,
// so an agent cannot escalate by phrasing a call differently. `execute` here never throws: refusals,
// validation failures and pending states are resolved JSON values, because a rejected promise reaches
// a WebMCP caller as an opaque "UnknownError".

import type { ApiMode, JsonSchema, ModelContextTool } from "../webmcp/types";
import type { TransportName } from "./config";
import type { Decision, Decider, Ledger, LedgerApi, LedgerRow, RetryHint, ToolClass } from "../ledger/ledger";

export type { RetryHint, ToolClass } from "../ledger/ledger";

export interface ValidationOk<I> {
  ok: true;
  value: I;
}
export interface ValidationFail {
  ok: false;
  errors: string[];
}
export type Validation<I> = ValidationOk<I> | ValidationFail;

export interface ArgumentView {
  label: string;
  value: string;
}

export interface OkResult {
  status: "ok";
  [key: string]: unknown;
}
export interface InvalidResult {
  status: "invalid";
  errors: string[];
}
export interface DeclinedResult {
  status: "declined";
  reason: string | null;
  retry_hint: RetryHint;
}
export interface PendingResult {
  status: "pending_approval";
  approval_token: string;
  instruction: string;
}
export type ToolResult = (OkResult | InvalidResult | DeclinedResult | PendingResult) & {
  receipt_id: string | null;
};

/** A tool as the page defines it; the gate turns this into a WebMCP `ModelContextTool`. */
export interface GovernedTool<I = unknown> {
  name: string;
  title: string;
  class: ToolClass;
  /** What the tool does, one sentence, agent-facing. */
  summary: string;
  /** Why the page gates it, e.g. "This changes another person's record". Gated and sealed only. */
  why?: string;
  /** The shape of the success value, e.g. `{status:"ok", expense}`. */
  returns: string;
  inputSchema: JsonSchema;
  validate(input: unknown): Validation<I>;
  /** One line stating what will happen, shown prominently on the card. */
  effect(input: I): string;
  /** Arguments as label + value for the card. Defaults to the raw input fields. */
  args?(input: I): ArgumentView[];
  /** Sealed tools: the value the human must type before approval, e.g. the amount. */
  confirmation?(input: I): string;
  /** One dim line under the card's buttons: what undoing this would cost. */
  reversal?: string;
  /** Applies the effect and returns the success value. Only the gate calls this. */
  run(input: I): OkResult;
  /** One-line summary of a success value for the ledger. Defaults to the effect line. */
  outcome?(result: OkResult, input: I): string;
  /**
   * Transport plumbing only: when set, the gate resolves this value directly and records no ledger
   * row of its own, because the row belongs to the proposal the call refers to.
   */
  passthrough?(input: I): ToolResult;
}

export type ProposalState = "pending" | "approved" | "declined" | "cancelled";

export interface Proposal {
  id: string;
  token: string;
  tool: GovernedTool;
  input: unknown;
  effect: string;
  args: ArgumentView[];
  expectedConfirmation: string | null;
  ts_proposed: string;
  state: ProposalState;
  result: ToolResult | null;
  /** Set once a two-call agent has collected the result. */
  consumed: boolean;
  readonly promise: Promise<ToolResult>;
}

export interface DecideOptions {
  reason?: string | null;
  retry_hint?: RetryHint;
  confirmation?: string;
}

export type DecideOutcome = { ok: true; result: ToolResult } | { ok: false; error: string };

export interface Transport {
  readonly name: TransportName;
  /** Turns a proposal into the value `execute` resolves with. */
  respond(gate: Gate, proposal: Proposal): Promise<ToolResult>;
  /** Agent-facing description for a tool under this transport. */
  describe(tool: GovernedTool): string;
  /** Tools the transport itself needs, e.g. `commit_approved_action`. */
  extraTools(gate: Gate): GovernedTool[];
}

export interface GateOptions {
  ledger: Ledger;
  transport: Transport;
  api: ApiMode;
  now?: () => number;
  random?: () => string;
}

export type GateListener = (gate: Gate) => void;

function defaultToken(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Accepts `340`, `340.00`, `340,00` (and surrounding whitespace) for an expected `340.00`. */
export function confirmationMatches(expected: string, typed: string | undefined): boolean {
  if (typeof typed !== "string") return false;
  const cleaned = typed.trim().replace(/\s+/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return false;
  return Number(cleaned) === Number(expected);
}

function toLedgerApi(api: ApiMode): LedgerApi {
  if (api === "native" || api === "aliased") return "native";
  return api;
}

function defaultArgs(input: unknown): ArgumentView[] {
  if (!input || typeof input !== "object") return [];
  return Object.entries(input as Record<string, unknown>).map(([label, value]) => ({
    label,
    value: typeof value === "string" ? value : JSON.stringify(value),
  }));
}

export class Gate {
  readonly ledger: Ledger;
  transport: Transport;
  readonly api: ApiMode;
  #now: () => number;
  #random: () => string;
  #proposals = new Map<string, Proposal>();
  #settle = new Map<string, (result: ToolResult) => void>();
  #listeners = new Set<GateListener>();

  constructor(options: GateOptions) {
    this.ledger = options.ledger;
    this.transport = options.transport;
    this.api = options.api;
    this.#now = options.now ?? (() => Date.now());
    this.#random = options.random ?? defaultToken;
  }

  /** Proposals still waiting for a decision, oldest first. */
  get pending(): Proposal[] {
    return [...this.#proposals.values()].filter((p) => p.state === "pending");
  }

  get proposals(): Proposal[] {
    return [...this.#proposals.values()];
  }

  get(id: string): Proposal | undefined {
    return this.#proposals.get(id);
  }

  byToken(token: string): Proposal | undefined {
    return [...this.#proposals.values()].find((p) => p.token === token);
  }

  subscribe(listener: GateListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emit(): void {
    for (const listener of this.#listeners) listener(this);
  }

  /** Wraps a governed tool as the WebMCP tool the page registers. */
  toModelContextTool(tool: GovernedTool): ModelContextTool {
    const definition: ModelContextTool = {
      name: tool.name,
      title: tool.title,
      description: this.transport.describe(tool),
      inputSchema: tool.inputSchema,
      execute: (input, options) => this.execute(tool, input, options),
    };
    if (tool.class === "open" && !tool.passthrough) {
      definition.annotations = { readOnlyHint: true };
    }
    return definition;
  }

  /** The single entry point for every call. Never rejects. */
  async execute(tool: GovernedTool, rawInput: unknown, options: { signal?: AbortSignal } = {}): Promise<ToolResult> {
    try {
      const validation = tool.validate(rawInput ?? {});
      if (!validation.ok) return this.#recordInvalid(tool, rawInput, validation.errors);
      if (tool.passthrough) return tool.passthrough(validation.value);
      if (tool.class === "open") return this.#runOpen(tool, validation.value);
      const proposal = this.propose(tool, validation.value, options.signal);
      return await this.transport.respond(this, proposal);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.#recordInvalid(tool, rawInput, [`internal error: ${message}`]);
    }
  }

  #recordInvalid(tool: GovernedTool, input: unknown, errors: string[]): ToolResult {
    const ts = new Date(this.#now()).toISOString();
    const id = this.ledger.reserveId();
    this.#append({
      id,
      tool,
      input,
      effect: null,
      ts_proposed: ts,
      ts_decided: ts,
      decision: "invalid",
      decider: "policy:validation",
      reason: null,
      retry_hint: null,
      confirmation_used: false,
      outcome: `invalid: ${errors.join("; ")}`,
    });
    return { status: "invalid", errors, receipt_id: id };
  }

  #runOpen(tool: GovernedTool, input: unknown): ToolResult {
    const ts = new Date(this.#now()).toISOString();
    const id = this.ledger.reserveId();
    const value = tool.run(input);
    const outcome = tool.outcome ? tool.outcome(value, input) : tool.effect(input);
    this.#append({
      id,
      tool,
      input,
      effect: null,
      ts_proposed: ts,
      ts_decided: ts,
      decision: "executed",
      decider: "policy:open",
      reason: null,
      retry_hint: null,
      confirmation_used: false,
      outcome: `ok: ${outcome}`,
    });
    return { ...value, receipt_id: id };
  }

  /** Creates a pending proposal (a card) for a gated or sealed tool. */
  propose(tool: GovernedTool, input: unknown, signal?: AbortSignal): Proposal {
    const id = this.ledger.reserveId();
    let settle: (result: ToolResult) => void = () => {};
    const promise = new Promise<ToolResult>((resolve) => {
      settle = resolve;
    });
    const proposal: Proposal = {
      id,
      token: this.#random(),
      tool,
      input,
      effect: tool.effect(input),
      args: tool.args ? tool.args(input) : defaultArgs(input),
      expectedConfirmation: tool.class === "sealed" && tool.confirmation ? tool.confirmation(input) : null,
      ts_proposed: new Date(this.#now()).toISOString(),
      state: "pending",
      result: null,
      consumed: false,
      promise,
    };
    this.#proposals.set(id, proposal);
    this.#settle.set(id, settle);
    if (signal) {
      if (signal.aborted) this.cancel(id);
      else signal.addEventListener("abort", () => this.cancel(id), { once: true });
    }
    this.#emit();
    return proposal;
  }

  /** The human's decision. Sealed approvals must carry a matching confirmation. */
  decide(id: string, decision: "approve" | "decline", options: DecideOptions = {}): DecideOutcome {
    const proposal = this.#proposals.get(id);
    if (!proposal) return { ok: false, error: `unknown proposal ${id}` };
    if (proposal.state !== "pending") return { ok: false, error: `proposal ${id} is already ${proposal.state}` };

    if (decision === "decline") {
      const reason = options.reason?.trim() ? options.reason.trim() : null;
      const retry_hint: RetryHint = options.retry_hint ?? "different_arguments";
      const result: ToolResult = { status: "declined", reason, retry_hint, receipt_id: id };
      this.#finish(proposal, "declined", "declined", "human", reason, retry_hint, false, result,
        `declined (${retry_hint})${reason ? `: ${reason}` : ""}`);
      return { ok: true, result };
    }

    let confirmation_used = false;
    if (proposal.expectedConfirmation !== null) {
      if (!confirmationMatches(proposal.expectedConfirmation, options.confirmation)) {
        return { ok: false, error: "confirmation does not match the amount on the card" };
      }
      confirmation_used = true;
    }

    const revalidated = proposal.tool.validate(proposal.input);
    if (!revalidated.ok) {
      const result: ToolResult = { status: "invalid", errors: revalidated.errors, receipt_id: id };
      this.#finish(proposal, "approved", "approved", "human", null, null, confirmation_used, result,
        `approved, but no longer valid: ${revalidated.errors.join("; ")}`);
      return { ok: true, result };
    }
    const value = proposal.tool.run(revalidated.value);
    const result: ToolResult = { ...value, receipt_id: id };
    const outcome = proposal.tool.outcome ? proposal.tool.outcome(value, revalidated.value) : proposal.effect;
    this.#finish(proposal, "approved", "approved", "human", null, null, confirmation_used, result, `ok: ${outcome}`);
    return { ok: true, result };
  }

  /** The caller aborted (`options.signal` in `execute`). The card is withdrawn. */
  cancel(id: string): void {
    const proposal = this.#proposals.get(id);
    if (!proposal || proposal.state !== "pending") return;
    const result: ToolResult = {
      status: "declined",
      reason: "the caller cancelled the call before a decision was made",
      retry_hint: "not_now",
      receipt_id: id,
    };
    this.#finish(proposal, "cancelled", "cancelled_by_caller", "human", result.reason, "not_now", false, result,
      "cancelled by the caller before a decision");
  }

  #finish(
    proposal: Proposal,
    state: ProposalState,
    decision: Decision,
    decider: Decider,
    reason: string | null,
    retry_hint: RetryHint | null,
    confirmation_used: boolean,
    result: ToolResult,
    outcome: string,
  ): void {
    proposal.state = state;
    proposal.result = result;
    this.#append({
      id: proposal.id,
      tool: proposal.tool,
      input: proposal.input,
      effect: proposal.effect,
      ts_proposed: proposal.ts_proposed,
      ts_decided: new Date(this.#now()).toISOString(),
      decision,
      decider: decision === "cancelled_by_caller" ? "human" : decider,
      reason,
      retry_hint,
      confirmation_used,
      outcome,
    });
    this.#settle.get(proposal.id)?.(result);
    this.#settle.delete(proposal.id);
    this.#emit();
  }

  #append(row: {
    id: string;
    tool: GovernedTool;
    input: unknown;
    effect: string | null;
    ts_proposed: string;
    ts_decided: string;
    decision: Decision;
    decider: Decider;
    reason: string | null;
    retry_hint: RetryHint | null;
    confirmation_used: boolean;
    outcome: string;
  }): LedgerRow {
    const latency = Date.parse(row.ts_decided) - Date.parse(row.ts_proposed);
    return this.ledger.append({
      id: row.id,
      tool: row.tool.name,
      title: row.tool.title,
      tool_class: row.tool.class,
      transport: this.transport.name,
      api: toLedgerApi(this.api),
      arguments: row.input,
      effect: row.effect,
      ts_proposed: row.ts_proposed,
      ts_decided: row.ts_decided,
      latency_ms: Number.isFinite(latency) ? latency : 0,
      decision: row.decision,
      decider: row.decider,
      reason: row.reason,
      retry_hint: row.retry_hint,
      confirmation_used: row.confirmation_used,
      outcome: row.outcome,
    });
  }

  /** Switches transport in place: pending proposals are cancelled, everything else stays. */
  setTransport(transport: Transport): void {
    for (const proposal of this.pending) this.cancel(proposal.id);
    this.transport = transport;
    this.#emit();
  }

  /** Forgets all proposals (pending ones are cancelled first). Used by "Reset to fixture". */
  reset(): void {
    for (const proposal of this.pending) this.cancel(proposal.id);
    this.#proposals.clear();
    this.#settle.clear();
    this.#emit();
  }
}

/** Shared wording for how an agent should read a refusal. Used by both transports. */
export const REFUSAL_GUIDANCE =
  'If declined you receive {status:"declined", reason, retry_hint}: read the reason; ' +
  'if retry_hint is "different_arguments" you may propose again with changed arguments; ' +
  'if "not_now" or "never", do not retry — report the refusal to the user.';

/** Shared wording for validation failures. */
export const INVALID_GUIDANCE =
  'Wrong or unknown arguments resolve {status:"invalid", errors} without involving the human.';

export function describeOpen(tool: GovernedTool): string {
  return (
    `${tool.summary} Read-only; runs immediately without asking the human. ` +
    `Returns ${tool.returns}. ${INVALID_GUIDANCE}`
  );
}
