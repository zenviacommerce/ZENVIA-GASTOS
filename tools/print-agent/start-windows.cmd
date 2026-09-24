@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js no esta instalado. Instala Node.js 18 o superior y vuelve a ejecutar este archivo.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Instalando ZENVIA Print Agent...
  call npm install
  if errorlevel 1 (
    echo No se pudo instalar ZENVIA Print Agent.
    pause
    exit /b 1
  )
)
echo Iniciando ZENVIA Print Agent...
call npm start
