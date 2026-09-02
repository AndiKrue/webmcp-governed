// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Andreas Krueger
// This file is part of Governed Tool Calls, a WebMCP demo. See LICENSE.

import { describe, expect, it } from "vitest";
import { confirmationMatches } from "../src/gate/gate";
import { twoCallTransport } from "../src/gate/transport-twocall";
import { makeGate, noteTool } from "./helpers";

async function settled<T>(promise: Promise<T>): Promise<{ done: boolean; value?: T }> {
  const marker = Symbol("pending");
  const value = await Promise.race([promise, Promise.resolve(marker)]);
  return value === marker ? { done: false } : { done: true, value: value as T };
}

describe("gate with the hold transport", () => {
  it("runs open tools immediately and never produces a card", async () => {
    const { gate, ledger } = makeGate();
    const sink: string[] = [];
    const result = await gate.execute(noteTool("open", sink), { text: "hi" });
    expect(result.status).toBe("ok");
    expect(result.receipt_id).toBe("L-0001");
    expect(sink).toEqual(["hi"]);
    expect(gate.pending).toHaveLength(0);
    expect(ledger.rows[0]).toMatchObject({ decision: "executed", decider: "policy:open", tool_class: "open", latency_ms: 0 });
  });

  it("resolves validation failures as invalid, never throws", async () => {
    const { gate, ledger } = makeGate();
    const result = await gate.execute(noteTool("gated", []), {});
    expect(result).toMatchObject({ status: "invalid", errors: ["text is required"], receipt_id: "L-0001" });
    expect(gate.pending).toHaveLength(0);
    expect(ledger.rows[0]?.decision).toBe("invalid");
  });

  it("never rejects even if a tool implementation throws", async () => {
    const { gate } = makeGate();
    const broken = noteTool("open", [], { run: () => { throw new Error("boom"); } });
    const result = await gate.execute(broken, { text: "x" });
    expect(result.status).toBe("invalid");
    expect((result as { errors: string[] }).errors[0]).toContain("boom");
  });

  it("holds a gated call pending until the human decides, then resolves the real result", async () => {
    const { gate, ledger, clock } = makeGate();
    const sink: string[] = [];
    const call = gate.execute(noteTool("gated", sink), { text: "hi" });
    expect((await settled(call)).done).toBe(false);
    expect(gate.pending).toHaveLength(1);
    expect(sink).toEqual([]);
    const card = gate.pending[0]!;
    expect(card.effect).toBe('Append "hi"');
    expect(ledger.size).toBe(0);

    clock.advance(1500);
    const outcome = gate.decide(card.id, "approve");
    expect(outcome.ok).toBe(true);
    const result = await call;
    expect(result).toEqual({ status: "ok", note: "hi", receipt_id: card.id });
    expect(sink).toEqual(["hi"]);
    expect(gate.pending).toHaveLength(0);
    expect(ledger.rows[0]).toMatchObject({
      id: card.id, decision: "approved", decider: "human", latency_ms: 1500, confirmation_used: false,
      effect: 'Append "hi"', transport: "hold", api: "polyfill",
    });
  });

  it("resolves a decline as a structured refusal with reason and retry hint", async () => {
    const { gate, ledger } = makeGate();
    const sink: string[] = [];
    const call = gate.execute(noteTool("gated", sink), { text: "hi" });
    const card = gate.pending[0]!;
    gate.decide(card.id, "decline", { reason: "wrong note", retry_hint: "different_arguments" });
    expect(await call).toEqual({ status: "declined", reason: "wrong note", retry_hint: "different_arguments", receipt_id: card.id });
    expect(sink).toEqual([]);
    expect(ledger.rows[0]).toMatchObject({ decision: "declined", reason: "wrong note", retry_hint: "different_arguments" });
  });

  it("defaults a decline to different_arguments with a null reason", async () => {
    const { gate } = makeGate();
    const call = gate.execute(noteTool("gated", []), { text: "hi" });
    gate.decide(gate.pending[0]!.id, "decline", { reason: "   " });
    expect(await call).toMatchObject({ status: "declined", reason: null, retry_hint: "different_arguments" });
  });

  it("refuses a sealed approval with the wrong confirmation and accepts the right one", async () => {
    const { gate, ledger } = makeGate();
    const sink: string[] = [];
    const call = gate.execute(noteTool("sealed", sink), { text: "pay" });
    const card = gate.pending[0]!;
    expect(card.expectedConfirmation).toBe("12.50");
    expect(gate.decide(card.id, "approve")).toMatchObject({ ok: false });
    expect(gate.decide(card.id, "approve", { confirmation: "12" })).toMatchObject({ ok: false });
    expect(gate.decide(card.id, "approve", { confirmation: "125" })).toMatchObject({ ok: false });
    expect(gate.pending).toHaveLength(1);
    expect(sink).toEqual([]);
    expect(gate.decide(card.id, "approve", { confirmation: "12,50" })).toMatchObject({ ok: true });
    expect(await call).toMatchObject({ status: "ok", note: "pay" });
    expect(ledger.rows[0]).toMatchObject({ decision: "approved", confirmation_used: true, tool_class: "sealed" });
  });

  it("does not allow deciding twice", () => {
    const { gate } = makeGate();
    void gate.execute(noteTool("gated", []), { text: "hi" });
    const id = gate.pending[0]!.id;
    expect(gate.decide(id, "decline").ok).toBe(true);
    expect(gate.decide(id, "approve").ok).toBe(false);
    expect(gate.decide("L-9999", "approve").ok).toBe(false);
  });

  it("records a caller abort as cancelled_by_caller and withdraws the card", async () => {
    const { gate, ledger } = makeGate();
    const controller = new AbortController();
    const sink: string[] = [];
    const call = gate.execute(noteTool("gated", sink), { text: "hi" }, { signal: controller.signal });
    expect(gate.pending).toHaveLength(1);
    controller.abort();
    expect(gate.pending).toHaveLength(0);
    expect(await call).toMatchObject({ status: "declined", retry_hint: "not_now" });
    expect(sink).toEqual([]);
    expect(ledger.rows[0]).toMatchObject({ decision: "cancelled_by_caller" });
  });

  it("re-validates at approval time so a stale proposal cannot apply", async () => {
    const { gate, ledger } = makeGate();
    let valid = true;
    const tool = noteTool("gated", [], {
      validate: () => (valid ? { ok: true, value: { text: "x" } } : { ok: false, errors: ["gone"] }),
    });
    const call = gate.execute(tool, { text: "x" });
    valid = false;
    gate.decide(gate.pending[0]!.id, "approve");
    expect(await call).toMatchObject({ status: "invalid", errors: ["gone"] });
    expect(ledger.rows[0]?.outcome).toContain("no longer valid");
  });

  it("reads the class from the definition, not the input", async () => {
    const { gate } = makeGate();
    const result = gate.execute(noteTool("gated", []), { text: "hi", class: "open" } as never);
    expect(gate.pending).toHaveLength(1);
    gate.decide(gate.pending[0]!.id, "decline");
    await result;
  });
});

