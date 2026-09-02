// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Andreas Krueger
// This file is part of Governed Tool Calls, a WebMCP demo. See LICENSE.

// A small, dependency-free implementation of the `document.modelContext` surface described by the
// WebMCP draft (https://webmachinelearning.github.io/webmcp/). It exists so the page works without an
// agent attached: the in-page harness and the tests drive tools through the same methods a real
// client would call. Installed only when the browser offers nothing.

import type {
  ApiMode,
  ModelContext,
  ModelContextExecuteToolOptions,
  ModelContextGetToolsOptions,
  ModelContextRegisterOptions,
  ModelContextTool,
  RegisteredTool,
} from "./types";

const NAME_PATTERN = /^[A-Za-z0-9_.-]{1,128}$/;

function deepCopy<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
}

class ModelContextPolyfill extends EventTarget implements ModelContext {
  readonly __polyfill = true;
  #tools = new Map<string, ModelContextTool>();
  #ontoolchange: ((this: ModelContext, ev: Event) => unknown) | null = null;

  get ontoolchange(): ((this: ModelContext, ev: Event) => unknown) | null {
    return this.#ontoolchange;
  }

  set ontoolchange(handler: ((this: ModelContext, ev: Event) => unknown) | null) {
    if (this.#ontoolchange) this.removeEventListener("toolchange", this.#ontoolchange as EventListener);
    this.#ontoolchange = handler;
    if (handler) this.addEventListener("toolchange", handler as EventListener);
  }

  async registerTool(tool: ModelContextTool, options: ModelContextRegisterOptions = {}): Promise<undefined> {
    if (options.signal?.aborted) throw abortReason(options.signal);
    if (typeof tool?.name !== "string" || !NAME_PATTERN.test(tool.name)) {
      throw new TypeError(`Invalid tool name: ${JSON.stringify(tool?.name)}`);
    }
    if (typeof tool.description !== "string" || tool.description.length === 0) {
      throw new TypeError(`Tool ${tool.name} needs a non-empty description`);
    }
    if (typeof tool.execute !== "function") {
      throw new TypeError(`Tool ${tool.name} needs an execute function`);
    }
    if (this.#tools.has(tool.name)) {
      throw new DOMException(`A tool named ${tool.name} is already registered`, "InvalidStateError");
    }
    const stored: ModelContextTool = {
      name: tool.name,
      description: tool.description,
      execute: tool.execute,
    };
    if (tool.title !== undefined) stored.title = tool.title;
    if (tool.inputSchema !== undefined) stored.inputSchema = deepCopy(tool.inputSchema);
    if (tool.annotations !== undefined) stored.annotations = { ...tool.annotations };
    this.#tools.set(tool.name, stored);
    options.signal?.addEventListener(
      "abort",
      () => {
        if (this.#tools.get(tool.name) === stored) {
          this.#tools.delete(tool.name);
          this.dispatchEvent(new Event("toolchange"));
        }
      },
      { once: true },
    );
    this.dispatchEvent(new Event("toolchange"));
    return undefined;
  }

  async getTools(_options: ModelContextGetToolsOptions = {}): Promise<RegisteredTool[]> {
    return [...this.#tools.values()]
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .map((tool) => {
        const entry: RegisteredTool = {
          name: tool.name,
          description: tool.description,
          window,
          origin: location.origin,
        };
        if (tool.title !== undefined) entry.title = tool.title;
        if (tool.inputSchema !== undefined) entry.inputSchema = deepCopy(tool.inputSchema);
        if (tool.annotations !== undefined) entry.annotations = { ...tool.annotations };
        return entry;
      });
  }

  executeTool(
    registered: RegisteredTool,
    input: unknown,
    options: ModelContextExecuteToolOptions = {},
  ): Promise<string> {
    const tool = this.#tools.get(registered?.name);
    if (!tool) {
      return Promise.reject(new DOMException(`No tool named ${registered?.name}`, "NotFoundError"));
    }
    const caller = options.signal;
    if (caller?.aborted) return Promise.reject(abortReason(caller));
    const controller = new AbortController();
    return new Promise<string>((resolve, reject) => {
      caller?.addEventListener(
        "abort",
        () => {
          controller.abort(abortReason(caller));
          reject(abortReason(caller));
        },
        { once: true },
      );
      Promise.resolve()
        .then(() => tool.execute(deepCopy(input ?? {}), { signal: controller.signal }))
        .then(
          (value) => resolve(JSON.stringify(value === undefined ? null : value)),
          (error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            reject(new DOMException(message, "UnknownError"));
          },
        );
    });
  }
}

/**
 * Makes `document.modelContext` available. Native wins; `navigator.modelContext` is aliased onto the
 * document; the polyfill is installed only when both are missing and `allowPolyfill` is true.
 */
export function installModelContext(allowPolyfill: boolean): ApiMode {
  if (document.modelContext) return document.modelContext.__polyfill ? "polyfill" : "native";
  if (navigator.modelContext) {
    Object.defineProperty(document, "modelContext", { value: navigator.modelContext, configurable: true });
    return "aliased";
  }
  if (!allowPolyfill) return "none";
  Object.defineProperty(document, "modelContext", { value: new ModelContextPolyfill(), configurable: true });
  return "polyfill";
}

export function createPolyfill(): ModelContext {
  return new ModelContextPolyfill();
}
