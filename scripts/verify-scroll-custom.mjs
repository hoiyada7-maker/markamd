/**
 * verify-scroll-custom.mjs — 사용자 지정 파일로 스크롤 기억 검증
 */
import { chromium } from "playwright";
import { mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SS_DIR = join(__dirname, "screenshots");
const CDP_URL = "http://127.0.0.1:9229";

const TEST_FILES = [
  "C:\\Users\\su\\Downloads\\WebClips\\2026-06-21 182734 [학교폭력] 온라인 저격글, 글이 사라지는 인스타스토리.md",
  "C:\\Users\\su\\Downloads\\WebClips\\2026-06-21 191808 [학교폭력] 온라인 저격글, 글이 사라지는 인스타스토리.md",
];

if (!existsSync(SS_DIR)) mkdirSync(SS_DIR, { recursive: true });

let stepNum = 0;
const pass = [];
const fail = [];
const log = (...a) => console.log(...a);

async function screenshot(page, label) {
  const p = join(SS_DIR, `custom-${String(stepNum).padStart(2, "0")}-${label}.png`);
  await page.screenshot({ path: p });
  log(`  📸 ${p}`);
  stepNum++;
}

async function openFile(page, filePath) {
  await page.evaluate(async (path) => {
    await window.__TAURI_INTERNALS__.invoke("plugin:event|emit", {
      event: "marka:open-file",
      payload: path,
    });
  }, filePath);
  await page.waitForTimeout(800); // 긴 파일명/특수문자 대기 여유
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
    const btn = tab?.querySelector(".mdv-tab__close, button[aria-label*='lose']");
    if (btn) btn.click();
    else if (tab) tab.dispatchEvent(new MouseEvent("auxclick", { bubbles: true, button: 1 }));
  }, path);
  await page.waitForTimeout(400);
}

async function clickTab(page, path) {
  await page.evaluate((p) => {
    const tab = Array.from(document.querySelectorAll(".mdv-tab"))
      .find((el) => el.getAttribute("title") === p);
    const btn = tab?.querySelector(".mdv-tab__select") ?? tab;
    btn?.click();
  }, path);
  // 동일 콘텐츠: MO 미발동 → 150ms 폴백 대기 + 여유
  await page.waitForTimeout(400);
}

async function previewScrollTop(page) {
  return page.evaluate(() => document.querySelector(".mdv-preview")?.scrollTop ?? -1);
}

async function scrollPreviewTo(page, px) {
  await page.evaluate((y) => {
    const el = document.querySelector(".mdv-preview");
    if (el) el.scrollTop = y;
  }, px);
  await page.waitForTimeout(300);
  return previewScrollTop(page);
}

async function ensureTestTabs(page) {
  for (const f of TEST_FILES) {
    let tabs = await getTabs(page);
    const matches = tabs.filter((t) => t.path === f);
    if (matches.length === 0) {
      log(`  Opening: ${f.split("\\").pop()}`);
      await openFile(page, f);
    } else if (matches.length > 1) {
      log(`  Closing ${matches.length - 1} duplicate(s)`);
      for (let i = 1; i < matches.length; i++) await closeTab(page, f);
    }
  }
}

