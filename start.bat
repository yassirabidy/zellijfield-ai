@echo off
rem Start Zellijfield AI. Usage: start.bat [mock^|wan2gp^|comfyui^|full]   (default: mock)
setlocal
cd /d "%~dp0"

set "ZF_PROFILE=%~1"
if "%ZF_PROFILE%"=="" set "ZF_PROFILE=mock"
if /i not "%ZF_PROFILE%"=="mock" if /i not "%ZF_PROFILE%"=="wan2gp" if /i not "%ZF_PROFILE%"=="comfyui" if /i not "%ZF_PROFILE%"=="full" (
    echo Unknown profile "%ZF_PROFILE%". Use one of: mock, wan2gp, comfyui, full.
    exit /b 2
)

call "%~dp0preflight.bat" %ZF_PROFILE%
if errorlevel 1 (
    echo.
    echo Fix the problems above, then run start.bat again.
    pause
    exit /b 1
)

echo.
echo Building and starting the "%ZF_PROFILE%" stack (the first GPU build can take 30-60 minutes)...
docker compose --profile %ZF_PROFILE% up -d --build
if errorlevel 1 (
    echo.
    echo docker compose failed. See the messages above, or run: docker compose logs
    pause
    exit /b 1
)

set "ZF_PORT=3000"
for /f "tokens=1,* delims==" %%A in ('findstr /b /c:"ZF_STUDIO_PORT=" .env 2^>nul') do set "ZF_PORT=%%B"

echo Waiting for the studio to become healthy...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$id = docker compose ps -q studio; for ($i = 0; $i -lt 60; $i++) { if ((docker inspect --format '{{.State.Health.Status}}' $id) -eq 'healthy') { exit 0 }; Start-Sleep -Seconds 2 }; exit 1"
if errorlevel 1 (
    echo The studio did not report healthy within 2 minutes. Check: docker compose logs studio
    pause
    exit /b 1
)

echo.
echo Zellijfield AI is running: http://127.0.0.1:%ZF_PORT%
if /i not "%ZF_PROFILE%"=="mock" echo GPU services keep loading in the background: docker compose logs -f
start "" "http://127.0.0.1:%ZF_PORT%"
exit /b 0
