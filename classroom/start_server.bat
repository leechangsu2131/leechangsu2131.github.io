@echo off
chcp 65001 > nul
echo ===================================================
echo   [홈페이지 실시간 수업 모니터링 로컬 서버]
echo ===================================================
echo.
echo 브라우저에서 아래 주소로 접속합니다:
echo http://localhost:8000/classroom/teacher.html
echo.
echo 서버를 종료하려면 이 창에서 Ctrl + C 를 누르세요.
echo.
start http://localhost:8000/classroom/teacher.html?mock=1
python -m http.server 8000
