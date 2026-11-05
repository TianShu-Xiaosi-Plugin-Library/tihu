@echo off
chcp 65001 >nul
setlocal
node "%~dp0pelican-open.mjs" %1 %2 %3 %4
echo.
pause
