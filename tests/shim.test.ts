// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Andreas Krueger
// This file is part of Governed Tool Calls, a WebMCP demo. See LICENSE.

// Per-method completion of a partial native `modelContext` (Chrome 148 behind its flag exposes only
// `registerTool`). Native `registerTool` must still receive every registration.

import { afterEach, describe, expect, it } from "vitest";
import { installModelContext } from "../src/webmcp/polyfill";
import type { ModelContext } from "../src/webmcp/types";

function withDocumentModelContext(value: unknown): void {
  Object.defineProperty(document, "modelContext", { value, configurable: true, writable: true });
}

afterEach(() => {
  withDocumentModelContext(undefined);
});

describe("installModelContext", () => {
  it("installs the full polyfill when the browser offers nothing", async () => {
    const report = installModelContext(true);
    expect(report).toEqual({ mode: "polyfill", native: [], shimmed: ["registerTool", "getTools", "executeTool", "addEventListener"] });
    expect(document.modelContext?.__polyfill).toBe(true);
  });

  it("installs nothing with the polyfill disabled", () => {
    expect(installModelContext(false)).toEqual({ mode: "none", native: [], shimmed: [] });
    expect(document.modelContext).toBeUndefined();
  });

  it("leaves a complete native object untouched", () => {
    const calls: string[] = [];
    const complete = {
      registerTool: async () => { calls.push("register"); return undefined; },
      getTools: async () => [],
      executeTool: async () => "null",
      addEventListener: () => {},
    };
    withDocumentModelContext(complete);
    const report = installModelContext(true);
    expect(report.mode).toBe("native");
    expect(report.shimmed).toEqual([]);
    expect(document.modelContext).toBe(complete);
    expect((document.modelContext as unknown as { registerTool: unknown }).registerTool).toBe(complete.registerTool);
  });

  it("completes a registerTool-only native object and keeps native registerTool in the loop", async () => {
    const nativeSeen: string[] = [];
    class ModelContextLike {
      registerTool(tool: { name: string }): undefined {
        if (nativeSeen.includes(tool.name)) throw new DOMException("Duplicate tool name", "InvalidStateError");
        nativeSeen.push(tool.name);
        return undefined;
      }
    }
    const partial = new ModelContextLike();
    withDocumentModelContext(partial);
    const report = installModelContext(true);
    expect(report).toEqual({ mode: "native", native: ["registerTool"], shimmed: ["getTools", "executeTool", "addEventListener"] });
    const mc = document.modelContext as ModelContext;
    expect(mc).toBe(partial);
    expect(mc.__polyfill).toBeUndefined();

    let changes = 0;
    mc.addEventListener("toolchange", () => { changes += 1; });
    const controller = new AbortController();
    await mc.registerTool({ name: "beta", description: "b", execute: (input) => ({ got: input }) }, { signal: controller.signal });
    await mc.registerTool({ name: "alpha", description: "a", annotations: { readOnlyHint: true }, execute: () => 1 });
    expect(nativeSeen).toEqual(["beta", "alpha"]);
    await expect(mc.registerTool({ name: "alpha", description: "dup", execute: () => 1 })).rejects.toThrow();
    const tools = await mc.getTools();
    expect(tools.map((t) => t.name)).toEqual(["alpha", "beta"]);
    expect(JSON.parse(await mc.executeTool(tools[1]!, { x: 1 }))).toEqual({ got: { x: 1 } });
    controller.abort();
    expect((await mc.getTools()).map((t) => t.name)).toEqual(["alpha"]);
    expect(changes).toBeGreaterThanOrEqual(3);
    let viaProperty = 0;
    mc.ontoolchange = () => { viaProperty += 1; };
    await mc.registerTool({ name: "gamma", description: "g", execute: () => 1 });
    expect(viaProperty).toBeGreaterThanOrEqual(1);
  });

  it("aliases navigator.modelContext onto document and completes it too", async () => {
    const nav = { registerTool: async () => undefined };
    Object.defineProperty(navigator, "modelContext", { value: nav, configurable: true, writable: true });
    try {
      const report = installModelContext(true);
      expect(report.mode).toBe("aliased");
      expect(report.shimmed).toContain("executeTool");
      expect(document.modelContext).toBe(nav);
      await (document.modelContext as ModelContext).registerTool({ name: "x", description: "x", execute: () => 1 });
      expect((await (document.modelContext as ModelContext).getTools()).map((t) => t.name)).toEqual(["x"]);
    } finally {
      Object.defineProperty(navigator, "modelContext", { value: undefined, configurable: true, writable: true });
    }
  });
});
