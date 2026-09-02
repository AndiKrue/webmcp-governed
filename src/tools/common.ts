// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Andreas Krueger
// This file is part of Governed Tool Calls, a WebMCP demo. See LICENSE.

// Small validation helpers shared by the tools. Every validation failure becomes a resolved
// {status:"invalid", errors} value; nothing here throws on bad input.

import { CATEGORIES, type Category, type Expense, type Store, formatMoney, isCategory } from "../data/fixture";
import type { JsonSchema } from "../webmcp/types";

export type Fields = Record<string, unknown>;

export function asObject(input: unknown): Fields {
  return input && typeof input === "object" && !Array.isArray(input) ? (input as Fields) : {};
}

export function optionalString(fields: Fields, key: string, errors: string[]): string | undefined {
  const value = fields[key];
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") {
    errors.push(`${key} must be a string`);
    return undefined;
  }
  return value.trim();
}

export function requiredString(fields: Fields, key: string, errors: string[]): string {
  const value = fields[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push(`${key} is required`);
    return "";
  }
  return value.trim();
}

export function requiredCategory(fields: Fields, key: string, errors: string[]): Category | null {
  const value = fields[key];
  if (!isCategory(value)) {
    errors.push(`${key} must be one of ${CATEGORIES.join(", ")}`);
    return null;
  }
  return value;
}

export function requiredExpense(store: Store, id: string, errors: string[]): Expense | null {
  if (!id) return null;
  const expense = store.expense(id);
  if (!expense) {
    errors.push(`unknown expense ${id}`);
    return null;
  }
  return expense;
}

export function rejectUnknownKeys(fields: Fields, allowed: string[], errors: string[]): void {
  for (const key of Object.keys(fields)) {
    if (!allowed.includes(key)) errors.push(`unknown parameter ${key}`);
  }
}

/** "E-007 (Notion subscription, 12.00 EUR)" */
export function expenseLabel(expense: Expense): string {
  return `${expense.id} (${expense.description}, ${formatMoney(expense.amount)})`;
}

export function monthSchema(description: string): JsonSchema {
  return { type: "string", description, pattern: "^\\d{4}-\\d{2}$" };
}

export function isMonth(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
