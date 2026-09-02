// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Andreas Krueger
// This file is part of Ask First, a WebMCP demo. See LICENSE.

// A small, dependency-free implementation of the `document.modelContext` surface described by the
// WebMCP draft (https://webmachinelearning.github.io/webmcp/). It exists so the page works without an
// agent attached: the in-page console and the tests drive tools through the same methods a real
// client would call. Installed in full only when the browser offers nothing. When the browser offers
// a partial object (Chrome 148 behind its flag has `registerTool` only), each missing method is added
// on top of the native one, and native `registerTool` still receives every registration.

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

type NativeRegister = (tool: ModelContextTool, options?: ModelContextRegisterOptions) => unknown;

class ModelContextPolyfill extends EventTarget implements ModelContext {
  readonly __polyfill = true;
  #tools = new Map<string, ModelContextTool>();
  #ontoolchange: ((this: ModelContext, ev: Event) => unknown) | null = null;
  #nativeRegister: NativeRegister | null;

  /** With a native `registerTool`, registrations go there first and are mirrored here. */
  constructor(nativeRegister: NativeRegister | null = null) {
    super();
    this.#nativeRegister = nativeRegister;
  }

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
    if (this.#nativeRegister) await this.#nativeRegister(tool, options);
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
    // The draft IDL takes an object; Chrome 150 takes a JSON string. Accept both.
    let parsed: unknown;
    if (typeof input === "string") {
      try {
        parsed = JSON.parse(input);
      } catch {
        return Promise.reject(new DOMException("Failed to parse input arguments", "UnknownError"));
      }
    } else {
      parsed = input ?? {};
    }
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
        .then(() => tool.execute(deepCopy(parsed), { signal: controller.signal }))
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

export const API_METHODS = ["registerTool", "getTools", "executeTool", "addEventListener"] as const;

export interface ApiReport {
  mode: ApiMode;
  /** Methods the browser provided itself. */
  native: string[];
  /** Methods this file added on top of a partial native object. */
  shimmed: string[];
}

function methodsOf(target: object): string[] {
  return API_METHODS.filter((m) => typeof (target as Record<string, unknown>)[m] === "function");
}

function define(target: object, name: string, value: unknown): void {
  Object.defineProperty(target, name, { value, configurable: true, writable: true });
}

/** Adds whatever a partial native `modelContext` lacks, keeping native `registerTool` in the loop. */
function completeNative(native: ModelContext): { native: string[]; shimmed: string[] } {
  const present = methodsOf(native);
  const missing = API_METHODS.filter((m) => !present.includes(m));
  if (missing.length === 0) return { native: present, shimmed: [] };
  const nativeRegister = present.includes("registerTool") ? native.registerTool.bind(native) : null;
  const shim = new ModelContextPolyfill(nativeRegister);
  // Every registration must pass through the shim so its shadow registry can answer the rest.
  define(native, "registerTool", shim.registerTool.bind(shim));
  if (missing.includes("getTools")) define(native, "getTools", shim.getTools.bind(shim));
  if (missing.includes("executeTool")) define(native, "executeTool", shim.executeTool.bind(shim));
  if (missing.includes("addEventListener")) {
    define(native, "addEventListener", shim.addEventListener.bind(shim));
    define(native, "removeEventListener", shim.removeEventListener.bind(shim));
    define(native, "dispatchEvent", shim.dispatchEvent.bind(shim));
    Object.defineProperty(native, "ontoolchange", {
      configurable: true,
      get: () => shim.ontoolchange,
      set: (handler) => {
        shim.ontoolchange = handler;
      },
    });
  }
  return { native: present, shimmed: [...missing] };
}

/**
 * Makes `document.modelContext` available. Native wins and is completed per method if partial;
 * `navigator.modelContext` is aliased onto the document; the full polyfill is installed only when
 * both are missing and `allowPolyfill` is true.
 */
export function installModelContext(allowPolyfill: boolean): ApiReport {
  const existing = document.modelContext;
  if (existing) {
    if (existing.__polyfill) return { mode: "polyfill", native: [], shimmed: [...API_METHODS] };
    return { mode: "native", ...completeNative(existing) };
  }
  if (navigator.modelContext) {
    Object.defineProperty(document, "modelContext", { value: navigator.modelContext, configurable: true });
    return { mode: "aliased", ...completeNative(navigator.modelContext) };
  }
  if (!allowPolyfill) return { mode: "none", native: [], shimmed: [] };
  Object.defineProperty(document, "modelContext", { value: new ModelContextPolyfill(), configurable: true });
  return { mode: "polyfill", native: [], shimmed: [...API_METHODS] };
}

export function createPolyfill(): ModelContext {
  return new ModelContextPolyfill();
}
