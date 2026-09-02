// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Andreas Krueger
// This file is part of Governed Tool Calls, a WebMCP demo. See LICENSE.

import { describe, expect, it } from "vitest";
import { createPolyfill } from "../src/webmcp/polyfill";

describe("modelContext polyfill", () => {
  it("registers, lists sorted, and executes with a JSON round trip", async () => {
    const mc = createPolyfill();
    const events: string[] = [];
    mc.addEventListener("toolchange", () => events.push("change"));
    await mc.registerTool({ name: "zeta", description: "z", execute: () => ({ z: 1 }) });
    await mc.registerTool({
      name: "alpha",
      description: "a",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      execute: (input) => ({ echo: input }),
    });
    const tools = await mc.getTools();
    expect(tools.map((t) => t.name)).toEqual(["alpha", "zeta"]);
    expect(tools[0]?.annotations).toEqual({ readOnlyHint: true });
    expect(tools[0]?.origin).toBe(location.origin);
    const raw = await mc.executeTool(tools[0]!, { a: 1 });
    expect(JSON.parse(raw)).toEqual({ echo: { a: 1 } });
    expect(events).toHaveLength(2);
    expect(mc.__polyfill).toBe(true);
  });

  it("rejects duplicate, empty and malformed registrations", async () => {
    const mc = createPolyfill();
    await mc.registerTool({ name: "ok_tool", description: "d", execute: () => null });
    await expect(mc.registerTool({ name: "ok_tool", description: "d", execute: () => null })).rejects.toThrow();
    await expect(mc.registerTool({ name: "", description: "d", execute: () => null })).rejects.toThrow();
    await expect(mc.registerTool({ name: "bad name!", description: "d", execute: () => null })).rejects.toThrow();
    await expect(mc.registerTool({ name: "no_desc", description: "", execute: () => null })).rejects.toThrow();
    const aborted = new AbortController();
    aborted.abort();
    await expect(
      mc.registerTool({ name: "late", description: "d", execute: () => null }, { signal: aborted.signal }),
    ).rejects.toBeDefined();
  });

  it("unregisters when the registration signal aborts and fires toolchange", async () => {
    const mc = createPolyfill();
    let changes = 0;
    mc.ontoolchange = () => {
      changes += 1;
    };
    const controller = new AbortController();
    await mc.registerTool({ name: "temp", description: "d", execute: () => null }, { signal: controller.signal });
    expect((await mc.getTools()).map((t) => t.name)).toEqual(["temp"]);
    controller.abort();
    expect(await mc.getTools()).toEqual([]);
    expect(changes).toBe(2);
  });

  it("turns a thrown execute into an opaque UnknownError DOMException", async () => {
    const mc = createPolyfill();
    await mc.registerTool({
      name: "thrower",
      description: "d",
      execute: () => {
        throw new Error("secret reason");
      },
    });
    const [tool] = await mc.getTools();
    await expect(mc.executeTool(tool!, {})).rejects.toMatchObject({ name: "UnknownError" });
  });

  it("propagates a caller abort into the tool's signal and rejects the call", async () => {
    const mc = createPolyfill();
    let toolSignal: AbortSignal | null = null;
    await mc.registerTool({
      name: "slow",
      description: "d",
      execute: (_input, { signal }) =>
        new Promise((resolve) => {
          toolSignal = signal;
          signal.addEventListener("abort", () => resolve({ late: true }));
        }),
    });
    const [tool] = await mc.getTools();
    const controller = new AbortController();
    const call = mc.executeTool(tool!, {}, { signal: controller.signal });
    await Promise.resolve();
    controller.abort(new DOMException("stop", "AbortError"));
    await expect(call).rejects.toMatchObject({ name: "AbortError" });
    expect(toolSignal!.aborted).toBe(true);
  });

  it("refuses to execute an unknown tool", async () => {
    const mc = createPolyfill();
    await expect(mc.executeTool({ name: "ghost", description: "" }, {})).rejects.toMatchObject({ name: "NotFoundError" });
  });
});
