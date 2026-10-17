#!/usr/bin/env bash
# Адрес сервера лежит в .deploy-host рядом со скриптом — он не в репозитории.
HOST="${RSP_HOST:-$(cat "$(dirname "$0")/.deploy-host" 2>/dev/null)}"
[ -n "$HOST" ] || { echo "Нет адреса: положи его в .deploy-host или задай RSP_HOST" >&2; exit 1; }
ssh "$HOST" 'cd /root/rsp-party-game && git pull && systemctl restart rsp'
