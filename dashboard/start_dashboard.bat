@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ========================================
echo  Sporton HR Dashboard starting...
echo ========================================
echo.
echo Required environment variables:
echo   HR_DASHBOARD_PASSWORD
echo   SESSION_SECRET
echo   N8N_HR_WEBHOOK_URL
echo   N8N_HR_TOKEN
echo.
echo Opening http://localhost:8080
echo ========================================
start "" "http://localhost:8080"
npm start