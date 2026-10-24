@echo off
rem Stop every Zellijfield AI container. Images, models and data are kept.
setlocal
cd /d "%~dp0"
docker compose --profile full down
if errorlevel 1 (
    pause
    exit /b 1
)
echo Zellijfield AI stopped.
