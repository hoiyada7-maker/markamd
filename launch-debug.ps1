# launch-debug.ps1 — starts marka.md dev server with WebView2 remote debugging enabled.
# CDP endpoint: http://localhost:9229
# Use this when running verify scripts (scripts/verify-*.mjs).

$vcvarsall = "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvarsall.bat"
cmd /c "`"$vcvarsall`" x64 && set" | ForEach-Object {
    if ($_ -match "^([^=]+)=(.*)$") { Set-Item -Path "Env:\$($Matches[1])" -Value $Matches[2] -ErrorAction SilentlyContinue }
}
$env:PATH = "C:\Users\su\.bun\bin;$env:PATH"

# Enable WebView2 remote debugging on port 9229
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9229"

Set-Location "C:\Users\su\pjt\markamd"
npm run tauri dev
