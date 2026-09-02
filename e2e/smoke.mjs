// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Andreas Krueger
// This file is part of Governed Tool Calls, a WebMCP demo. See LICENSE.

// End-to-end demo path. Run `npm run build` first: this serves `dist/` with `vite preview` and drives
// the page in headless Chrome for Testing through `document.modelContext`.
//
//   node e2e/smoke.mjs            polyfill mode (the API the page installs itself)
//   node e2e/smoke.mjs --native   also try Chrome's own modelContext behind --enable-features=WebMCPTesting

import { spawn } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import puppeteer from "puppeteer";

const VITE_BIN = new URL("../node_modules/vite/bin/vite.js", import.meta.url).pathname;
const PORT = 4173;
const BASE = `http://localhost:${PORT}`;
const OUT = new URL("./out/", import.meta.url);
const DOWNLOADS = new URL("./out/downloads/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const WANT_NATIVE = process.argv.includes("--native");

let failures = 0;
const record = [];
function check(condition, label) {
  record.push({ ok: Boolean(condition), label });
  console.log(`  ${condition ? "ok  " : "FAIL"} ${label}`);
  if (!condition) failures += 1;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForServer(url, attempts = 50) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // not up yet
    }
    await sleep(200);
  }
  throw new Error(`server at ${url} did not come up`);
}

async function openPage(browser, path) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 1000 });
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
  await page.waitForSelector("body[data-ready]");
  return { page, errors, external };
}

/** Calls a tool the way an agent would and returns the parsed value the agent would see. */
async function invoke(page, name, input) {
  const raw = await page.evaluate(
    async (name, input) => {
      const mc = document.modelContext;
      if (mc && typeof mc.executeTool === "function") {
        const tool = (await mc.getTools()).find((t) => t.name === name);
        return mc.executeTool(tool, input);
      }
      return window.__harnessInvoke(name, input);
    },
    name,
    input,
  );
  return JSON.parse(raw);
}

/** Starts a call and leaves it pending; returns a handle to await later. */
async function invokeLater(page, name, input) {
  const key = `call_${Math.random().toString(36).slice(2)}`;
  await page.evaluate(
    (name, input, key) => {
      const mc = document.modelContext;
      const start = async () => {
        if (mc && typeof mc.executeTool === "function") {
          const tool = (await mc.getTools()).find((t) => t.name === name);
          return mc.executeTool(tool, input);
        }
        return window.__harnessInvoke(name, input);
      };
      window[key] = start().then((raw) => ({ raw }), (error) => ({ error: String(error) }));
    },
    name,
    input,
    key,
  );
  return {
    async settled() {
      return page.evaluate((key) => Promise.race([window[key], new Promise((r) => setTimeout(() => r(null), 50))]), key);
    },
    async result() {
      const value = await page.evaluate((key) => window[key], key);
      if (value.error) throw new Error(value.error);
      return JSON.parse(value.raw);
    },
  };
}

async function waitForCard(page, count = 1) {
  await page.waitForFunction((n) => document.querySelectorAll(".card").length >= n, {}, count);
  return page.$$(".card");
}

async function clickIn(card, selector) {
  const handle = await card.$(selector);
  await handle.click();
}