describe("confirmationMatches", () => {
  it("accepts the documented spellings and rejects others", () => {
    expect(confirmationMatches("340.00", "340")).toBe(true);
    expect(confirmationMatches("340.00", "340.00")).toBe(true);
    expect(confirmationMatches("340.00", "340,00")).toBe(true);
    expect(confirmationMatches("340.00", " 340.0 ")).toBe(true);
    expect(confirmationMatches("340.00", "34")).toBe(false);
    expect(confirmationMatches("340.00", "340.001")).toBe(false);
    expect(confirmationMatches("340.00", "EUR 340")).toBe(false);
    expect(confirmationMatches("340.00", undefined)).toBe(false);
  });
});

describe("gate with the two-call transport", () => {
  it("returns a pending token at once and walks the token lifecycle", async () => {
    const { gate, ledger } = makeGate({ transport: twoCallTransport });
    const [commitTool] = twoCallTransport.extraTools(gate);
    const sink: string[] = [];
    const first = await gate.execute(noteTool("gated", sink), { text: "hi" });
    expect(first).toMatchObject({ status: "pending_approval", approval_token: "token-1", receipt_id: "L-0001" });
    expect((first as { instruction: string }).instruction).toContain("commit_approved_action");
    expect(sink).toEqual([]);
    expect(gate.pending).toHaveLength(1);

    const again = await gate.execute(commitTool!, { approval_token: "token-1" });
    expect(again.status).toBe("pending_approval");

    gate.decide("L-0001", "approve");
    const committed = await gate.execute(commitTool!, { approval_token: "token-1" });
    expect(committed).toEqual({ status: "ok", note: "hi", receipt_id: "L-0001" });
    expect(sink).toEqual(["hi"]);

    const used = await gate.execute(commitTool!, { approval_token: "token-1" });
    expect(used.status).toBe("invalid");
    const unknown = await gate.execute(commitTool!, { approval_token: "nope" });
    expect(unknown.status).toBe("invalid");
    expect(await gate.execute(commitTool!, {})).toMatchObject({ status: "invalid" });

    expect(ledger.rows.map((r) => r.tool)).toEqual(["note_gated", "commit_approved_action"]);
    expect(ledger.rows[0]?.transport).toBe("two-call");
  });

  it("commits a refusal too", async () => {
    const { gate } = makeGate({ transport: twoCallTransport });
    const [commitTool] = twoCallTransport.extraTools(gate);
    await gate.execute(noteTool("gated", []), { text: "hi" });
    gate.decide("L-0001", "decline", { reason: "no", retry_hint: "never" });
    expect(await gate.execute(commitTool!, { approval_token: "token-1" })).toEqual({
      status: "declined", reason: "no", retry_hint: "never", receipt_id: "L-0001",
    });
  });

  it("open tools behave the same under both transports", async () => {
    const { gate } = makeGate({ transport: twoCallTransport });
    expect(await gate.execute(noteTool("open", []), { text: "hi" })).toMatchObject({ status: "ok" });
  });
});

describe("descriptions", () => {
  it("state the class, the decline path and the return values per transport", () => {
    const { gate } = makeGate();
    const gated = gate.toModelContextTool(noteTool("gated", []));
    expect(gated.description).toContain("waits until they decide");
    expect(gated.description).toContain('{status:"declined", reason, retry_hint}');
    expect(gated.description).toContain("different_arguments");
    expect(gated.annotations).toBeUndefined();
    const open = gate.toModelContextTool(noteTool("open", []));
    expect(open.annotations).toEqual({ readOnlyHint: true });
    expect(open.description).toContain("runs immediately");
    const { gate: twoCall } = makeGate({ transport: twoCallTransport });
    const sealed = twoCall.toModelContextTool(noteTool("sealed", []));
    expect(sealed.description).toContain("pending_approval");
    expect(sealed.description).toContain("irreversible");
    expect(sealed.inputSchema?.additionalProperties).toBe(false);
  });
});
