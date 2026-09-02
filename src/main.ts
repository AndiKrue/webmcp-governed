// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Andreas Krueger
// This file is part of Governed Tool Calls, a WebMCP demo. See LICENSE.

// Entry point: detect the WebMCP surface, build the gate, register the tools, mount the page.

import { Store } from "./data/fixture";
import { resolveTransport, type TransportName } from "./gate/config";
import { Gate, type Transport } from "./gate/gate";
import { holdTransport } from "./gate/transport-hold";
import { twoCallTransport } from "./gate/transport-twocall";
import { Ledger } from "./ledger/ledger";
import { createTools } from "./tools";
import { mountCards } from "./ui/card";
import { mountDiagnostics } from "./ui/diagnostics";
import { mountHarness } from "./ui/harness";
import { mountLedgerView } from "./ui/ledger-view";
import { mountTable } from "./ui/table";
import { installModelContext } from "./webmcp/polyfill";
import { ToolRegistry } from "./webmcp/register";
import type { ApiMode } from "./webmcp/types";

const TRANSPORTS: Record<TransportName, Transport> = { hold: holdTransport, "two-call": twoCallTransport };

const params = new URLSearchParams(location.search);
const api: ApiMode = installModelContext(params.get("nopolyfill") !== "1");
const store = new Store();
const ledger = new Ledger();
const gate = new Gate({ ledger, transport: TRANSPORTS[resolveTransport(location.search)], api });
const registry = new ToolRegistry();
let lastToolChange: string | null = null;

if (typeof document.modelContext?.addEventListener === "function") {
  document.modelContext.addEventListener("toolchange", () => {
    lastToolChange = new Date().toISOString();
  });
}

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

function badge(text: string, className: string): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = `badge ${className}`;
  span.textContent = text;
  return span;
}

function renderBadges(): void {
  const badges = document.getElementById("status-badges");
  if (!badges) return;
  badges.replaceChildren(
    badge(
      api === "native" || api === "aliased" ? "native WebMCP" : api === "polyfill" ? "polyfill — no agent attached" : "no WebMCP API",
      `badge-${api}`,
    ),
    badge(`transport: ${gate.transport.name}`, "badge-transport"),
  );
}

/** Registers the seven tools plus whatever the transport needs, unregistering any previous set. */
async function registerTools(): Promise<void> {
  registry.unregisterAll();
  if (!document.modelContext) return;
  const tools = [...createTools(store), ...gate.transport.extraTools(gate)];
  await registry.registerAll(tools.map((tool) => gate.toModelContextTool(tool)));
}

async function switchTransport(name: TransportName): Promise<void> {
  if (gate.transport.name === name) return;
  gate.setTransport(TRANSPORTS[name]);
  await registerTools();
  const url = new URL(location.href);
  url.searchParams.set("transport", name);
  history.replaceState(null, "", url);
  renderBadges();
}

async function boot(): Promise<void> {
  renderBadges();
  const main = document.getElementById("main-panel");
  const side = document.getElementById("side-panel");
  const footer = document.getElementById("site-footer");
  if (!main || !side || !footer) return;

  mountTable(main, store);
  mountCards(side, gate);
  mountLedgerView(side, ledger);
  const diagnostics = mountDiagnostics(side, () => ({
    api,
    apiDetail: apiDetail(api),
    transport: gate.transport.name,
    tools: registry.names,
    pending: gate.pending.length,
    lastToolChange,
    url: location.href,
    userAgent: navigator.userAgent,
  }));
  gate.subscribe(() => diagnostics.update());

  const harness = params.get("harness") === "1" ? mountHarness(main, registry) : null;

  const reset = document.createElement("button");
  reset.type = "button";
  reset.className = "btn btn-outline";
  reset.id = "reset";
  reset.textContent = "Reset to fixture";
  reset.addEventListener("click", () => {
    gate.reset();
    store.reset();
    ledger.reset();
  });

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "btn btn-link";
  toggle.id = "diagnostics-toggle";
  toggle.textContent = "Diagnostics";
  toggle.setAttribute("aria-controls", "diagnostics");
  toggle.addEventListener("click", () => diagnostics.toggle());

  const transportLabel = document.createElement("label");
  transportLabel.textContent = "Transport ";
  const transportSelect = document.createElement("select");
  transportSelect.id = "transport-select";
  for (const name of Object.keys(TRANSPORTS) as TransportName[]) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    transportSelect.append(option);
  }
  transportSelect.value = gate.transport.name;
  transportSelect.addEventListener("change", () => {
    void switchTransport(transportSelect.value as TransportName).then(() => {
      diagnostics.update();
      harness?.update();
    });
  });
  transportLabel.append(transportSelect);

  const repo = document.createElement("a");
  repo.href = "https://github.com/AndiKrue/webmcp-governed";
  repo.textContent = "Repository";
  footer.append(reset, transportLabel, toggle, repo);

  await registerTools();
  diagnostics.update();
  harness?.update();
  document.body.dataset["ready"] = "1";
}

void boot();