async function demoPath(browser, { transport, mode }) {
  const label = `${mode}/${transport}`;
  console.log(`demo path (${label})`);
  const query = mode === "native" ? "nopolyfill=1" : "nopolyfill=0";
  const { page, errors, external } = await openPage(browser, `/?${query}&harness=1&transport=${transport}`);
  const cdp = await page.createCDPSession();
  await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: DOWNLOADS, eventsEnabled: true });

  const badge = await page.$eval("#status-badges", (el) => el.textContent);
  check(badge.includes(mode === "native" ? "native WebMCP" : "polyfill"), `badge shows ${mode} (${badge.trim()})`);
  check(badge.includes(`transport: ${transport}`), `badge shows transport ${transport}`);

  const names = await page.evaluate(async () => {
    const mc = document.modelContext;
    if (typeof mc.getTools === "function") return (await mc.getTools()).map((t) => t.name);
    return null;
  });
  if (names) {
    const expected = ["categorise_expense", "draft_reimbursement", "find_duplicates", "flag_expense", "list_expenses", "pay_reimbursement", "summarise_month"];
    if (transport === "two-call") expected.push("commit_approved_action");
    expected.sort();
    check(JSON.stringify(names) === JSON.stringify(expected), `getTools() lists ${names.length} tools sorted (${names.join(", ")})`);
    const readOnly = await page.evaluate(async () =>
      (await document.modelContext.getTools()).filter((t) => t.annotations?.readOnlyHint).map((t) => t.name),
    );
    check(JSON.stringify(readOnly) === JSON.stringify(["find_duplicates", "list_expenses", "summarise_month"]), `readOnlyHint only on the three open tools`);
  } else {
    check(false, "getTools() is available (native or shimmed)");
  }
  if (mode === "native") {
    await page.click("#diagnostics-toggle");
    const diag = await page.$eval("#diagnostics", (el) => el.textContent);
    check(/\(registerTool[^)]*\)/.test(diag), `diagnostics name the native methods (${diag.match(/API.*?Transport/)?.[0] ?? diag.slice(0, 160)})`);
    check(!(await page.evaluate(() => document.modelContext.__polyfill)), "native object is not the polyfill");
  }

  // 1. open call: runs at once, no card
  const open = await invoke(page, "list_expenses", { category: "uncategorised" });
  check(open.status === "ok" && open.count === 3, `open call resolves at once (count=${open.count})`);
  check((await page.$$(".card")).length === 0, "open call produced no card");
  check(open.receipt_id === "L-0001", `open call carries receipt_id ${open.receipt_id}`);

  // 2. gated call approved
  const cat = await invokeLater(page, "categorise_expense", { expense_id: "E-007", category: "software" });
  let [card] = await waitForCard(page);
  const effect = await card.$eval(".card-effect", (el) => el.textContent);
  check(effect === "Set category of E-007 (Notion subscription, 12.00 EUR) to software", `card shows the effect line (${effect})`);
  check(await page.evaluate(() => document.activeElement?.classList.contains("card")), "new card received focus");
  check((await page.$eval("#cards-live", (el) => el.textContent)).includes("Categorise expense"), "aria-live region announced the card");
  if (transport === "hold") {
    check((await cat.settled()) === null, "hold: execute promise still pending while the card is up");
  } else {
    const pending = await cat.result();
    check(pending.status === "pending_approval" && typeof pending.approval_token === "string", "two-call: execute resolved with pending_approval + token");
    const again = await invoke(page, "commit_approved_action", { approval_token: pending.approval_token });
    check(again.status === "pending_approval", "two-call: commit before a decision is still pending");
    cat.token = pending.approval_token;
  }
  await clickIn(card, ".btn-approve");
  const approved = transport === "hold" ? await cat.result() : await invoke(page, "commit_approved_action", { approval_token: cat.token });
  check(approved.status === "ok" && approved.expense?.category === "software", "approval resolved the real result");
  check((await page.$eval('tr[data-id="E-007"] td:nth-child(7)', (el) => el.textContent)) === "software", "table updated live");
  check((await page.$$(".receipt-approved")).length === 1, "card collapsed into an approved receipt");

  // 3. gated call declined with a reason -> structured refusal
  const bad = await invokeLater(page, "categorise_expense", { expense_id: "E-019", category: "meals" });
  [card] = await waitForCard(page);
  if (transport === "two-call") bad.token = (await bad.result()).approval_token;
  await clickIn(card, ".btn-decline");
  await card.$eval("textarea", (el) => { el.value = "Cables are hardware, not meals"; el.dispatchEvent(new Event("input")); });
  await card.$eval("select", (el) => { el.value = "different_arguments"; el.dispatchEvent(new Event("change")); });
  await clickIn(card, ".btn-decline-confirm");
  const refusal = transport === "hold" ? await bad.result() : await invoke(page, "commit_approved_action", { approval_token: bad.token });
  check(refusal.status === "declined" && refusal.reason === "Cables are hardware, not meals" && refusal.retry_hint === "different_arguments",
    `decline reached the agent as a structured refusal (${JSON.stringify(refusal)})`);
  check((await page.$eval('tr[data-id="E-019"] td:nth-child(7)', (el) => el.textContent)) === "—", "declined proposal left the record untouched");
  // the agent re-proposes with different arguments
  const retry = await invokeLater(page, "categorise_expense", { expense_id: "E-019", category: "hardware" });
  [card] = await waitForCard(page);
  if (transport === "two-call") retry.token = (await retry.result()).approval_token;
  await clickIn(card, ".btn-approve");
  const retried = transport === "hold" ? await retry.result() : await invoke(page, "commit_approved_action", { approval_token: retry.token });
  check(retried.status === "ok", "re-proposal with different arguments approved");

  // 4. sealed: wrong typed amount refused, right amount pays
  const pay = await invokeLater(page, "pay_reimbursement", { draft_id: "D-001" });
  [card] = await waitForCard(page);
  if (transport === "two-call") pay.token = (await pay.result()).approval_token;
  check(await card.$(".tag-irreversible") !== null, "sealed card carries the Irreversible tag");
  check(await card.$eval(".btn-approve", (el) => el.disabled), "sealed Approve is disabled before typing");
  await card.$eval("input", (el) => { el.value = "34.00"; el.dispatchEvent(new Event("input")); });
  check(await card.$eval(".btn-approve", (el) => el.disabled), "wrong amount keeps Approve disabled");
  // bypass the button and ask the gate directly with the wrong value: it must refuse
  const bypass = await page.evaluate((id) => {
    const btn = document.querySelector(`#${id} .btn-approve`);
    btn.disabled = false;
    btn.click();
    return document.querySelector(`#${id} .card-error`)?.textContent ?? "";
  }, await card.evaluate((el) => el.id));
  check(bypass.includes("confirmation"), `gate refused a wrong confirmation even with the button forced (${bypass})`);
  check((await page.$$eval('#drafts li[data-id="D-001"] .pill', (els) => els.map((e) => e.textContent)))[0] === "draft", "nothing paid yet");
  await card.$eval("input", (el) => { el.value = "340,00"; el.dispatchEvent(new Event("input")); });
  check(!(await card.$eval(".btn-approve", (el) => el.disabled)), "right amount enables Approve");
  await clickIn(card, ".btn-approve");
  const paid = transport === "hold" ? await pay.result() : await invoke(page, "commit_approved_action", { approval_token: pay.token });
  check(paid.status === "ok" && paid.payment?.amount === "340.00" && paid.payment?.payee === "Contractor X", "sealed approval paid D-001");
  check((await page.$eval('#drafts li[data-id="D-001"] .pill', (el) => el.textContent)) === "paid", "draft D-001 is paid");
  check((await page.$eval('tr[data-id="E-009"] .pill', (el) => el.textContent)) === "paid", "expense E-009 is paid");
  const repay = await invoke(page, "pay_reimbursement", { draft_id: "D-001" });
  check(repay.status === "invalid", "paying again is invalid, no card");

  // the must-not-pay draft, declined with never
  const no = await invokeLater(page, "pay_reimbursement", { draft_id: "D-002" });
  [card] = await waitForCard(page);
  if (transport === "two-call") no.token = (await no.result()).approval_token;
  await clickIn(card, ".btn-decline");
  await card.$eval("textarea", (el) => { el.value = "Personal purchase, not a team expense"; el.dispatchEvent(new Event("input")); });
  await card.$eval("select", (el) => { el.value = "never"; el.dispatchEvent(new Event("change")); });
  await clickIn(card, ".btn-decline-confirm");
  const vetoed = transport === "hold" ? await no.result() : await invoke(page, "commit_approved_action", { approval_token: no.token });
  check(vetoed.status === "declined" && vetoed.retry_hint === "never", "must-not-pay draft declined with retry_hint never");

  // caller abort -> cancelled_by_caller, card withdrawn
  const aborted = await page.evaluate(async () => {
    const controller = new AbortController();
    const mc = document.modelContext;
    let promise;
    if (mc && typeof mc.executeTool === "function") {
      const tool = (await mc.getTools()).find((t) => t.name === "flag_expense");
      promise = mc.executeTool(tool, { expense_id: "E-011", reason: "probe" }, { signal: controller.signal });
    } else {
      promise = window.__harnessInvoke("flag_expense", { expense_id: "E-011", reason: "probe" }, controller.signal);
    }
    await new Promise((r) => setTimeout(r, 50));
    const cardsBefore = document.querySelectorAll(".card").length;
    controller.abort(new DOMException("agent gave up", "AbortError"));
    const outcome = await promise.then((raw) => ({ resolved: raw }), (e) => ({ rejected: String(e) }));
    await new Promise((r) => setTimeout(r, 20));
    return { cardsBefore, cardsAfter: document.querySelectorAll(".card").length, outcome };
  });
  check(aborted.cardsBefore === 1 && aborted.cardsAfter === 0, `caller abort withdrew the card (${aborted.cardsBefore} -> ${aborted.cardsAfter})`);
  const outcomeText = JSON.stringify(aborted.outcome);
  check(
    transport === "two-call" ? outcomeText.includes("pending_approval") : outcomeText.includes("AbortError") || outcomeText.includes("declined"),
    `aborted call settled for the caller (${outcomeText})`,
  );
  const cancelledRow = await page.$$eval(".ledger-row", (els) => els.filter((el) => el.dataset.decision === "cancelled_by_caller").length);
  check(cancelledRow === 1, "ledger has one cancelled_by_caller row");

  // 5. ledger and export
  const rows = await page.$$eval(".ledger-row", (els) => els.map((el) => el.dataset.decision));
  check(rows.length >= 4, `ledger shows ${rows.length} rows`);
  const heading = await page.$eval("#ledger h2", (el) => el.textContent);
  check(heading.includes(`(${rows.length} rows)`), `ledger heading counts rows (${heading})`);
  rmSync(DOWNLOADS, { recursive: true, force: true });
  mkdirSync(DOWNLOADS, { recursive: true });
  await page.click(".btn-export");
  let files = [];
  for (let i = 0; i < 50 && files.length === 0; i += 1) {
    await sleep(100);
    files = readdirSync(DOWNLOADS).filter((f) => f.startsWith("ledger-") && f.endsWith(".json"));
  }
  check(files.length === 1, `export downloaded ${files.join(", ")}`);
  if (files.length === 1) {
    const exported = JSON.parse(readFileSync(`${DOWNLOADS}/${files[0]}`, "utf8"));
    const decisions = exported.map((r) => r.decision);
    check(exported.length === rows.length, `export has ${exported.length} rows`);
    check(decisions.includes("executed") && decisions.includes("approved") && decisions.includes("declined") && decisions.includes("cancelled_by_caller") && decisions.includes("invalid"),
      `export covers every decision kind (${[...new Set(decisions)].join(", ")})`);
    const payRow = exported.find((r) => r.tool === "pay_reimbursement" && r.decision === "approved");
    check(payRow?.confirmation_used === true && payRow?.tool_class === "sealed" && payRow?.transport === transport && payRow?.api === (mode === "native" ? "native" : "polyfill"),
      "sealed row records confirmation, class, transport and api");
    check(exported.every((r) => typeof r.latency_ms === "number" && r.latency_ms >= 0), "every row has latency_ms");
    writeFileSync(new URL(`./ledger-${mode}-${transport}.json`, OUT), JSON.stringify(exported, null, 2));
  }

  // reset
  await page.click("#reset");
  check((await page.$$(".ledger-row")).length === 0 && (await page.$eval('tr[data-id="E-007"] td:nth-child(7)', (el) => el.textContent)) === "—", "Reset to fixture reseeds state and clears the ledger");

  check(errors.length === 0, `no console errors (${errors.join(" | ")})`);
  check(external.length === 0, `no outbound requests (${external.join(", ")})`);
  await page.screenshot({ path: new URL(`./demo-${mode}-${transport}.png`, OUT).pathname, fullPage: true });
  await page.close();
}

