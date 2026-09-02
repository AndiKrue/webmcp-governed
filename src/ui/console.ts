// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Andreas Krueger
// This file is part of Ask First, a WebMCP demo. See LICENSE.

// A stand-in for an agent, shown only with `?console=1`. It invokes tools through
// `document.modelContext.executeTool` when the browser offers it; otherwise through the registered
// definition's `execute`, which goes through the same gate.
//
// Argument shape: the WebMCP draft IDL passes `input` as an object, but Chrome 150 expects a JSON
// string and rejects an object with UnknownError "Failed to parse input arguments". Against a native
// API the console therefore sends the string form first and falls back to the object form; against
// the page's own polyfill it sends the object form.

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

export function mountConsole(container: HTMLElement, registry: ToolRegistry): { update(): void } {
  const section = el("section", "console panel");
  section.id = "console";
  section.setAttribute("aria-label", "Tool console");
  section.append(el("h2", undefined, "Tool console"));
  section.append(el("p", "muted", "Stands in for an agent. Calls go through document.modelContext.executeTool when the browser provides it, otherwise through the registered definition, on the same gate path."));
  const pickLabel = el("label", undefined, "Tool");
  pickLabel.htmlFor = "console-tool";
  const pick = el("select");
  pick.id = "console-tool";
  const form = el("div", "console-form");
  form.id = "console-form";
  const path = el("p", "muted");
  path.id = "console-path";
  const invoke = el("button", "btn", "Invoke");
  invoke.type = "button";
  invoke.id = "console-invoke";
  const abort = el("button", "btn btn-outline", "Cancel call (abort signal)");
  abort.type = "button";
  abort.id = "console-abort";
  abort.disabled = true;
  const status = el("p", "muted");
  status.id = "console-status";
  const output = el("pre", "console-output");
  output.id = "console-output";
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
    fields = buildFields(tool?.inputSchema, form, "console");
    const mc = document.modelContext;
    path.textContent = typeof mc?.executeTool === "function"
      ? `Path: document.modelContext.executeTool${mc.__polyfill ? " (polyfill, object argument)" : " (native: JSON string argument first, object on UnknownError)"}`
      : "Path: registered definition's execute (no executeTool available)";
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

  let lastPath = "";

  /** Invokes a tool the way an agent would; returns the raw JSON string the agent would receive. */
  async function invokeTool(tool: ModelContextTool, input: unknown, signal: AbortSignal): Promise<string> {
    const mc = document.modelContext;
    if (mc && typeof mc.executeTool === "function" && typeof mc.getTools === "function") {
      const registered = (await mc.getTools()).find((t) => t.name === tool.name);
      if (!registered) throw new Error(`${tool.name} is not registered with the browser`);
      if (mc.__polyfill) {
        lastPath = "document.modelContext.executeTool (polyfill, object argument)";
        return mc.executeTool(registered, input, { signal });
      }
      try {
        const raw = await mc.executeTool(registered, JSON.stringify(input), { signal });
        lastPath = "document.modelContext.executeTool (native, JSON string argument)";
        return raw;
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "UnknownError")) throw error;
        const raw = await mc.executeTool(registered, input, { signal });
        lastPath = "document.modelContext.executeTool (native, object argument after the string form was rejected)";
        return raw;
      }
    }
    lastPath = "registered definition's execute (no executeTool available)";
    const value = await tool.execute(JSON.parse(JSON.stringify(input)), { signal });
    return JSON.stringify(value === undefined ? null : value);
  }

  // Lets the e2e test drive the console path in browsers whose native API has no executeTool.
  (window as unknown as { __consoleInvoke?: unknown }).__consoleInvoke = (name: string, input: unknown, signal?: AbortSignal) => {
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
      path.textContent = `Path: ${lastPath}`;
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
    controller?.abort(new DOMException("cancelled from the console", "AbortError"));
  });

  update();
  return { update };
}
