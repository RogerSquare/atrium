@echo off
cd /d "%~dp0"

echo Starting Atrium...

echo Starting backend...
start "Atrium - Backend" cmd /k "cd backend && npm install && npm start"

echo Starting frontend...
start "Atrium - Frontend" cmd /k "cd frontend && npm install && npm run dev"

echo Services are starting in separate windows!
