@echo off
rem Builds bin\apploopback.exe with the Visual Studio C++ toolchain
rem (Visual Studio 2019/2022 with "Desktop development with C++").
setlocal
set "VCVARS="
for %%P in ("%ProgramFiles%" "%ProgramFiles(x86)%") do (
  for %%Y in (2022 2019) do (
    for %%E in (Community Professional Enterprise BuildTools) do (
      if not defined VCVARS if exist "%%~P\Microsoft Visual Studio\%%Y\%%E\VC\Auxiliary\Build\vcvars64.bat" set "VCVARS=%%~P\Microsoft Visual Studio\%%Y\%%E\VC\Auxiliary\Build\vcvars64.bat"
    )
  )
)
if not defined VCVARS (
  echo Visual Studio C++ tools not found. Install "Desktop development with C++".
  exit /b 1
)
call "%VCVARS%" >nul || exit /b 1
cd /d "%~dp0"
if not exist "..\bin" mkdir "..\bin"
cl /nologo /O2 /EHsc /std:c++17 /DUNICODE /D_UNICODE apploopback.cpp /Fe:..\bin\apploopback.exe /Fo:%TEMP%\apploopback.obj /link /SUBSYSTEM:CONSOLE
exit /b %ERRORLEVEL%
