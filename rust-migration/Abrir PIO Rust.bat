@echo off
title PIW Nailo - Rust Launcher
cd /d "%~dp0src-tauri"
echo ===================================================
echo   PIW Nailo - Launcher Rust Nativo + Headless
echo ===================================================
echo.

echo Fechando instancia anterior (se houver)...
taskkill /F /IM pio-nailo-rust.exe >nul 2>&1
ping 127.0.0.1 -n 2 >nul

echo Compilando e iniciando PIW Nailo Rust...
cargo build
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo Erro ao compilar.
    pause
    exit /b %ERRORLEVEL%
)

start "" "%~dp0src-tauri\target\debug\pio-nailo-rust.exe"
exit /b 0
