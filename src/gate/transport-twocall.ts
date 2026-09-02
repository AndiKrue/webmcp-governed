// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Andreas Krueger
// This file is part of Ask First, a WebMCP demo. See LICENSE.

// The fallback transport for clients that will not hold an `execute` promise open: a gated call
// resolves at once with an approval token; the agent asks the human to decide on the page and then
// calls `commit_approved_action` with the token. Tokens are single-use and live until reload.

import { describeOpen, INVALID_GUIDANCE, REFUSAL_GUIDANCE } from "./gate";
import type { Gate, GovernedTool, Proposal, ToolResult, Transport } from "./gate";

export const COMMIT_TOOL_NAME = "commit_approved_action";

export const COMMIT_INSTRUCTION =
  "Ask the user to decide on the page, then call commit_approved_action with this token.";

function pendingResult(proposal: Proposal): ToolResult {
  return {
    status: "pending_approval",
    approval_token: proposal.token,
    instruction: COMMIT_INSTRUCTION,
    receipt_id: proposal.id,
  };
}

interface CommitInput {
  approval_token: string;
}

export function commitApprovedActionTool(gate: Gate): GovernedTool<CommitInput> {
  return {
    name: COMMIT_TOOL_NAME,
    title: "Commit approved action",
    class: "open",
    summary: "Collect the outcome of a proposal the human was asked to decide on the page.",
    returns: "the committed tool's own result",
    inputSchema: {
      type: "object",
      properties: {
        approval_token: {
          type: "string",
          description: "The approval_token from a {status:\"pending_approval\"} result.",
        },
      },
      required: ["approval_token"],
      additionalProperties: false,
    },
    validate(input: unknown) {
      const token = (input as Partial<CommitInput> | null)?.approval_token;
      if (typeof token !== "string" || token.length === 0) {
        return { ok: false, errors: ["approval_token is required"] };
      }
      return { ok: true, value: { approval_token: token } };
    },
    effect: () => "Commit an approved action",
    run(input) {
      // Never reached: `passthrough` answers instead, because the result belongs to the proposal.
      return { status: "ok", approval_token: input.approval_token };
    },
    passthrough: (input) => commit(gate, input.approval_token),
  };
}

/** Resolves the underlying proposal's result for a token; see the transport description. */
export function commit(gate: Gate, token: string): ToolResult {
  const proposal = gate.byToken(token);
  if (!proposal || proposal.consumed) {
    return { status: "invalid", errors: ["unknown or already used approval_token"], receipt_id: null };
  }
  if (proposal.state === "pending") return pendingResult(proposal);
  proposal.consumed = true;
  return proposal.result ?? { status: "invalid", errors: ["proposal has no result"], receipt_id: proposal.id };
}

export const twoCallTransport: Transport = {
  name: "two-call",

  async respond(_gate: Gate, proposal: Proposal): Promise<ToolResult> {
    return pendingResult(proposal);
  },

  describe(tool: GovernedTool): string {
    if (tool.name === COMMIT_TOOL_NAME) {
      return (
        `${tool.summary} Call it with the approval_token you received. If the human approved you ` +
        `receive the committed tool's own {status:"ok", ...} result; if they declined you receive ` +
        `{status:"declined", reason, retry_hint}; if they have not decided yet you receive ` +
        `{status:"pending_approval"} again and may call again later; an unknown or already used token ` +
        `resolves {status:"invalid"}. ${REFUSAL_GUIDANCE}`
      );
    }
    if (tool.class === "open") return describeOpen(tool);
    const irreversible = tool.class === "sealed"
      ? " This action is irreversible, so the human must also type the amount to confirm."
      : "";
    return (
      `${tool.summary} ${tool.why ?? "This changes shared state"}, so the page asks the human for ` +
      `approval before applying it. This call returns at once with {status:"pending_approval", ` +
      `approval_token, instruction}; nothing has happened yet.${irreversible} Ask the user to decide ` +
      `on the page, then call ${COMMIT_TOOL_NAME} with the token. If approved you then receive ` +
      `${tool.returns}. ${REFUSAL_GUIDANCE} ${INVALID_GUIDANCE}`
    );
  },

  extraTools(gate: Gate): GovernedTool[] {
    return [commitApprovedActionTool(gate)];
  },
};
