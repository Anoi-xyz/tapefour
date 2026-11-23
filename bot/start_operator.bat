@echo off
REM bot/start_operator.bat
REM Windows batch script to run TapeFour Bot Operator with auto-restart on crash.

echo === TapeFour Bot Operator Startup ===
setlocal enabledelayedexpansion

cd /d "%~dp0\.."

if exist .env (
  echo Loading .env...
  for /f "usebackq tokens=1,* delims==" %%A in (".env") do (
    set "line=%%A"
    if not "!line:~0,1!"=="#" (
      set "%%A=%%B"
    )
  )
)

if "%BOT_OPERATOR_KEY%"=="" (
  echo ERROR: BOT_OPERATOR_KEY is not set.
  exit /b 1
)

if "%TAPEFOUR_ADDRESS%"=="" (
  echo ERROR: TAPEFOUR_ADDRESS is not set.
  exit /b 1
)

if "%BOT_DIFFICULTY%"=="" set BOT_DIFFICULTY=medium
if "%XLAYER_RPC_URL%"=="" set XLAYER_RPC_URL=https://rpc.xlayer.tech

echo Bot Difficulty : %BOT_DIFFICULTY%
echo Target Contract: %TAPEFOUR_ADDRESS%
echo RPC Endpoint   : %XLAYER_RPC_URL%

:loop
echo [%date% %time%] Starting operator process...
call npx tsx bot/operator.ts
echo [%date% %time%] Operator crashed or stopped. Restarting in 5 seconds...
timeout /t 5 /nobreak >nul
goto loop
