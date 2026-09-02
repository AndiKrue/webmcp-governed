// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Andreas Krueger
// This file is part of Governed Tool Calls, a WebMCP demo. See LICENSE.

// Registers tool definitions with the browser's WebMCP surface and keeps the definitions around, so
// the in-page harness can reach them even when the browser offers no `executeTool`.

import type { ModelContextTool } from "./types";

interface Registration {
  definition: ModelContextTool;
  controller: AbortController;
}

export class ToolRegistry {
  #entries = new Map<string, Registration>();

  /** Registered definitions by name, in registration order. */
  get definitions(): ReadonlyMap<string, ModelContextTool> {
    return new Map([...this.#entries].map(([name, entry]) => [name, entry.definition]));
  }

  get names(): string[] {
    return [...this.#entries.keys()];
  }

  async register(tool: ModelContextTool): Promise<void> {
    if (!document.modelContext) throw new Error("document.modelContext is not available");
    if (this.#entries.has(tool.name)) this.unregister(tool.name);
    const controller = new AbortController();
    const registration: ModelContextTool = {
      name: tool.name,
      description: tool.description,
      execute: tool.execute,
    };
    if (tool.title !== undefined) registration.title = tool.title;
    if (tool.inputSchema !== undefined) registration.inputSchema = tool.inputSchema;
    if (tool.annotations !== undefined) registration.annotations = tool.annotations;
    // The literal below is the registration call the WebMCP Challenge looks for.
    await document.modelContext.registerTool({
      ...registration,
    }, { signal: controller.signal });
    this.#entries.set(tool.name, { definition: tool, controller });
  }

  async registerAll(tools: ModelContextTool[]): Promise<void> {
    for (const tool of tools) await this.register(tool);
  }

  /** Aborting the registration signal unregisters the tool in the browser. */
  unregister(name: string): void {
    const entry = this.#entries.get(name);
    if (!entry) return;
    entry.controller.abort();
    this.#entries.delete(name);
  }

  unregisterAll(): void {
    for (const name of [...this.#entries.keys()]) this.unregister(name);
  }
}
