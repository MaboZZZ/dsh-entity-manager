#!/bin/bash
# ============================================================
#  DSH Entity Manager 一键打包
#  双击本文件即可自动生成桌面应用，无需任何编程知识。
#  产物位置在打包完成后会自动打开文件夹并提示。
# ============================================================
cd "$(dirname "$0")" || exit 1

# 结束时暂停，让窗口停留显示结果（DSHM_NO_PAUSE=1 可跳过，供自动化测试）
pause() {
  if [ -z "$DSHM_NO_PAUSE" ]; then
    echo
    read -rp "按回车键关闭窗口…"
  fi
}
trap pause EXIT

echo "=============================================="
echo "   DSH Entity Manager 一键打包"
echo "=============================================="

# ---------- 1. 检查环境 ----------
if ! command -v node > /dev/null 2>&1; then
  echo
  echo "❌ 未找到 Node.js"
  echo "   请先安装 Node.js（双击打开 https://nodejs.org 下载 LTS 版并安装）"
  exit 1
fi
if ! command -v pnpm > /dev/null 2>&1; then
  echo
  echo "❌ 未找到 pnpm"
  echo "   安装完 Node.js 后，打开终端执行: npm install -g pnpm"
  exit 1
fi

NODE_VER=$(node -v)
PNPM_VER=$(pnpm -v)
echo "✓ 环境就绪  Node $NODE_VER / pnpm $PNPM_VER"
echo "  （本机网络会自动使用国内镜像加速，请保持网络畅通）"
echo

# ---------- 2. 安装依赖（如缺失） ----------
if [ ! -d node_modules ]; then
  echo "⏳ 首次运行，正在安装依赖（可能需要几分钟）…"
  pnpm install || { echo; echo "❌ 依赖安装失败，请检查网络后重试"; exit 1; }
else
  echo "✓ 依赖已存在"
fi
echo

# ---------- 3. 构建 ----------
echo "⏳ 正在构建（可能需要几分钟）…"
pnpm --filter @dshm/manager build || { echo; echo "❌ 构建失败"; exit 1; }
pnpm --filter @dshm/ui build      || { echo; echo "❌ 构建失败"; exit 1; }
pnpm --filter @dshm/shell build   || { echo; echo "❌ 构建失败"; exit 1; }
echo "✓ 构建完成"
echo

# ---------- 4. 打包 ----------
echo "⏳ 正在生成安装包…"
export ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
export ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"

case "$(uname -s)" in
  Darwin) TARGET="--mac zip" ;;
  Linux)  TARGET="--linux" ;;
  MINGW*|MSYS*|CYGWIN*) TARGET="--win" ;;
  *) TARGET="" ;;
esac

(cd apps/shell && pnpm exec electron-builder $TARGET) || { echo; echo "❌ 打包失败"; exit 1; }
echo

# ---------- 5. 输出产物位置 ----------
ZIP=$(ls -t release/*.zip 2>/dev/null | head -n 1)
if [ -n "$ZIP" ]; then
  ABS=$(cd "$(dirname "$ZIP")" && pwd)/$(basename "$ZIP")
  echo "=============================================="
  echo " ✅ 打包完成！"
  echo
  echo " 📦 安装包位置:"
  echo "    $ABS"
  echo
  echo " 使用步骤:"
  echo "   1. 双击上面的 zip 文件解压"
  echo "   2. 打开解压后的 “DSH Entity Manager.app”"
  echo "=============================================="
  # 自动打开产物所在文件夹（macOS / Linux）
  case "$(uname -s)" in
    Darwin) open "$(dirname "$ZIP")" 2>/dev/null || true ;;
    Linux)  xdg-open "$(dirname "$ZIP")" 2>/dev/null || true ;;
  esac
else
  echo "⚠️  未找到打包产物，请检查上方输出是否报错"
  exit 1
fi
