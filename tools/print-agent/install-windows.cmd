@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js no esta instalado. Instala Node.js 18 o superior y vuelve a ejecutar este archivo.
  pause
  exit /b 1
)

echo Instalando dependencias de ZENVIA Print Agent...
call npm install
if errorlevel 1 (
  echo No se pudo instalar ZENVIA Print Agent.
  pause
  exit /b 1
)

set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "LAUNCHER=%STARTUP%\ZENVIA Print Agent.cmd"

(
  echo @echo off
  echo cd /d "%~dp0"
  echo start "" /min cmd /c ""%~dp0start-windows.cmd""
) > "%LAUNCHER%"

echo.
echo ZENVIA Print Agent instalado.
echo Se iniciara automaticamente al entrar en Windows.
echo Iniciando ahora...
start "" /min cmd /c ""%~dp0start-windows.cmd""
echo.
pause
