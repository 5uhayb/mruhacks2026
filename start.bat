@echo off
rem Double-click to start Nahda: backend, frontend, then opens the browser.
cd /d "%~dp0"
start "Nahda backend" /min cmd /c "cd backend && python -m uvicorn main:app --port 8000"
start "Nahda frontend" /min cmd /c "cd frontend && npm run dev"
echo Starting Nahda... the browser opens in about 15 seconds.
timeout /t 15 /nobreak >nul
start "" http://localhost:5173/?c=LBY
