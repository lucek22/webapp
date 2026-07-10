@echo off
title Scarlet Biomechanics Launcher
echo ==========================================
echo    SCARLET BIOMECHANICS WEB APP LAUNCHER
echo ==========================================
echo.
echo Starting local web server on port 8000...
echo Bypassing browser local security restrictions (CORS) for ES Modules...
echo.
echo Automatically opening your default web browser at http://localhost:8000...
start "" "http://localhost:8000"
python -m http.server 8000
