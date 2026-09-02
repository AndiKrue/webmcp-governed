// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Andreas Krueger
// This file is part of Governed Tool Calls, a WebMCP demo. See LICENSE.

import type { ApiMode } from "../webmcp/types";

export interface DiagnosticsState {
  api: ApiMode;
  apiDetail: string;
  transport: string;
  tools: string[];
  pending: number;
  lastToolChange: string | null;
  url: string;
  userAgent: string;
}

export interface DiagnosticsView {
  root: HTMLElement;
  update(): void;
  toggle(): void;
}

export function mountDiagnostics(container: HTMLElement, read: () => DiagnosticsState): DiagnosticsView {
  const root = document.createElement("section");
  root.className = "diagnostics";
  root.id = "diagnostics";
  root.hidden = true;
  root.setAttribute("aria-label", "Diagnostics");

  const heading = document.createElement("h2");
  heading.textContent = "Diagnostics";
  const list = document.createElement("dl");
  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "btn btn-outline";
  copy.textContent = "Copy diagnostics";
  const note = document.createElement("span");
  note.className = "muted";
  copy.addEventListener("click", async () => {
    const text = JSON.stringify(read(), null, 2);
    try {
      await navigator.clipboard.writeText(text);
      note.textContent = "copied";
    } catch {
      note.textContent = "clipboard unavailable; see below";
      pre.textContent = text;
      pre.hidden = false;
    }
  });
  const pre = document.createElement("pre");
  pre.hidden = true;
  root.append(heading, list, copy, note, pre);
  container.append(root);

  function row(label: string, value: string): void {
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = value;
    list.append(dt, dd);
  }

  function update(): void {
    const state = read();
    list.replaceChildren();
    row("API", `${state.api} (${state.apiDetail})`);
    row("Transport", state.transport);
    row("Registered tools", state.tools.length ? state.tools.join(", ") : "none");
    row("Pending proposals", String(state.pending));
    row("Last toolchange", state.lastToolChange ?? "never");
    row("URL", state.url);
  }

  return {
    root,
    update,
    toggle() {
      root.hidden = !root.hidden;
      if (!root.hidden) update();
    },
  };
}
