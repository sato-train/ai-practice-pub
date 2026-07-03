@echo off
title Daily Memo Server
cd /d "E:\ai-practice\tool_daily_memo"
set "CODEX=C:\Users\USER\.codex\plugins\.plugin-appserver\codex.exe"

"%CODEX%" login status >nul 2>&1
if errorlevel 1 (
  echo Codex login is required. Opening the login page...
  "%CODEX%" login
  if errorlevel 1 (
    echo.
    echo Codex login failed.
    pause
    exit /b 1
  )
)

"C:\Users\USER\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" "E:\ai-practice\tool_daily_memo\server.py"
if errorlevel 1 (
  echo.
  echo Daily Memo failed to start.
  pause
)
