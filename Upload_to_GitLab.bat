@echo off
setlocal

REM GitLab upload helper for the repository folder containing this file.
cd /d "%~dp0"

echo ==========================================
echo   HomePage - GitLab add, commit, and push
echo ==========================================
echo.

REM Confirm this is a Git repository.
git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
    echo [ERROR] This file must be placed in the HomePage Git repository folder.
    pause
    exit /b 1
)

REM Require the main branch to avoid pushing the wrong branch by mistake.
for /f "delims=" %%B in ('git branch --show-current') do set "BRANCH=%%B"
if not "%BRANCH%"=="main" (
    echo [ERROR] Current branch is "%BRANCH%", not "main".
    echo Switch to main in GitHub Desktop or PowerShell, then run this file again.
    pause
    exit /b 1
)

REM Get today's date in an unambiguous format.
for /f "delims=" %%D in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd"') do set "TODAY=%%D"
if not defined TODAY (
    echo [ERROR] Could not determine today's date.
    pause
    exit /b 1
)

echo [1/3] Staging changed files...
git add -A
if errorlevel 1 (
    echo [ERROR] git add failed.
    pause
    exit /b 1
)

REM Commit only when there are staged changes.
git diff --cached --quiet
if errorlevel 1 (
    echo [2/3] Creating commit: %TODAY%
    git commit -m "%TODAY%"
    if errorlevel 1 (
        echo [ERROR] Commit failed. Check the message above.
        pause
        exit /b 1
    )
) else (
    echo [2/3] No new changes to commit. Continuing to push existing commits...
)

echo [3/3] Pushing main to GitLab...
git push gitlab main
if errorlevel 1 (
    echo.
    echo [ERROR] Push to GitLab failed.
    echo The GitLab branch may contain commits not present locally.
    echo Do not use force push. Fetch and inspect with:
    echo   git fetch gitlab
    echo   git log --oneline --graph --decorate --all -10
    pause
    exit /b 1
)

echo.
echo [SUCCESS] GitLab main has been updated.
echo Commit date/message: %TODAY%
pause
endlocal