async function surfaceChecks(browser) {
  console.log("surface checks (polyfill)");
  const bare = await openPage(browser, "/");
  check((await bare.page.$("#harness")) === null, "bare URL shows no harness");
  check((await bare.page.$eval("#status-badges", (el) => el.textContent)).includes("transport: hold"), "default transport is hold");
  check((await bare.page.$("#diagnostics")).evaluate((el) => el.hidden), "diagnostics hidden until toggled");
  await bare.page.click("#diagnostics-toggle");
  check(!(await (await bare.page.$("#diagnostics")).evaluate((el) => el.hidden)), "diagnostics toggle shows the panel");
  const toolchange = await bare.page.evaluate(async () => {
    let onCount = 0;
    let listenerCount = 0;
    const mc = document.modelContext;
    mc.ontoolchange = () => { onCount += 1; };
    mc.addEventListener("toolchange", () => { listenerCount += 1; });
    const controller = new AbortController();
    await mc.registerTool({ name: "tmp_probe", description: "probe", execute: () => 1 }, { signal: controller.signal });
    controller.abort();
    return { onCount, listenerCount, still: (await mc.getTools()).some((t) => t.name === "tmp_probe") };
  });
  check(toolchange.onCount === 2 && toolchange.listenerCount === 2 && !toolchange.still, `toolchange fires once per change for both handler kinds (${JSON.stringify(toolchange)})`);
  check(bare.errors.length === 0 && bare.external.length === 0, "bare page: no console errors, no outbound requests");
  await bare.page.close();

  const harness = await openPage(browser, "/?harness=1");
  check((await harness.page.$("#harness")) !== null, "?harness=1 shows the harness");
  await harness.page.select("#harness-tool", "summarise_month");
  await harness.page.click("#harness-invoke");
  await harness.page.waitForFunction(() => document.getElementById("harness-output").textContent.includes('"status"'));
  const out = await harness.page.$eval("#harness-output", (el) => el.textContent);
  check(out.includes('"ok"') && out.includes("by_member"), "harness invokes through executeTool and shows the raw value");
  // in-page transport switch re-registers tools
  await harness.page.select("#transport-select", "two-call");
  await harness.page.waitForFunction(async () => (await document.modelContext.getTools()).some((t) => t.name === "commit_approved_action"));
  check(true, "switching transport in place registers commit_approved_action");
  await harness.page.close();

  const none = await openPage(browser, "/?nopolyfill=1");
  check((await none.page.$eval("#status-badges", (el) => el.textContent)).includes("no WebMCP API"), "?nopolyfill=1 without a native API shows 'no WebMCP API'");
  check(none.errors.length === 0, `no console errors without any API (${none.errors.join(" | ")})`);
  await none.page.close();
}

