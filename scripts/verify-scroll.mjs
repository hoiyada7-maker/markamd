/**
 * verify-scroll.mjs
 * Verifies per-tab scroll memory in marka.md via CDP (port 9229).
 *
 * Prerequisites:
 *   App running via launch-debug.ps1 (WebView2 CDP on port 9229)
 *
 * Usage:
 *   node scripts/verify-scroll.mjs
 *   bun scripts/verify-scroll.mjs
 */

import { chromium } from "playwright";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SS_DIR = join(__dirname, "screenshots");
const CDP_URL = "http://127.0.0.1:9229";

// Two test markdown files. Created with enough content to scroll if missing.
const TEST_FILES = [
  "C:\\Users\\su\\pjt\\markamd\\README.md",
  "C:\\Users\\su\\pjt\\markamd\\CHANGELOG.md",
];

if (!existsSync(SS_DIR)) mkdirSync(SS_DIR, { recursive: true });

let stepNum = 0;
const pass = [];
const fail = [];
const log = (...a) => console.log(...a);

async function screenshot(page, label) {
  const p = join(SS_DIR, `${String(stepNum).padStart(2, "0")}-${label}.png`);
  await page.screenshot({ path: p });
  log(`  📸 ${p}`);
  stepNum++;
  return p;
}

// ── Tauri helpers ─────────────────────────────────────────────────────────────

async function openFile(page, filePath) {
  await page.evaluate(async (path) => {
    await window.__TAURI_INTERNALS__.invoke("plugin:event|emit", {
      event: "marka:open-file",
      payload: path,
    });
  }, filePath);
  await page.waitForTimeout(600);
}

async function getTabs(page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll(".mdv-tab")).map((el) => ({
      path: el.getAttribute("title") ?? "",
      title: el.querySelector(".mdv-tab__select")?.textContent?.trim() ?? "",
      active: el.classList.contains("is-active"),
    }))
  );
}

async function closeTab(page, path) {
  await page.evaluate((p) => {
    const tab = Array.from(document.querySelectorAll(".mdv-tab"))
      .find((el) => el.getAttribute("title") === p);
    const closeBtn = tab?.querySelector(".mdv-tab__close, button[aria-label*='lose']");
    if (closeBtn) closeBtn.click();
    else if (tab) {
      tab.dispatchEvent(new MouseEvent("auxclick", { bubbles: true, button: 1 }));
    }
  }, path);
  await page.waitForTimeout(300);
}

/** Click the tab with the given path. Waits for MO restore (150ms) + rAF buffer. */
async function clickTab(page, path) {
  await page.evaluate((p) => {
    const tab = Array.from(document.querySelectorAll(".mdv-tab"))
      .find((el) => el.getAttribute("title") === p);
    const btn = tab?.querySelector(".mdv-tab__select") ?? tab;
    btn?.click();
  }, path);
  // 350ms: 50ms debounce + ~100ms render + 150ms MO/fallback + rAF buffer
  await page.waitForTimeout(350);
}

async function previewScrollTop(page) {
  return page.evaluate(() => document.querySelector(".mdv-preview")?.scrollTop ?? -1);
}

/**
 * Set scrollTop and return the SETTLED position after useSyncScroll fires.
 * useSyncScroll adjusts preview to line-anchor positions (up to ~20px drift),
 * so we wait 300ms and read the stabilised value as the "true saved" position.
 */
async function scrollPreviewTo(page, px) {
  await page.evaluate((y) => {
    const el = document.querySelector(".mdv-preview");
    if (el) el.scrollTop = y;
  }, px);
  await page.waitForTimeout(300); // let useSyncScroll settle
  return previewScrollTop(page);  // actual saved position
}

/**
 * Ensure each test file is open as exactly one tab.
 * - Opens missing files.
 * - Closes extra duplicates (keeps the first instance).
 */
