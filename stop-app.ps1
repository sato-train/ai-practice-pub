$pidFile = Join-Path $PSScriptRoot ".daily-memo.pid"

if (Test-Path $pidFile) {
    $serverPid = Get-Content -LiteralPath $pidFile -ErrorAction SilentlyContinue
    if ($serverPid) {
        Stop-Process -Id $serverPid -ErrorAction SilentlyContinue
    }
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
}

Add-Type -AssemblyName PresentationFramework
[System.Windows.MessageBox]::Show("Daily Memoを停止しました。", "Daily Memo", "OK", "Information") | Out-Null
