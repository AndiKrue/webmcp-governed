// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Andreas Krueger
// This file is part of Governed Tool Calls, a WebMCP demo. See LICENSE.

export type TransportName = "hold" | "two-call";

/**
 * The transport used when the URL does not say otherwise.
 * "hold": a gated `execute` promise stays pending until the human decides (spec-conformant).
 * "two-call": `execute` returns a token at once; the agent commits it after the human decides.
 * Flip this only if a real WebMCP client is shown to abandon held calls.
 */
export const DEFAULT_TRANSPORT: TransportName = "hold";

export function resolveTransport(search: string): TransportName {
  const value = new URLSearchParams(search).get("transport");
  if (value === "hold" || value === "two-call") return value;
  return DEFAULT_TRANSPORT;
}
