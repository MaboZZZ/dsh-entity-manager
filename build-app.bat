@echo off
rem ============================================================
rem  DSH Entity Manager 一键打包（Windows）
rem  双击本文件即可自动生成桌面应用，无需任何编程知识。
rem  产物位置在打包完成后会自动打开并提示。
rem ============================================================
chcp 65001 >nul
cd /d "%~dp0"

echo ==============================================
echo    DSH Entity Manager 一键打包
echo ==============================================
echo.

rem ---------- 1. 检查环境 ----------
where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo [X] 未找到 Node.js
  echo     请先安装 Node.js：打开 https://nodejs.org 下载 LTS 版并安装
  echo.
  pause
  exit /b 1
)
where pnpm >nul 2>&1
if errorlevel 1 (
  echo.
  echo [X] 未找到 pnpm
  echo     安装完 Node.js 后，打开命令行执行: npm install -g pnpm
  echo.
  pause
  exit /b 1
)
echo [OK] 环境就绪  Node %~z0 检查中...
for /f "delims=" %%v in ('node -v') do set NODE_VER=%%v
for /f "delims=" %%v in ('pnpm -v') do set PNPM_VER=%%v
echo      Node %NODE_VER% / pnpm %PNPM_VER%
echo.
echo      （本机网络会自动使用国内镜像加速，请保持网络畅通）
echo.

rem ---------- 2. 安装依赖（如缺失） ----------
if not exist node_modules (
  echo [..] 首次运行，正在安装依赖（可能需要几分钟）...
  call pnpm install
  if errorlevel 1 (
    echo.
    echo [X] 依赖安装失败，请检查网络后重试
    echo.
    pause
    exit /b 1
  )
) else (
  echo [OK] 依赖已存在
)
echo.

rem ---------- 3. 构建 ----------
echo [..] 正在构建（可能需要几分钟）...
call pnpm --filter @dshm/manager build
if errorlevel 1 ( echo. & echo [X] 构建失败 & pause & exit /b 1 )
call pnpm --filter @dshm/ui build
if errorlevel 1 ( echo. & echo [X] 构建失败 & pause & exit /b 1 )
call pnpm --filter @dshm/shell build
if errorlevel 1 ( echo. & echo [X] 构建失败 & pause & exit /b 1 )
echo [OK] 构建完成
echo.

rem ---------- 4. 打包 ----------
echo [..] 正在生成安装包...
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
set ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
pushd apps\shell
call pnpm exec electron-builder --win
if errorlevel 1 (
  popd
  echo.
  echo [X] 打包失败
  echo.
  pause
  exit /b 1
)
popd
echo.

rem ---------- 5. 输出产物位置 ----------
set "ZIP="
for /f "delims=" %%f in ('dir /b /o-d release\*.exe 2^>nul') do if not defined ZIP set "ZIP=release\%%f"
if not defined ZIP for /f "delims=" %%f in ('dir /b /o-d release\*.zip 2^>nul') do if not defined ZIP set "ZIP=release\%%f"
if defined ZIP (
  echo ==============================================
  echo  打包完成！
  echo.
  echo  安装包位置:
  echo     %CD%\%ZIP%
  echo.
  echo  使用步骤:
  echo     1. 双击上面的安装包文件
  echo     2. 按提示安装，然后从开始菜单打开 DSH Entity Manager
  echo ==============================================
  explorer /select,"%CD%\%ZIP%"
) else (
  echo [WARN] 未找到打包产物，请检查上方输出是否报错
  pause
  exit /b 1
)
echo.
pause