async function ensureTestTabs(page) {
  for (const f of TEST_FILES) {
    let tabs = await getTabs(page);
    const matches = tabs.filter((t) => t.path === f);
    if (matches.length === 0) {
      log(`  Opening: ${f}`);
      await openFile(page, f);
    } else if (matches.length > 1) {
      log(`  Closing ${matches.length - 1} duplicate tab(s) for: ${f}`);
      // closeTab(path) always closes the first DOM match; call once per extra
      for (let i = 1; i < matches.length; i++) {
        await closeTab(page, f);
      }
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  log("=== marka.md scroll memory verification ===\n");
  log(`Connecting to CDP at ${CDP_URL}…`);

  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
  } catch (e) {
    log(`\n❌ BLOCKED — cannot connect to ${CDP_URL}`);
    log(`   Start the app with launch-debug.ps1 first.`);
    process.exit(2);
  }

  const page = browser.contexts()[0]?.pages()[0];
  if (!page) { log("❌ BLOCKED — no page"); await browser.close(); process.exit(2); }
  log(`Connected: "${await page.title()}"\n`);

  // ── Clean up stale tabs with malformed paths (e.g. from previous probe runs)
  const staleTabs = await getTabs(page);
  for (const t of staleTabs) {
    if (t.path.includes("\\\\")) {
      log(`  Closing stale tab with bad path: ${t.path}`);
      await closeTab(page, t.path);
    }
  }

  // ── Ensure test files exist ───────────────────────────────────────────────
  for (const f of TEST_FILES) {
    if (!existsSync(f)) {
      writeFileSync(f, `# ${f.split("\\").pop()}\n\n${"Content line.\n\n".repeat(120)}`);
      log(`  Created: ${f}`);
    }
  }

  // ── Open each test file exactly once ─────────────────────────────────────
  log("Ensuring test tabs are open (one instance each)…");
  await ensureTestTabs(page);
  await page.waitForTimeout(300);

  const tabs = await getTabs(page);
  log(`Open tabs (${tabs.length}):`);
  tabs.forEach((t) => log(`  ${t.active ? "▶" : " "} ${t.title}  [${t.path}]`));

  const tabA = tabs.find((t) => t.path === TEST_FILES[0]);
  const tabB = tabs.find((t) => t.path === TEST_FILES[1]);
  if (!tabA || !tabB) {
    log("\n❌ BLOCKED — test tabs not found after opening"); await browser.close(); process.exit(2);
  }
  log(`\nTab A: "${tabA.title}"  Tab B: "${tabB.title}"\n`);
  await screenshot(page, "initial");

  // ── Step 1: Tab A → scroll to ~400, read SETTLED position as reference ────
  log("1. Tab A — scroll to ~400px, wait for useSyncScroll to settle");
  await clickTab(page, tabA.path);
  await page.waitForTimeout(200);
  const aSet = await scrollPreviewTo(page, 400);
  log(`   Settled scrollTop (saved as reference): ${aSet}px`);
  await screenshot(page, "tabA-scrolled");

  // ── Step 2: Tab B → scroll ────────────────────────────────────────────────
  log("\n2. Tab B — scroll to ~700px");
  await clickTab(page, tabB.path);
  await page.waitForTimeout(200);
  const bSet = await scrollPreviewTo(page, 700);
  log(`   Settled scrollTop: ${bSet}px`);
  await screenshot(page, "tabB-scrolled");

  // ── Step 3: Back to Tab A ─────────────────────────────────────────────────
  log(`\n3. Back to Tab A — verify restored to ~${aSet}px`);
  await clickTab(page, tabA.path);
  const aRestored = await previewScrollTop(page);
  const passA = Math.abs(aRestored - aSet) <= 5;
  log(`   Got ${aRestored}px  (expected ~${aSet}px)  ${passA ? "✅ PASS" : "❌ FAIL"}`);
  passA ? pass.push("Tab A restore") : fail.push(`Tab A restore: got ${aRestored}, expected ${aSet}`);
  await screenshot(page, "tabA-restored");

  // ── Step 4: Back to Tab B ─────────────────────────────────────────────────
  log(`\n4. Back to Tab B — verify restored to ~${bSet}px`);
  await clickTab(page, tabB.path);
  const bRestored = await previewScrollTop(page);
  const passB = Math.abs(bRestored - bSet) <= 5;
  log(`   Got ${bRestored}px  (expected ~${bSet}px)  ${passB ? "✅ PASS" : "❌ FAIL"}`);
  passB ? pass.push("Tab B restore") : fail.push(`Tab B restore: got ${bRestored}, expected ${bSet}`);
  await screenshot(page, "tabB-restored");

  // ── Step 5: Rapid A→B×3 then back to A ───────────────────────────────────
  log("\n5. 🔍 Rapid A→B×3 then back to A");
  for (let i = 0; i < 3; i++) {
    await clickTab(page, tabA.path); await page.waitForTimeout(120);
    await clickTab(page, tabB.path); await page.waitForTimeout(120);
  }
  await clickTab(page, tabA.path);
  const aRapid = await previewScrollTop(page);
  // Allow 20px: useSyncScroll may snap preview to nearest line anchor
  const passRapid = Math.abs(aRapid - aSet) <= 20;
  log(`   Tab A after rapid switching: ${aRapid}px  (expected within 20px of ${aSet})  ${passRapid ? "✅ PASS" : "❌ FAIL"}`);
  passRapid ? pass.push("Rapid-switch Tab A") : fail.push(`Rapid-switch: got ${aRapid}, expected within 20px of ${aSet}`);
  await screenshot(page, "rapid-final");

  // ── Step 6: Position must not drift across repeated revisits ──────────────
  log("\n6. 🔍 Tab A revisited 3× — position must not drift");
  const snapshots = [];
  for (let i = 0; i < 3; i++) {
    await clickTab(page, tabB.path); await page.waitForTimeout(200);
    await clickTab(page, tabA.path);
    snapshots.push(await previewScrollTop(page));
  }
  const maxDrift = Math.max(...snapshots) - Math.min(...snapshots);
  const passDrift = maxDrift <= 5;
  log(`   Positions over 3 visits: ${snapshots.join("px, ")}px`);
  log(`   Max drift: ${maxDrift.toFixed(1)}px  ${passDrift ? "✅ PASS" : "❌ FAIL"}`);
  passDrift ? pass.push("No drift across revisits") : fail.push(`Drift too large: ${maxDrift.toFixed(1)}px`);
  await screenshot(page, "drift-check-final");

  // ── Summary ───────────────────────────────────────────────────────────────
  const verdict = fail.length === 0;
  log("\n════════════════════════════════════");
  pass.forEach((p) => log(`  ✅ ${p}`));
  fail.forEach((f) => log(`  ❌ ${f}`));
  log(`\nVerdict: ${verdict ? "✅ PASS" : "❌ FAIL"}`);
  log(`Screenshots: ${SS_DIR}`);
  log("════════════════════════════════════");

  await browser.close();
  process.exit(verdict ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
