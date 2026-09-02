// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Andreas Krueger
// This file is part of Governed Tool Calls, a WebMCP demo. See LICENSE.

import { Gate } from "../src/gate/gate";
import type { GovernedTool, OkResult, Transport } from "../src/gate/gate";
import { holdTransport } from "../src/gate/transport-hold";
import { Ledger } from "../src/ledger/ledger";
import type { ApiMode } from "../src/webmcp/types";

export interface Clock {
  now: () => number;
  advance(ms: number): void;
}

export function fakeClock(start = Date.parse("2026-08-20T10:00:00.000Z")): Clock {
  let t = start;
  return {
    now: () => t,
    advance(ms) {
      t += ms;
    },
  };
}

export function makeGate(options: { transport?: Transport; api?: ApiMode; clock?: Clock } = {}): {
  gate: Gate;
  ledger: Ledger;
  clock: Clock;
} {
  const ledger = new Ledger();
  const clock = options.clock ?? fakeClock();
  let counter = 0;
  const gate = new Gate({
    ledger,
    transport: options.transport ?? holdTransport,
    api: options.api ?? "polyfill",
    now: clock.now,
    random: () => `token-${(counter += 1)}`,
  });
  return { gate, ledger, clock };
}

interface NoteInput {
  text: string;
}

/** A trivial governed tool for gate tests: appends text to a shared array. */
export function noteTool(cls: GovernedTool["class"], sink: string[], extra: Partial<GovernedTool<NoteInput>> = {}): GovernedTool<NoteInput> {
  return {
    name: `note_${cls}`,
    title: `Note (${cls})`,
    class: cls,
    summary: "Append a note.",
    why: "This changes a shared list",
    returns: '{status:"ok", note}',
    inputSchema: {
      type: "object",
      properties: { text: { type: "string", description: "The note." } },
      required: ["text"],
      additionalProperties: false,
    },
    validate(input: unknown) {
      const text = (input as Partial<NoteInput> | null)?.text;
      if (typeof text !== "string" || text.length === 0) return { ok: false, errors: ["text is required"] };
      return { ok: true, value: { text } };
    },
    effect: (input) => `Append "${input.text}"`,
    confirmation: () => "12.50",
    run(input): OkResult {
      sink.push(input.text);
      return { status: "ok", note: input.text };
    },
    ...extra,
  };
}
