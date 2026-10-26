@echo off
REM Doble clic para abrir generalito en el navegador (Windows).
cd /d "%~dp0"
where uv >nul 2>nul || (echo Falta instalar uv: https://docs.astral.sh/uv/getting-started/installation/ & pause & exit /b 1)
uv run generalito
pause
