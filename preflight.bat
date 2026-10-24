@echo off
rem Zellijfield AI preflight. Usage: preflight.bat [mock^|wan2gp^|comfyui^|full]
setlocal
set "ZF_PROFILE=%~1"
if "%ZF_PROFILE%"=="" set "ZF_PROFILE=mock"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\preflight.ps1" -StackProfile "%ZF_PROFILE%"
exit /b %ERRORLEVEL%
