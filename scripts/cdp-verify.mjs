/**
 * cdp-verify.mjs — full 6-step scroll memory verification via direct CDP.
 * Avoids the Playwright shared_worker crash while running identical checks.
 */
import { mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SS_DIR = join(__dirname, "screenshots");
const CDP_HTTP = "http://127.0.0.1:9229";

const TEST_FILES = [
  "C:\\Users\\su\\Downloads\\WebClips\\2026-06-21 182734 [학교폭력] 온라인 저격글, 글이 사라지는 인스타스토리.md",
  "C:\\Users\\su\\Downloads\\WebClips\\2026-06-21 191808 [학교폭력] 온라인 저격글, 글이 사라지는 인스타스토리.md",
];
const [pathA, pathB] = TEST_FILES;

if (!existsSync(SS_DIR)) mkdirSync(SS_DIR, { recursive: true });

// ── minimal CDP client ──────────────────────────────────────────────────────

async function getPageWsUrl() {
  const targets = await (await fetch(`${CDP_HTTP}/json/list`)).json();
  const pg = targets.find(t => t.type === "page");
  if (!pg) throw new Error("No page target found");
  return pg.webSocketDebuggerUrl;
}

function createCDPClient(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let msgId = 1;
    const pending = new Map();
    const eventHandlers = [];

    ws.addEventListener("error", e => reject(e));
    ws.addEventListener("open", () => resolve(client));
    ws.addEventListener("message", e => {
      const msg = JSON.parse(e.data);
      if (msg.id !== undefined) {
        const p = pending.get(msg.id);
        if (p) { pending.delete(msg.id); p(msg); }
      } else if (msg.method) {
        for (const { method, fn } of eventHandlers) {
          if (method === msg.method) fn(msg.params);
        }
      }
    });

    const client = {
      send(method, params = {}) {
        return new Promise(resolve => {
          const id = msgId++;
          pending.set(id, resolve);
          ws.send(JSON.stringify({ id, method, params }));
        });
      },
      on(method, fn) { eventHandlers.push({ method, fn }); },
      close() { ws.close(); },
    };
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── page helpers ────────────────────────────────────────────────────────────

async function evalPage(cdp, expr) {
  const r = await cdp.send("Runtime.evaluate", {
    expression: `(async()=>{${expr}})()`,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.result?.exceptionDetails)
    throw new Error("eval: " + JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
}

async function evalReturn(cdp, expr) {
  const r = await cdp.send("Runtime.evaluate", {
    expression: expr,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.result?.exceptionDetails)
    throw new Error("evalReturn: " + JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
}

async function screenshot(cdp, label, stepNum) {
  const r = await cdp.send("Page.captureScreenshot", { format: "png" });
  const p = join(SS_DIR, `cdpv-${String(stepNum).padStart(2, "0")}-${label}.png`);
  const { writeFileSync } = await import("fs");
  writeFileSync(p, Buffer.from(r.result.data, "base64"));
  console.log(`  📸 ${p}`);
}

async function getScrollTop(cdp) {
  return evalReturn(cdp, `document.querySelector(".mdv-preview")?.scrollTop ?? -1`);
}

async function scrollPreviewTo(cdp, px) {
  await evalPage(cdp, `document.querySelector(".mdv-preview").scrollTop = ${px}`);
  await sleep(300);
  return getScrollTop(cdp);
}

async function clickTab(cdp, path) {
  await evalPage(cdp, `
    const t = Array.from(document.querySelectorAll(".mdv-tab"))
      .find(el => el.getAttribute("title") === ${JSON.stringify(path)});
    (t?.querySelector(".mdv-tab__select") ?? t)?.click();
  `);
  await sleep(400);
}

async function getTabs(cdp) {
  const s = await evalReturn(cdp, `JSON.stringify(
    Array.from(document.querySelectorAll(".mdv-tab")).map(t => ({
      path: t.getAttribute("title") ?? "",
      title: (t.querySelector(".mdv-tab__select")?.textContent ?? "").trim(),
      active: t.classList.contains("is-active"),
    }))
  )`);
  return JSON.parse(s);
}

async function openFile(cdp, path) {
  await evalPage(cdp, `
    await window.__TAURI_INTERNALS__.invoke("plugin:event|emit", {
      event: "marka:open-file",
      payload: ${JSON.stringify(path)},
    })
  `);
  await sleep(800);
}

async function closeTab(cdp, path) {
  await evalPage(cdp, `
    const tab = Array.from(document.querySelectorAll(".mdv-tab"))
      .find(el => el.getAttribute("title") === ${JSON.stringify(path)});
    const btn = tab?.querySelector(".mdv-tab__close, button[aria-label*='lose']");
    if (btn) btn.click();
    else if (tab) tab.dispatchEvent(new MouseEvent("auxclick", { bubbles: true, button: 1 }));
  `);
  await sleep(400);
}

async function ensureTestTabs(cdp) {
  for (const f of TEST_FILES) {
    const tabs = await getTabs(cdp);
    const matches = tabs.filter(t => t.path === f);
    if (matches.length === 0) {
      console.log(`  Opening: ${f.split("\\").pop()}`);
      await openFile(cdp, f);
    } else while (matches.length-- > 1) {
      await closeTab(cdp, f);
    }
  }
}

// ── main ────────────────────────────────────────────────────────────────────

const pass = [];
const fail = [];
let stepNum = 0;

console.log("=== 스크롤 기억 검증 (동일 콘텐츠 파일) ===\n");

const wsUrl = await getPageWsUrl();
const cdp = await createCDPClient(wsUrl);
await cdp.send("Runtime.enable");
await cdp.send("Page.enable");

// console capture
const consoleLogs = [];
cdp.on("Runtime.consoleAPICalled", params => {
  const text = params.args.map(a => a.value ?? a.description ?? "").join(" ");
  if (text.startsWith("[mem]") || text.startsWith("[sync]")) {
    consoleLogs.push(text);
    console.log(`  LOG: ${text}`);
  }
});

console.log("테스트 파일:");
TEST_FILES.forEach((f, i) => console.log(`  Tab ${String.fromCharCode(65+i)}: ${f.split("\\").pop()}`));
console.log("");

await ensureTestTabs(cdp);
await sleep(300);

const tabs = await getTabs(cdp);
const tabA = tabs.find(t => t.path === pathA);
const tabB = tabs.find(t => t.path === pathB);
if (!tabA || !tabB) {
  console.log("❌ BLOCKED — 탭을 찾을 수 없음:", tabs.map(t => t.path));
  cdp.close(); process.exit(2);
}
console.log(`탭 확인: A="${tabA.title}"  B="${tabB.title}"\n`);
await screenshot(cdp, "initial", stepNum++);

// ── 1. Tab A 스크롤 ──
console.log("1. Tab A → 400px 스크롤");
await clickTab(cdp, pathA);
await sleep(200);
const aSet = await scrollPreviewTo(cdp, 400);
console.log(`   기준 위치: ${aSet}px`);
await screenshot(cdp, "tabA-scrolled", stepNum++);
consoleLogs.length = 0;

// ── 2. Tab B 스크롤 ──
console.log("\n2. Tab B → 700px 스크롤");
await clickTab(cdp, pathB);
await sleep(200);
const bSet = await scrollPreviewTo(cdp, 700);
console.log(`   기준 위치: ${bSet}px`);
await screenshot(cdp, "tabB-scrolled", stepNum++);
consoleLogs.length = 0;

// ── 3. Tab A 복귀 ──
console.log(`\n3. Tab A 복귀 → ${aSet}px 복원 확인`);
await clickTab(cdp, pathA);
const aRestored = await getScrollTop(cdp);
const passA = Math.abs(aRestored - aSet) <= 5;
console.log(`   Got ${aRestored}px  (기준 ${aSet}px)  ${passA ? "✅ PASS" : "❌ FAIL"}`);
passA ? pass.push("Tab A 복원") : fail.push(`Tab A: got ${aRestored}, expected ${aSet}`);
await screenshot(cdp, "tabA-restored", stepNum++);
consoleLogs.length = 0;

// ── 4. Tab B 복귀 ──
console.log(`\n4. Tab B 복귀 → ${bSet}px 복원 확인`);
await clickTab(cdp, pathB);
const bRestored = await getScrollTop(cdp);
const passB = Math.abs(bRestored - bSet) <= 5;
console.log(`   Got ${bRestored}px  (기준 ${bSet}px)  ${passB ? "✅ PASS" : "❌ FAIL"}`);
passB ? pass.push("Tab B 복원") : fail.push(`Tab B: got ${bRestored}, expected ${bSet}`);
await screenshot(cdp, "tabB-restored", stepNum++);
consoleLogs.length = 0;

// ── 5. 고속 전환 후 Tab A ──
console.log("\n5. 🔍 A→B 3회 고속 전환 후 Tab A");
for (let i = 0; i < 3; i++) {
  await clickTab(cdp, pathA); await sleep(120);
  await clickTab(cdp, pathB); await sleep(120);
}
await clickTab(cdp, pathA);
const aRapid = await getScrollTop(cdp);
const passRapid = Math.abs(aRapid - aSet) <= 20;
console.log(`   Got ${aRapid}px  (기준 ±20px of ${aSet})  ${passRapid ? "✅ PASS" : "❌ FAIL"}`);
passRapid ? pass.push("고속전환 후 Tab A") : fail.push(`고속전환: got ${aRapid}, expected ~${aSet}`);
await screenshot(cdp, "rapid-final", stepNum++);
consoleLogs.length = 0;

// ── 6. 반복 방문 drift ──
console.log("\n6. 🔍 Tab A 3회 반복 방문 — drift ≤ 5px");
const snapshots = [];
for (let i = 0; i < 3; i++) {
  await evalPage(cdp, `
    const b = Array.from(document.querySelectorAll(".mdv-tab"))
      .find(el => el.getAttribute("title") === ${JSON.stringify(pathB)});
    (b?.querySelector(".mdv-tab__select") ?? b)?.click();
  `);
  await sleep(250);
  await evalPage(cdp, `
    const a = Array.from(document.querySelectorAll(".mdv-tab"))
      .find(el => el.getAttribute("title") === ${JSON.stringify(pathA)});
    (a?.querySelector(".mdv-tab__select") ?? a)?.click();
  `);
  await sleep(400);
  snapshots.push(await getScrollTop(cdp));
}
const maxDrift = Math.max(...snapshots) - Math.min(...snapshots);
const passDrift = maxDrift <= 5;
console.log(`   방문별 위치: ${snapshots.join("px, ")}px`);
console.log(`   최대 drift: ${maxDrift.toFixed(1)}px  ${passDrift ? "✅ PASS" : "❌ FAIL"}`);
passDrift ? pass.push("drift 없음") : fail.push(`Drift: ${maxDrift.toFixed(1)}px`);
await screenshot(cdp, "drift-final", stepNum++);

// ── 요약 ──
const verdict = fail.length === 0;
console.log("\n════════════════════════════════════");
pass.forEach(p => console.log(`  ✅ ${p}`));
fail.forEach(f => console.log(`  ❌ ${f}`));
console.log(`\nVerdict: ${verdict ? "✅ PASS" : "❌ FAIL"}`);
console.log("════════════════════════════════════");

cdp.close();
process.exit(verdict ? 0 : 1);
