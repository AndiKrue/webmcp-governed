// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Andreas Krueger
// This file is part of Governed Tool Calls, a WebMCP demo. See LICENSE.

// Entry point. Phase 1: API detection, one trivial tool, diagnostics.

import { installModelContext } from "./webmcp/polyfill";
import { ToolRegistry } from "./webmcp/register";
import type { ApiMode, ModelContextTool } from "./webmcp/types";
import { mountDiagnostics } from "./ui/diagnostics";

const params = new URLSearchParams(location.search);
const allowPolyfill = params.get("nopolyfill") !== "1";
const api: ApiMode = installModelContext(allowPolyfill);
const transport = params.get("transport") === "two-call" ? "two-call" : "hold";

const registry = new ToolRegistry();
let lastToolChange: string | null = null;
document.modelContext?.addEventListener("toolchange", () => {
  lastToolChange = new Date().toISOString();
});

const pingTool: ModelContextTool = {
  name: "ping",
  title: "Ping",
  description: "Returns the input echoed back with a timestamp. Read-only; runs immediately.",
  inputSchema: {
    type: "object",
    properties: { message: { type: "string", description: "Any text to echo." } },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true },
  execute: (input) => ({ status: "ok", echo: input, ts: new Date().toISOString() }),
};

function apiDetail(mode: ApiMode): string {
  switch (mode) {
    case "native":
      return "document.modelContext provided by the browser";
    case "aliased":
      return "navigator.modelContext aliased onto document";
    case "polyfill":
      return "in-page polyfill, no agent attached";
    case "none":
      return "no API and polyfill disabled";
  }
}

function renderBadges(): void {
  const badges = document.getElementById("status-badges");
  if (!badges) return;
  badges.replaceChildren();
  const apiBadge = document.createElement("span");
  apiBadge.className = `badge badge-${api}`;
  apiBadge.textContent =
    api === "native" || api === "aliased" ? "native WebMCP" : api === "polyfill" ? "polyfill — no agent attached" : "no WebMCP API";
  const transportBadge = document.createElement("span");
  transportBadge.className = "badge badge-transport";
  transportBadge.textContent = `transport: ${transport}`;
  badges.append(apiBadge, transportBadge);
}

async function boot(): Promise<void> {
  renderBadges();
  const footer = document.getElementById("site-footer");
  const side = document.getElementById("side-panel");
  if (!footer || !side) return;

  const diagnostics = mountDiagnostics(side, () => ({
    api,
    apiDetail: apiDetail(api),
    transport,
    tools: registry.names,
    pending: 0,
    lastToolChange,
    url: location.href,
    userAgent: navigator.userAgent,
  }));

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "btn btn-link";
  toggle.textContent = "Diagnostics";
  toggle.setAttribute("aria-controls", "diagnostics");
  toggle.addEventListener("click", () => diagnostics.toggle());
  const repo = document.createElement("a");
  repo.href = "https://github.com/AndiKrue/webmcp-governed";
  repo.textContent = "Repository";
  footer.append(toggle, repo);

  if (document.modelContext) await registry.register(pingTool);
  diagnostics.update();
}

void boot();
