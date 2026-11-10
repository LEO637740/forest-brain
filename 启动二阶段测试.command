#!/bin/bash
# 双击运行：停止旧版前后端（仅 4188/4173 端口），再启动 2.4.0 新版本。
cd "$(dirname "$0")"
for port in 4188 4173; do
  pids=$(lsof -ti tcp:$port -sTCP:LISTEN 2>/dev/null)
  if [ -n "$pids" ]; then echo "停止占用端口 $port 的旧服务：$pids"; kill $pids; fi
done
sleep 3
echo "启动橡胶大脑 2.4.0（关闭后台自动模型分析；对话中的已配置模型仍可使用）"
node start.mjs --no-automatic
