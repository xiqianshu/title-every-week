#!/bin/bash
set -euo pipefail
/bin/launchctl bootout "gui/$(id -u)/com.creatorworkflow.local" || true
/bin/launchctl disable "gui/$(id -u)/com.creatorworkflow.local"
printf '已停用后台；个人素材、报告和账号设置保留。需要重新启用时再次运行安装.command。\n'
