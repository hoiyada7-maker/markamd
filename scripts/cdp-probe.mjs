/**
 * cdp-probe.mjs — quick DOM inspection to find the right selectors
 */
import { chromium } from "playwright";

const browser = await chromium.connectOverCDP("http://127.0.0.1:9229");
const page = browser.contexts()[0].pages()[0];

const info = await page.evaluate(() => {
  const preview = document.querySelector(".mdv-preview");
  const prose = document.querySelector(".mdv-prose");
  const scroller = document.querySelector(".cm-scroller");

  // Find tab elements
  const tabSelectors = [
    "[data-tab-id]",
    ".mdv-tab",
    "[role='tab']",
    ".open-tab",
    ".tab-item",
  ];
  const foundTabs = tabSelectors
    .map((sel) => ({ sel, count: document.querySelectorAll(sel).length }))
    .filter((r) => r.count > 0);

  // Sample tab HTML
  const sampleTab = foundTabs[0]
    ? document.querySelector(foundTabs[0].sel)?.outerHTML?.slice(0, 200)
    : null;

  return {
    title: document.title,
    preview: { found: !!preview, scrollTop: preview?.scrollTop ?? -1, scrollHeight: preview?.scrollHeight ?? -1 },
    prose: { found: !!prose },
    editorScroller: { found: !!scroller, scrollTop: scroller?.scrollTop ?? -1 },
    foundTabSelectors: foundTabs,
    sampleTab,
  };
});

console.log(JSON.stringify(info, null, 2));

const screenshot = await page.screenshot();
const { writeFileSync, mkdirSync, existsSync } = await import("fs");
if (!existsSync("scripts/screenshots")) mkdirSync("scripts/screenshots", { recursive: true });
writeFileSync("scripts/screenshots/probe.png", screenshot);
console.log("\nScreenshot saved to scripts/screenshots/probe.png");

await browser.close();
