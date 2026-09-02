// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Andreas Krueger
// This file is part of Ask First, a WebMCP demo. See LICENSE.

// Probes whether the bundled Chrome for Testing exposes a native `modelContext` under any of a few
// feature flags. Purely informational: nothing downstream depends on the result.

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import puppeteer from "puppeteer";

const VITE_BIN = new URL("../node_modules/vite/bin/vite.js", import.meta.url).pathname;

const PORT = 4173;
const BASE = `http://localhost:${PORT}`;
const FLAG_SETS = [
  ["--enable-features=WebMCPTesting"],
  ["--enable-features=WebMCP"],
  ["--enable-features=WebMCP,WebMCPTesting"],
  ["--enable-experimental-web-platform-features"],
  ["--enable-blink-features=WebMCP"],
];

async function waitForServer(url, attempts = 50) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("preview did not start");
}

async function main() {
  const preview = spawn(process.execPath, [VITE_BIN, "preview", "--port", String(PORT), "--strictPort"], { stdio: "ignore" });
  const results = [];
  let version = "unknown";
  try {
    await waitForServer(`${BASE}/`);
    for (const flags of FLAG_SETS) {
      const browser = await puppeteer.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-dev-shm-usage", ...flags],
      });
      version = await browser.version();
      const page = await browser.newPage();
      // Capture what the browser provides before the page's own script can alias or shim anything.
      await page.evaluateOnNewDocument(() => {
        const methods = (target) => {
          const mc = target.modelContext;
          return mc ? Object.getOwnPropertyNames(Object.getPrototypeOf(mc)).filter((n) => n !== "constructor") : null;
        };
        window.__before = { document: methods(document), navigator: methods(navigator) };
      });
      await page.goto(`${BASE}/?nopolyfill=1`, { waitUntil: "networkidle0" });
      const probe = await page.evaluate(() => ({
        before: window.__before,
        badge: document.getElementById("status-badges")?.textContent ?? "",
      }));
      results.push({ flags, ...probe });
      const fmt = (m) => (m ? `[${m.join(", ")}]` : "absent");
      console.log(`${flags.join(" ")}: document=${fmt(probe.before.document)} navigator=${fmt(probe.before.navigator)}`);
      await browser.close();
    }
  } finally {
    preview.kill("SIGTERM");
  }
  mkdirSync(new URL("./out/", import.meta.url), { recursive: true });
  writeFileSync(
    new URL("./out/native-probe.json", import.meta.url),
    JSON.stringify({ version, results, ts: new Date().toISOString() }, null, 2),
  );
  console.log(`chrome ${version}`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
