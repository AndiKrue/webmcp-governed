// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Andreas Krueger
// This file is part of Governed Tool Calls, a WebMCP demo. See LICENSE.

// End-to-end smoke test: builds nothing itself (run `npm run build` first), serves `dist/` with
// `vite preview`, drives the page through `document.modelContext` in headless Chrome for Testing.

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import puppeteer from "puppeteer";

const VITE_BIN = new URL("../node_modules/vite/bin/vite.js", import.meta.url).pathname;

const PORT = 4173;
const BASE = `http://localhost:${PORT}`;
const OUT = new URL("./out/", import.meta.url);
mkdirSync(OUT, { recursive: true });

let failures = 0;
function check(condition, label) {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${label}`);
  }
}

async function waitForServer(url, attempts = 50) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`server at ${url} did not come up`);
}

function startPreview() {
  const child = spawn(process.execPath, [VITE_BIN, "preview", "--port", String(PORT), "--strictPort"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", () => {});
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  return child;
}

async function openPage(browser, path) {
  const page = await browser.newPage();
  const errors = [];
  const external = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("request", (request) => {
    if (!request.url().startsWith(BASE)) external.push(request.url());
  });
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle0" });
  return { page, errors, external };
}

async function smokeRegistration(browser) {
  console.log("registration (polyfill)");
  const { page, errors, external } = await openPage(browser, "/?nopolyfill=0");
  const tools = await page.evaluate(async () => {
    const list = await document.modelContext.getTools();
    return list.map((tool) => ({ name: tool.name, readOnly: tool.annotations?.readOnlyHint === true }));
  });
  check(tools.some((tool) => tool.name === "ping"), "getTools() lists the ping tool");
  const roundTrip = await page.evaluate(async () => {
    const [tool] = (await document.modelContext.getTools()).filter((t) => t.name === "ping");
    const raw = await document.modelContext.executeTool(tool, { message: "hello" });
    return JSON.parse(raw);
  });
  check(roundTrip.status === "ok" && roundTrip.echo.message === "hello", "executeTool round-trips through the polyfill");
  const badge = await page.$eval("#status-badges", (el) => el.textContent);
  check(badge.includes("polyfill"), `status badge shows polyfill mode (${badge.trim()})`);
  check(errors.length === 0, `no console errors (${errors.join(" | ")})`);
  check(external.length === 0, `no outbound requests (${external.join(", ")})`);
  await page.screenshot({ path: new URL("./smoke-home.png", OUT).pathname, fullPage: true });
  await page.close();
}

async function main() {
  const preview = startPreview();
  let browser;
  try {
    await waitForServer(`${BASE}/`);
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    console.log(`chrome ${await browser.version()}`);
    await smokeRegistration(browser);
  } finally {
    if (browser) await browser.close();
    preview.kill("SIGTERM");
  }
  writeFileSync(new URL("./result.json", OUT), JSON.stringify({ failures, ts: new Date().toISOString() }, null, 2));
  if (failures > 0) {
    console.log(`${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("e2e ok");
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
