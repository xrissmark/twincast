@echo off
rem Runs the TwinCast server on this PC (for testing; normally it runs on your VPS).
cd /d "%~dp0server"
if not exist node_modulesws if not exist ..
ode_modulesws call npm install
node server.js
pause
