// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Andreas Krueger
// This file is part of Governed Tool Calls, a WebMCP demo. See LICENSE.

// A stand-in for an agent, shown only with `?harness=1`. It invokes tools through
// `document.modelContext.executeTool` when the browser offers it; otherwise through the registered
// definition's `execute`, which goes through the same gate.

import type { ToolRegistry } from "../webmcp/register";
import type { JsonSchema, ModelContextTool } from "../webmcp/types";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

type Field = { name: string; schema: JsonSchema; control: HTMLInputElement | HTMLSelectElement };

function buildFields(schema: JsonSchema | undefined, into: HTMLElement, prefix: string): Field[] {
  const fields: Field[] = [];
  const required = new Set(schema?.required ?? []);
  for (const [name, property] of Object.entries(schema?.properties ?? {})) {
    const id = `${prefix}-${name}`;
    const label = el("label", undefined, `${name}${required.has(name) ? " *" : ""}`);
    label.htmlFor = id;
    const help = el("span", "muted", ` ${property.description ?? ""}`);
    label.append(help);
    let control: HTMLInputElement | HTMLSelectElement;
    if (property.enum) {
      control = el("select");
      control.append(el("option", undefined, "(unset)"));
      for (const value of property.enum) {
        const option = el("option", undefined, value);
        option.value = value;
        control.append(option);
      }
    } else if (property.type === "number" || property.type === "integer") {
      control = el("input");
      control.type = "number";
    } else if (property.type === "array") {
      control = el("input");
      control.type = "text";
      control.placeholder = "comma-separated, e.g. E-001, E-002";
    } else {
      control = el("input");
      control.type = "text";
    }
    control.id = id;
    into.append(label, control);
    fields.push({ name, schema: property, control });
  }
  return fields;
}

function readFields(fields: Field[]): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  for (const { name, schema, control } of fields) {
    const raw = control.value.trim();
    if (raw === "" || (control instanceof HTMLSelectElement && control.selectedIndex === 0)) continue;
    if (schema.type === "number" || schema.type === "integer") input[name] = Number(raw);
    else if (schema.type === "array") input[name] = raw.split(",").map((s) => s.trim()).filter(Boolean);
    else input[name] = raw;
  }
  return input;
}

export function mountHarness(container: HTMLElement, registry: ToolRegistry): { update(): void } {
  const section = el("section", "harness panel");
  section.id = "harness";
  section.setAttribute("aria-label", "Agent harness");
  section.append(el("h2", undefined, "Agent harness"));
  section.append(el("p", "muted", "Stands in for an agent. Calls go through document.modelContext.executeTool when the browser provides it, otherwise through the registered definition, on the same gate path."));
  const pickLabel = el("label", undefined, "Tool");
  pickLabel.htmlFor = "harness-tool";
  const pick = el("select");
  pick.id = "harness-tool";
  const form = el("div", "harness-form");
  form.id = "harness-form";
  const path = el("p", "muted");
  path.id = "harness-path";
  const invoke = el("button", "btn", "Invoke");
  invoke.type = "button";
  invoke.id = "harness-invoke";
  const abort = el("button", "btn btn-outline", "Cancel call (abort signal)");
  abort.type = "button";
  abort.id = "harness-abort";
  abort.disabled = true;
  const status = el("p", "muted");
  status.id = "harness-status";
  const output = el("pre", "harness-output");
  output.id = "harness-output";
  const actions = el("div", "card-actions");
  actions.append(invoke, abort);
  section.append(pickLabel, pick, form, path, actions, status, output);
  container.append(section);

  let fields: Field[] = [];
  let controller: AbortController | null = null;

  function current(): ModelContextTool | undefined {
    return registry.definitions.get(pick.value);
  }

  function rebuild(): void {
    form.replaceChildren();
    const tool = current();
    fields = buildFields(tool?.inputSchema, form, "harness");
    const native = typeof document.modelContext?.executeTool === "function";
    path.textContent = native
      ? "Path: document.modelContext.executeTool"
      : "Path: registered definition's execute (browser exposes no executeTool)";
  }

  function update(): void {
    const selected = pick.value;
    pick.replaceChildren();
    for (const name of registry.names) {
      const option = el("option", undefined, name);
      option.value = name;
      pick.append(option);
    }
    if (registry.names.includes(selected)) pick.value = selected;
    rebuild();
  }

  pick.addEventListener("change", rebuild);

  /** Invokes a tool the way an agent would; returns the raw JSON string the agent would receive. */
  async function invokeTool(tool: ModelContextTool, input: unknown, signal: AbortSignal): Promise<string> {
    const mc = document.modelContext;
    if (mc && typeof mc.executeTool === "function" && typeof mc.getTools === "function") {
      const registered = (await mc.getTools()).find((t) => t.name === tool.name);
      if (!registered) throw new Error(`${tool.name} is not registered with the browser`);
      return mc.executeTool(registered, input, { signal });
    }
    const value = await tool.execute(JSON.parse(JSON.stringify(input)), { signal });
    return JSON.stringify(value === undefined ? null : value);
  }

  // Lets the e2e test drive the harness path in browsers whose native API has no executeTool.
  (window as unknown as { __harnessInvoke?: unknown }).__harnessInvoke = (name: string, input: unknown, signal?: AbortSignal) => {
    const tool = registry.definitions.get(name);
    if (!tool) return Promise.reject(new Error(`unknown tool ${name}`));
    return invokeTool(tool, input, signal ?? new AbortController().signal);
  };

  invoke.addEventListener("click", async () => {
    const tool = current();
    if (!tool) return;
    const input = readFields(fields);
    controller = new AbortController();
    abort.disabled = false;
    invoke.disabled = true;
    status.textContent = `Calling ${tool.name} with ${JSON.stringify(input)} …`;
    output.textContent = "";
    const started = performance.now();
    try {
      const raw = await invokeTool(tool, input, controller.signal);
      output.textContent = JSON.stringify(JSON.parse(raw), null, 2);
      status.textContent = `Resolved after ${Math.round(performance.now() - started)} ms`;
    } catch (error) {
      output.textContent = String(error);
      status.textContent = `Rejected after ${Math.round(performance.now() - started)} ms`;
    } finally {
      controller = null;
      abort.disabled = true;
      invoke.disabled = false;
    }
  });

  abort.addEventListener("click", () => {
    controller?.abort(new DOMException("cancelled from the harness", "AbortError"));
  });

  update();
  return { update };
}