async function main() {
  log("=== 스크롤 기억 검증 (동일 콘텐츠 파일) ===\n");

  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
  } catch {
    log(`❌ BLOCKED — CDP 연결 실패 (${CDP_URL})`);
    log("   launch-debug.ps1 로 앱을 먼저 시작하세요.");
    process.exit(2);
  }

  const page = browser.contexts()[0]?.pages()[0];
  if (!page) { log("❌ no page"); await browser.close(); process.exit(2); }
  log(`Connected: "${await page.title()}"\n`);

  // console log capture for debugging
  page.on("console", msg => {
    const t = msg.text();
    if (t.startsWith("[mem]") || t.startsWith("[sync]")) log(`  LOG: ${t}`);
  });

  log("테스트 파일:");
  TEST_FILES.forEach((f, i) => log(`  Tab ${String.fromCharCode(65 + i)}: ${f.split("\\").pop()}`));
  log("");

  // 중복 탭 정리 & 열기
  await ensureTestTabs(page);
  await page.waitForTimeout(300);

  const tabs = await getTabs(page);
  const tabA = tabs.find((t) => t.path === TEST_FILES[0]);
  const tabB = tabs.find((t) => t.path === TEST_FILES[1]);
  if (!tabA || !tabB) {
    log("❌ BLOCKED — 탭을 찾을 수 없음");
    log("현재 탭:", tabs.map(t => t.path));
    await browser.close(); process.exit(2);
  }
  log(`탭 확인: A="${tabA.title}"  B="${tabB.title}"\n`);
  await screenshot(page, "initial");

  // ── 1. Tab A 스크롤 ────────────────────────────────────────────────────
  log("1. Tab A → 400px 스크롤 (settled 값 기준으로 삼음)");
  await clickTab(page, tabA.path);
  await page.waitForTimeout(200);
  const aSet = await scrollPreviewTo(page, 400);
  log(`   기준 위치: ${aSet}px`);
  await screenshot(page, "tabA-scrolled");

  // ── 2. Tab B 스크롤 ────────────────────────────────────────────────────
  log("\n2. Tab B → 700px 스크롤");
  await clickTab(page, tabB.path);
  await page.waitForTimeout(200);
  const bSet = await scrollPreviewTo(page, 700);
  log(`   기준 위치: ${bSet}px`);
  await screenshot(page, "tabB-scrolled");

  // ── 3. Tab A 복귀 ──────────────────────────────────────────────────────
  log(`\n3. Tab A 복귀 → ${aSet}px 복원 확인`);
  await clickTab(page, tabA.path);
  const aRestored = await previewScrollTop(page);
  const passA = Math.abs(aRestored - aSet) <= 5;
  log(`   Got ${aRestored}px  (기준 ${aSet}px)  ${passA ? "✅ PASS" : "❌ FAIL"}`);
  passA ? pass.push("Tab A 복원") : fail.push(`Tab A: got ${aRestored}, expected ${aSet}`);
  await screenshot(page, "tabA-restored");

  // ── 4. Tab B 복귀 ──────────────────────────────────────────────────────
  log(`\n4. Tab B 복귀 → ${bSet}px 복원 확인`);
  await clickTab(page, tabB.path);
  const bRestored = await previewScrollTop(page);
  const passB = Math.abs(bRestored - bSet) <= 5;
  log(`   Got ${bRestored}px  (기준 ${bSet}px)  ${passB ? "✅ PASS" : "❌ FAIL"}`);
  passB ? pass.push("Tab B 복원") : fail.push(`Tab B: got ${bRestored}, expected ${bSet}`);
  await screenshot(page, "tabB-restored");

  // ── 5. 고속 전환 후 Tab A ─────────────────────────────────────────────
  log("\n5. 🔍 A→B 3회 고속 전환 후 Tab A");
  for (let i = 0; i < 3; i++) {
    await clickTab(page, tabA.path); await page.waitForTimeout(120);
    await clickTab(page, tabB.path); await page.waitForTimeout(120);
  }
  await clickTab(page, tabA.path);
  const aRapid = await previewScrollTop(page);
  const passRapid = Math.abs(aRapid - aSet) <= 20;
  log(`   Got ${aRapid}px  (기준 ±20px of ${aSet})  ${passRapid ? "✅ PASS" : "❌ FAIL"}`);
  passRapid ? pass.push("고속전환 후 Tab A") : fail.push(`고속전환: got ${aRapid}, expected ~${aSet}`);
  await screenshot(page, "rapid-final");

  // ── 6. 반복 방문 drift ────────────────────────────────────────────────
  log("\n6. 🔍 Tab A 3회 반복 방문 — drift ≤ 5px");
  const snapshots = [];
  for (let i = 0; i < 3; i++) {
    await clickTab(page, tabB.path); await page.waitForTimeout(250);
    await clickTab(page, tabA.path);
    snapshots.push(await previewScrollTop(page));
  }
  const maxDrift = Math.max(...snapshots) - Math.min(...snapshots);
  const passDrift = maxDrift <= 5;
  log(`   방문별 위치: ${snapshots.join("px, ")}px`);
  log(`   최대 drift: ${maxDrift.toFixed(1)}px  ${passDrift ? "✅ PASS" : "❌ FAIL"}`);
  passDrift ? pass.push("drift 없음") : fail.push(`Drift: ${maxDrift.toFixed(1)}px`);
  await screenshot(page, "drift-final");

  // ── 요약 ──────────────────────────────────────────────────────────────
  const verdict = fail.length === 0;
  log("\n════════════════════════════════════");
  pass.forEach((p) => log(`  ✅ ${p}`));
  fail.forEach((f) => log(`  ❌ ${f}`));
  log(`\nVerdict: ${verdict ? "✅ PASS" : "❌ FAIL"}`);
  log("════════════════════════════════════");

  await browser.close();
  process.exit(verdict ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
