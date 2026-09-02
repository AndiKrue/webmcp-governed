// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Andreas Krueger
// This file is part of Ask First, a WebMCP demo. See LICENSE.

// Types for the WebMCP surface this demo relies on.
// Shape follows the W3C WebML CG draft: https://webmachinelearning.github.io/webmcp/

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** A JSON Schema subset: enough for object schemas with string/number/enum/array properties. */
export interface JsonSchema {
  type?: "object" | "string" | "number" | "integer" | "boolean" | "array";
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
  enum?: string[];
  items?: JsonSchema;
  pattern?: string;
  minItems?: number;
  minLength?: number;
}

export interface ModelContextToolAnnotations {
  readOnlyHint?: boolean;
  untrustedContentHint?: boolean;
}

export interface ModelContextExecuteOptions {
  signal: AbortSignal;
}

export type ModelContextExecute = (
  input: unknown,
  options: ModelContextExecuteOptions,
) => unknown | Promise<unknown>;

export interface ModelContextTool {
  name: string;
  title?: string;
  description: string;
  inputSchema?: JsonSchema;
  execute: ModelContextExecute;
  annotations?: ModelContextToolAnnotations;
}

export interface ModelContextRegisterOptions {
  signal?: AbortSignal;
  exposedTo?: "self" | "self-and-parent" | string;
}

export interface ModelContextGetToolsOptions {
  fromOrigins?: string[];
}

export interface ModelContextExecuteToolOptions {
  signal?: AbortSignal;
}

export interface RegisteredTool {
  name: string;
  title?: string;
  description: string;
  inputSchema?: JsonSchema;
  annotations?: ModelContextToolAnnotations;
  window?: Window;
  origin?: string;
}

export interface ModelContext extends EventTarget {
  registerTool(tool: ModelContextTool, options?: ModelContextRegisterOptions): Promise<undefined>;
  getTools(options?: ModelContextGetToolsOptions): Promise<RegisteredTool[]>;
  /**
   * The draft IDL takes an object as `input`; Chrome 150 takes a JSON string and rejects an object
   * with UnknownError "Failed to parse input arguments". Our polyfill accepts either.
   */
  executeTool(
    tool: RegisteredTool,
    input: unknown,
    options?: ModelContextExecuteToolOptions,
  ): Promise<string>;
  ontoolchange: ((this: ModelContext, ev: Event) => unknown) | null;
  /** Set by our own polyfill so diagnostics can tell it from the real thing. */
  __polyfill?: boolean;
}

/** Which implementation of the API the page ended up with. */
export type ApiMode = "native" | "aliased" | "polyfill" | "none";

declare global {
  interface Document {
    modelContext?: ModelContext;
  }
  interface Navigator {
    modelContext?: ModelContext;
  }
}
