#!/usr/bin/env bash
set -euo pipefail

TS_DIR="/tmp/tailscale"
TS_SOCKET="$TS_DIR/tailscaled.sock"
TS_SOCKS_PORT="1055"
DB_PROXY_PORT="6432"

mkdir -p "$TS_DIR"

echo "[1/4] Iniciando Tailscale..."

./.tailscale/tailscaled \
  --tun=userspace-networking \
  --state=mem: \
  --socket="$TS_SOCKET" \
  --socks5-server="127.0.0.1:$TS_SOCKS_PORT" \
  > /tmp/tailscaled.log 2>&1 &

TAILSCALED_PID=$!

trap 'kill "$TAILSCALED_PID" 2>/dev/null || true' EXIT INT TERM

for i in $(seq 1 30); do
    if [ -S "$TS_SOCKET" ]; then
        break
    fi
    sleep 1
done

if [ ! -S "$TS_SOCKET" ]; then
    echo "ERROR: tailscaled no creó su socket"
    cat /tmp/tailscaled.log || true
    exit 1
fi

echo "[2/4] Conectando Tailscale..."

./.tailscale/tailscale \
  --socket="$TS_SOCKET" \
  up \
  --auth-key="$TS_AUTHKEY" \
  --hostname="distriar-render" \
  --accept-dns=false

echo "[3/4] Tailscale conectado"

python pg_tailscale_proxy.py &
PROXY_PID=$!

trap 'kill "$PROXY_PID" 2>/dev/null || true; kill "$TAILSCALED_PID" 2>/dev/null || true' EXIT INT TERM

sleep 1

if ! kill -0 "$PROXY_PID" 2>/dev/null; then
    echo "ERROR: el proxy PostgreSQL no arrancó"
    exit 1
fi

echo "[4/4] Iniciando FastAPI..."

exec uvicorn app.main:app \
  --host 0.0.0.0 \
  --port "$PORT" \
  --loop asyncio \
  --http h11 \
  --workers 1