async function main() {
  const preview = spawn(process.execPath, [VITE_BIN, "preview", "--port", String(PORT), "--strictPort"], { stdio: ["ignore", "ignore", "inherit"] });
  const summary = { chrome: null, native: null, ts: new Date().toISOString() };
  try {
    await waitForServer(`${BASE}/`);
    const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
    summary.chrome = await browser.version();
    console.log(`chrome ${summary.chrome}`);
    await surfaceChecks(browser);
    await demoPath(browser, { transport: "hold", mode: "polyfill" });
    await demoPath(browser, { transport: "two-call", mode: "polyfill" });
    await browser.close();

    if (WANT_NATIVE) {
      const native = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-features=WebMCPTesting"] });
      const probe = await native.newPage();
      await probe.goto(`${BASE}/?nopolyfill=1`, { waitUntil: "networkidle0" });
      const shape = await probe.evaluate(() => {
        const mc = document.modelContext;
        if (!mc) return null;
        return Object.getOwnPropertyNames(Object.getPrototypeOf(mc));
      });
      await probe.close();
      summary.native = shape;
      console.log(`native modelContext prototype: ${shape ? shape.join(", ") : "absent"}`);
      if (shape) {
        await demoPath(native, { transport: "hold", mode: "native" });
        await demoPath(native, { transport: "two-call", mode: "native" });
      } else {
        check(false, "native modelContext absent under --enable-features=WebMCPTesting");
      }
      await native.close();
    }
  } finally {
    preview.kill("SIGTERM");
  }
  writeFileSync(new URL("./result.json", OUT), JSON.stringify({ ...summary, failures, checks: record }, null, 2));
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
