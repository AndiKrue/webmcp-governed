// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Andreas Krueger
// This file is part of Ask First, a WebMCP demo. See LICENSE.

// Fails when any committed .ts/.mjs/.css/.html file lacks the SPDX line near the top.

import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const SPDX = "SPDX-License-Identifier: AGPL-3.0-or-later";
const EXTENSIONS = [".ts", ".mjs", ".css", ".html"];

const files = execSync("git ls-files", { encoding: "utf8" })
  .split("\n")
  .filter((f) => f && EXTENSIONS.some((ext) => f.endsWith(ext)));

const missing = files.filter((file) => {
  const head = readFileSync(file, "utf8").slice(0, 400);
  return !head.includes(SPDX);
});

if (missing.length > 0) {
  console.error("Missing SPDX header:");
  for (const file of missing) console.error("  " + file);
  process.exit(1);
}
console.log(`lint:headers ok (${files.length} files)`);
