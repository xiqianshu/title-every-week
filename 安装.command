#!/bin/bash
set -euo pipefail
creator_source="$(cd "$(dirname "$0")" && pwd)"
creator_target="$HOME/creator-workflow/automation"
trap 'printf "\n安装尚未完成，请保留以上错误信息。\n"; read -r -p "按回车关闭…"' ERR
if ! command -v node >/dev/null 2>&1; then printf '请先安装 Node.js LTS，再打开此文件。\n'; exit 1; fi
node -e 'if(Number(process.versions.node.split(".")[0])<22){console.error("需要 Node.js 22 或更新版本");process.exit(1)}'
mkdir -p "$creator_target"
/bin/launchctl bootout "gui/$(id -u)/com.creatorworkflow.local" >/dev/null 2>&1 || true
if [ "$creator_source" != "$creator_target" ]; then
  for creator_item in src public schemas package.json package-lock.json README.md THIRD_PARTY.md licenses 安装.command 打开工作台.command 停用后台.command; do cp -R "$creator_source/$creator_item" "$creator_target/"; done
fi
cd "$creator_target"
printf '正在安装固定版本依赖；现有个人素材和账号设置会保留。\n'
npm ci --ignore-scripts --no-audit --no-fund
node src/cli.mjs install-mac
open 'http://127.0.0.1:38473'
printf '\n后台已安装。终端可以关闭，请在打开的工作台完成浏览器连接。\n'
