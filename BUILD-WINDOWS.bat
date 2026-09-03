@echo off
setlocal
cd /d "%~dp0"
title DS Mobile ^& Digital Hub - Windows Production Build
echo.
echo ================================================
echo   DS Mobile ^& Digital Hub - Production Build
echo ================================================
echo.

where node >nul 2>&1 || (echo ERROR: Node.js is not installed.& goto :fail)
where npm >nul 2>&1 || (echo ERROR: npm is not available.& goto :fail)
where cargo >nul 2>&1 || (echo ERROR: Rust/Cargo is not installed. Install Rust from rustup.rs first.& goto :fail)

if not exist node_modules (
  echo Installing npm dependencies...
  call npm install
  if errorlevel 1 (echo.& echo FAILED at: npm install & goto :fail)
)

echo.
echo Running TypeScript check...
call npm run typecheck
if errorlevel 1 (echo.& echo FAILED at: TypeScript check & goto :fail)

echo.
echo Running static security audit...
call npm run test:static
if errorlevel 1 (echo.& echo FAILED at: static security audit & goto :fail)

echo.
echo Building Windows installer...
call npm run tauri:build
if errorlevel 1 (echo.& echo FAILED at: tauri build & goto :fail)

echo.
echo BUILD COMPLETE.
echo Installer should be under:
echo   src-tauri\target\release\bundle\
echo.
pause
exit /b 0

:fail
echo.
echo ================================================
echo   BUILD FAILED - see the error above
echo ================================================
echo.
pause
exit /b 1
