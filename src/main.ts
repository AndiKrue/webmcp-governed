// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Andreas Krueger
// This file is part of Governed Tool Calls, a WebMCP demo. See LICENSE.

// Entry point. Phase 0 scaffold: wiring is added in later phases.

const badges = document.getElementById("status-badges");
if (badges) badges.textContent = "booting";
