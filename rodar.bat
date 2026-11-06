@echo off
cd /d %~dp0
echo Abra http://localhost:8000
python\python.exe -m http.server 8000
