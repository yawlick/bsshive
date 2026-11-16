#!/usr/bin/env bash
# BSS Hive: запустить локальный сайт и открыть его в браузере.
# --watch: сервер сам перезапускается, когда меняется его код.
cd "$(dirname "$0")"
PORT="${PORT:-8820}"
( sleep 1; xdg-open "http://localhost:$PORT" >/dev/null 2>&1 ) &
exec node --watch site/server.mjs
