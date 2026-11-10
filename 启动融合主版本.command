#!/bin/zsh
set -e
cd -- "$(dirname -- "$0")"
if ! command -v node >/dev/null 2>&1; then
  print -u2 '未找到 Node.js，请安装 Node.js 24.14.0 或以上版本并加入 PATH。'
  exit 1
fi
exec node start-fusion.mjs "$@"
