@echo off
cd /d "%~dp0"

echo Starting Agent Task Board...

echo Starting backend...
start "Agent Task Board - Backend" cmd /k "cd backend && npm install && npm start"

echo Starting frontend...
start "Agent Task Board - Frontend" cmd /k "cd frontend && npm install && npm run dev"

echo Services are starting in separate windows!
