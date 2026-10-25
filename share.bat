@echo off
rem Double-click to put Nahda on a public https link (works while this computer stays on).
cd /d "%~dp0"
echo Building the website...
cd frontend
call npm.cmd run build >nul
cd ..
start "Nahda backend" /min cmd /c "cd backend && python -m uvicorn main:app --port 8000"
start "Nahda website" /min cmd /c "cd frontend && npx.cmd vite preview --port 4173 --strictPort"
timeout /t 10 /nobreak >nul
echo.
echo Your public link is the https://....trycloudflare.com address printed below.
echo Keep this window open. Close it to take the site offline.
echo.
"C:\Program Files (x86)\cloudflared\cloudflared.exe" tunnel --no-autoupdate --url http://localhost:4173
