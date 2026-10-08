#!/usr/bin/env bash
set -euo pipefail

TS_DIR="/tmp/tailscale"
TS_SOCKET="$TS_DIR/tailscaled.sock"
TS_SOCKS_PORT="1055"
DB_PROXY_PORT="6432"
PG_TARGET_HOST="100.127.197.79"
PG_TARGET_PORT="5432"

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

echo "[TAILSCALE DIAGNOSTIC START]"
echo "[tailscale] diagnostic_stage=before_postgres_proxy"
echo "[tailscale] tailscaled_pid=$TAILSCALED_PID socket=$TS_SOCKET socks5=127.0.0.1:$TS_SOCKS_PORT"

if kill -0 "$TAILSCALED_PID" 2>/dev/null; then
    echo "[tailscale] tailscaled_running=true"
else
    echo "[tailscale] tailscaled_running=false"
fi

if command -v ps >/dev/null 2>&1; then
    ps -o pid=,stat=,etime=,comm= -p "$TAILSCALED_PID" 2>&1 || true
else
    echo "[tailscale] process_details=unavailable command=ps"
fi

TS_BIN="./.tailscale/tailscale"
TS_STATUS_OK=false
TS_TARGET_STATUS_PRESENT=false
TS_TARGET_PING_OK=false
TS_DIRECT_TCP_OK=false

if TS_IP_OUTPUT=$($TS_BIN --socket="$TS_SOCKET" ip -4 2>&1); then
    echo "[tailscale] ip_v4_status=ok value=$TS_IP_OUTPUT"
else
    echo "[tailscale] ip_v4_status=failed"
    echo "$TS_IP_OUTPUT"
fi

if TS_IP6_OUTPUT=$($TS_BIN --socket="$TS_SOCKET" ip -6 2>&1); then
    echo "[tailscale] ip_v6_status=ok value=$TS_IP6_OUTPUT"
else
    echo "[tailscale] ip_v6_status=failed_or_unavailable"
    echo "$TS_IP6_OUTPUT"
fi

if TS_STATUS_OUTPUT=$($TS_BIN --socket="$TS_SOCKET" status 2>&1); then
    TS_STATUS_OK=true
    echo "[tailscale] status_command=ok"
    echo "$TS_STATUS_OUTPUT"
else
    echo "[tailscale] status_command=failed"
    echo "$TS_STATUS_OUTPUT"
fi

if TS_STATUS_JSON=$($TS_BIN --socket="$TS_SOCKET" status --json 2>&1); then
    echo "[tailscale] status_json_command=ok"
    echo "$TS_STATUS_JSON"
else
    echo "[tailscale] status_json_command=failed_or_unavailable"
    echo "$TS_STATUS_JSON"
fi

if printf '%s\n' "$TS_STATUS_OUTPUT" | grep -Fq "$PG_TARGET_HOST"; then
    TS_TARGET_STATUS_PRESENT=true
    echo "[tailscale] target=$PG_TARGET_HOST status_entry_present=true"
else
    echo "[tailscale] target=$PG_TARGET_HOST status_entry_present=false"
fi

if printf '%s\n' "$TS_STATUS_OUTPUT" | grep -Eiq "$PG_TARGET_HOST.*(active|direct|relay|reachable|online)|((active|direct|relay|reachable|online).*${PG_TARGET_HOST})"; then
    echo "[tailscale] target=$PG_TARGET_HOST status_reachable_hint=true"
else
    echo "[tailscale] target=$PG_TARGET_HOST status_reachable_hint=false"
fi

if TS_NETCHECK_OUTPUT=$($TS_BIN --socket="$TS_SOCKET" netcheck 2>&1); then
    echo "[tailscale] netcheck_command=ok"
    echo "$TS_NETCHECK_OUTPUT"
else
    echo "[tailscale] netcheck_command=failed_or_unavailable"
    echo "$TS_NETCHECK_OUTPUT"
fi

if command -v ip >/dev/null 2>&1; then
    if IP_ROUTE_OUTPUT=$(ip route show 2>&1); then
        echo "[tailscale] kernel_routes_command=ok"
        echo "$IP_ROUTE_OUTPUT"
    else
        echo "[tailscale] kernel_routes_command=failed"
        echo "$IP_ROUTE_OUTPUT"
    fi
elif command -v route >/dev/null 2>&1; then
    if ROUTE_OUTPUT=$(route -n 2>&1); then
        echo "[tailscale] kernel_routes_command=ok_fallback"
        echo "$ROUTE_OUTPUT"
    else
        echo "[tailscale] kernel_routes_command=failed_fallback"
        echo "$ROUTE_OUTPUT"
    fi
else
    echo "[tailscale] kernel_routes_command=unavailable"
fi

if $TS_BIN --socket="$TS_SOCKET" ping --help >/dev/null 2>&1; then
    if TS_PING_OUTPUT=$($TS_BIN --socket="$TS_SOCKET" ping --timeout=5s "$PG_TARGET_HOST" 2>&1); then
        TS_TARGET_PING_OK=true
        echo "[tailscale] ping target=$PG_TARGET_HOST status=ok"
        echo "$TS_PING_OUTPUT"
    else
        echo "[tailscale] ping target=$PG_TARGET_HOST status=failed"
        echo "$TS_PING_OUTPUT"
    fi
else
    echo "[tailscale] ping target=$PG_TARGET_HOST status=unavailable_command"
fi

PYTHON_BIN=""
if command -v python3 >/dev/null 2>&1; then
    PYTHON_BIN="python3"
elif command -v python >/dev/null 2>&1; then
    PYTHON_BIN="python"
fi

if [ -n "$PYTHON_BIN" ]; then
    if TCP_OUTPUT=$($PYTHON_BIN - "$PG_TARGET_HOST" "$PG_TARGET_PORT" <<'PY'
import socket
import sys
import time

host = sys.argv[1]
port = int(sys.argv[2])
started = time.monotonic()
try:
    with socket.create_connection((host, port), timeout=5.0):
        elapsed_ms = (time.monotonic() - started) * 1000.0
        print(f"tcp_connect=success host={host} port={port} elapsed_ms={elapsed_ms:.1f}")
except Exception as exc:
    elapsed_ms = (time.monotonic() - started) * 1000.0
    print(f"tcp_connect=failed host={host} port={port} elapsed_ms={elapsed_ms:.1f} error={type(exc).__name__}:{exc}")
    raise SystemExit(1)
PY
    ); then
        TS_DIRECT_TCP_OK=true
        echo "[tailscale] direct_tcp_target=$PG_TARGET_HOST:$PG_TARGET_PORT status=ok"
        echo "$TCP_OUTPUT"
    else
        echo "[tailscale] direct_tcp_target=$PG_TARGET_HOST:$PG_TARGET_PORT status=failed"
        echo "$TCP_OUTPUT"
    fi
else
    echo "[tailscale] direct_tcp_target=$PG_TARGET_HOST:$PG_TARGET_PORT status=unavailable_python"
fi

if kill -0 "$TAILSCALED_PID" 2>/dev/null && [ "$TS_STATUS_OK" = true ]; then
    echo "[tailscale] control_plane_ready=true"
else
    echo "[tailscale] control_plane_ready=false"
fi
echo "[tailscale] target=$PG_TARGET_HOST status_entry_present=$TS_TARGET_STATUS_PRESENT tailscale_ping_ok=$TS_TARGET_PING_OK direct_tcp_ok=$TS_DIRECT_TCP_OK"

echo "[TAILSCALE DIAGNOSTIC END]"

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
