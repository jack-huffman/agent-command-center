@echo off
rem acc's launcher for Windows' own shells, cmd and PowerShell (D-077, D-209). It does what the sh
rem launcher `acc` beside it does, for the shells that can't run that one: Git's sh, which runs Claude
rem Code's hooks on Windows, runs `acc` itself. It runs the bundled acc.mjs beside it with the first
rem runtime it finds, so acc works with no Node installed:
rem   1. %ACC_NODE%, when set: an explicit choice, so a wrong one is an error, not a fallback.
rem   2. node on PATH, when it's version 20 or later.
rem   3. The VSCode runtime the extension records in %USERPROFILE%\.acc\runtime (%ACC_RUNTIME_FILE% overrides it).
rem With none, `acc hook ...` exits 0 without a word, so a hook never breaks a Claude Code session
rem (D-042). Anything else gets one line that names the fix. Each branch is a goto, not a ( block ):
rem a folder such as "Program Files (x86)" would end a block early.
setlocal EnableExtensions DisableDelayedExpansion
set "mjs=%~dp0acc.mjs"
if exist "%mjs%" goto :found
set "problem=acc.mjs is missing from %~dp0: reinstall Agent Command Center."
goto :fail

:found
if not defined ACC_NODE goto :node
rem ACC_NODE is a path, or a name on PATH.
set "rt="
if exist "%ACC_NODE%" set "rt=%ACC_NODE%"
if not defined rt for /f "delims=" %%P in ('where "%ACC_NODE%" 2^>nul') do if not defined rt set "rt=%%P"
if defined rt goto :as_node
set "problem=ACC_NODE is set to %ACC_NODE%, which acc can't run: point it at a node 20 or later, or unset it."
goto :fail

:node
set "node="
for /f "delims=" %%P in ('where node 2^>nul') do if not defined node set "node=%%P"
if not defined node goto :runtime
set "ver="
for /f "delims=" %%V in ('call "%node%" --version 2^>nul') do set "ver=%%V"
set "major="
for /f "tokens=1 delims=v." %%M in ("%ver%") do set "major=%%M"
rem A version that isn't a number counts as too old.
echo(%major%| findstr /r "^[0-9][0-9]*$" >nul || goto :runtime
if %major% LSS 20 goto :runtime
"%node%" "%mjs%" %*
exit /b %errorlevel%

:runtime
set "file=%ACC_RUNTIME_FILE%"
if not defined file set "file=%USERPROFILE%\.acc\runtime"
set "rt="
rem The extension writes the path and a newline; set /p reads the first line, with or without one.
if exist "%file%" set /p rt=<"%file%"
if defined rt if exist "%rt%" goto :as_node
set "problem=acc needs Node 20 or later: open VSCode with Agent Command Center once, install Node 20 or later, or set ACC_NODE."
goto :fail

:as_node
rem Electron's runtime acts as Node only with this set. Real node ignores it.
set "ELECTRON_RUN_AS_NODE=1"
"%rt%" "%mjs%" %*
exit /b %errorlevel%

:fail
if "%~1"=="hook" exit /b 0
>&2 echo x %problem%
exit /b 1
