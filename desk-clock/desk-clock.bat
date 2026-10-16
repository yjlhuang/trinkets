@echo off
cd /d "%~dp0"
rem 背景啟動,不留 cmd 視窗。結束:時鐘右鍵 → 結束(或系統匣圖示右鍵 → 結束)
start "" powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0desk-clock.ps1" %*
