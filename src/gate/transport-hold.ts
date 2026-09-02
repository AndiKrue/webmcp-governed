// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Andreas Krueger
// This file is part of Ask First, a WebMCP demo. See LICENSE.

// The primary transport: a gated `execute` promise is held open until the human decides on the card.
// The spec defines no timeout for `execute`, so this is conformant; whether a given client waits is
// exactly what the ledger's `latency_ms` and `cancelled_by_caller` rows measure.

import { describeOpen, INVALID_GUIDANCE, REFUSAL_GUIDANCE } from "./gate";
import type { Gate, GovernedTool, Proposal, ToolResult, Transport } from "./gate";

export const holdTransport: Transport = {
  name: "hold",

  respond(_gate: Gate, proposal: Proposal): Promise<ToolResult> {
    return proposal.promise;
  },

  describe(tool: GovernedTool): string {
    if (tool.class === "open") return describeOpen(tool);
    const irreversible = tool.class === "sealed"
      ? " This action is irreversible, so the human must also type the amount to confirm."
      : "";
    return (
      `${tool.summary} ${tool.why ?? "This changes shared state"}, so the page asks the human for ` +
      `approval before applying it: this call waits until they decide.${irreversible} ` +
      `If approved you receive ${tool.returns}. ${REFUSAL_GUIDANCE} ${INVALID_GUIDANCE}`
    );
  },

  extraTools(): GovernedTool[] {
    return [];
  },
};
