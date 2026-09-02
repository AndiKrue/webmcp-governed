// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Andreas Krueger
// This file is part of Governed Tool Calls, a WebMCP demo. See LICENSE.

import type { Store } from "../data/fixture";
import type { GovernedTool } from "../gate/gate";
import { categoriseExpenseTool } from "./categorise-expense";
import { draftReimbursementTool } from "./draft-reimbursement";
import { findDuplicatesTool } from "./find-duplicates";
import { flagExpenseTool } from "./flag-expense";
import { listExpensesTool } from "./list-expenses";
import { payReimbursementTool } from "./pay-reimbursement";
import { summariseMonthTool } from "./summarise-month";

/** The seven tools, in the order they are registered. */
export function createTools(store: Store): GovernedTool[] {
  return [
    listExpensesTool(store),
    findDuplicatesTool(store),
    summariseMonthTool(store),
    categoriseExpenseTool(store),
    flagExpenseTool(store),
    draftReimbursementTool(store),
    payReimbursementTool(store),
  ] as GovernedTool[];
}
