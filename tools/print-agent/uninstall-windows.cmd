@echo off
setlocal
set "LAUNCHER=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\ZENVIA Print Agent.cmd"
if exist "%LAUNCHER%" del /q "%LAUNCHER%"
echo ZENVIA Print Agent eliminado del inicio automatico.
echo Si esta ejecutandose, cierra la ventana/proceso actual manualmente.
pause
