#!/usr/bin/env sh
set -eu

if [ ! -f .env ]; then
  echo "缺少 .env。请先执行：cp .env.example .env，并替换全部 CHANGE_ME。" >&2
  exit 1
fi

if grep -qE '^[A-Z_]+=.*CHANGE_ME' .env; then
  echo ".env 仍包含 CHANGE_ME，占位密钥不能用于部署。" >&2
  exit 1
fi

docker compose config --quiet
docker compose build
docker compose up -d
docker compose ps
echo "部署完成。健康检查：curl -fsS http://127.0.0.1:${APP_PORT:-8088}/api/v1/health"
