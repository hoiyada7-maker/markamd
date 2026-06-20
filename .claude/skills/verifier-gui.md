# verifier-gui — marka.md GUI 검증 스킬

GUI 변경사항을 검증할 때 이 스킬을 따른다.

## 환경 요구사항

- CDP 디버깅 포트 9229 (`launch-debug.ps1` 으로 실행 시 자동 활성화)
- `playwright` devDependency 설치됨 (`bun add -d playwright`)
- Node.js 22+

## 앱 시작 (디버그 모드)

CDP 포트 없이 실행 중이면 먼저 재시작:

```powershell
# 기존 인스턴스 종료
Stop-Process -Name "marka","marka.md" -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

# 디버그 모드로 재시작 (CDP port 9229 열림)
Start-Process pwsh -ArgumentList "-NoProfile","-Command","& 'C:\Users\su\pjt\markamd\launch-debug.ps1' 2>&1 | Tee-Object 'C:\Users\su\pjt\markamd\dev-server.log'" -WindowStyle Hidden

# 앱 실행 대기
until (Invoke-RestMethod "http://127.0.0.1:9229/json" -ErrorAction SilentlyContinue) { Start-Sleep -Seconds 2 }
```

CDP 활성화 확인:
```powershell
(Invoke-RestMethod "http://127.0.0.1:9229/json").url
# → "http://localhost:1420/" 가 나와야 함
```

## 스크린샷 / JS 실행 (Playwright CDP)

```javascript
import { chromium } from "playwright";

const browser = await chromium.connectOverCDP("http://127.0.0.1:9229");
const page = browser.contexts()[0].pages()[0];

// 스크린샷
await page.screenshot({ path: "screenshot.png" });

// JS 실행 (Tauri webview 내부)
const scrollTop = await page.evaluate(() =>
  document.querySelector(".mdv-preview")?.scrollTop ?? -1
);

// 탭 클릭
await page.evaluate((id) =>
  document.querySelector(`[data-tab-id="${id}"]`)?.click()
, tabId);

await browser.close();
```

## 스크롤 기억 자동 검증

앱에 파일 2개 이상 탭으로 연 상태에서:

```powershell
node scripts/verify-scroll.mjs
# 또는
bun scripts/verify-scroll.mjs
```

결과:
- `scripts/screenshots/` — 단계별 스크린샷
- `scripts/screenshots/report.txt` — 텍스트 리포트
- exit code 0 = PASS, 1 = FAIL, 2 = BLOCKED

## 일반 검증 절차

1. `launch-debug.ps1` 으로 앱 시작 (CDP 포트 열기)
2. Playwright CDP 로 연결
3. 변경된 기능을 직접 조작 (클릭, 스크롤, 타이핑)
4. `page.screenshot()` 으로 증거 캡처
5. `page.evaluate()` 로 DOM 상태 확인
6. `SendUserFile` 로 스크린샷 첨부

## DOM 셀렉터 참조

| 요소 | 셀렉터 |
|------|--------|
| 프리뷰 스크롤 컨테이너 | `.mdv-preview` |
| 에디터 스크롤 컨테이너 | `.cm-scroller` |
| 탭 버튼 | `[data-tab-id="<id>"]` |
| 마크다운 본문 | `.mdv-prose` |
| 검색창 | `.mdv-find` |
| 타이틀바 | `.mdv-titlebar` |
