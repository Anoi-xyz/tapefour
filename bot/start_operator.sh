#!/usr/bin/env bash
# bot/start_operator.sh
# Production daemon runner for TapeFour Bot Operator service.
# Restarts automatically on crash or RPC timeout.

set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
ROOT_DIR="$(dirname "$DIR")"

echo "=== TapeFour Bot Operator Startup ==="
echo "Working directory: $ROOT_DIR"

if [ -f "$ROOT_DIR/.env" ]; then
  echo "Loading environment variables from .env..."
  export $(grep -v '^#' "$ROOT_DIR/.env" | xargs)
fi

if [ -z "$BOT_OPERATOR_KEY" ]; then
  echo "ERROR: BOT_OPERATOR_KEY is not set in environment or .env"
  exit 1
fi

if [ -z "$TAPEFOUR_ADDRESS" ]; then
  echo "ERROR: TAPEFOUR_ADDRESS is not set in environment or .env"
  exit 1
fi

export BOT_DIFFICULTY="${BOT_DIFFICULTY:-medium}"
export XLAYER_RPC_URL="${XLAYER_RPC_URL:-https://rpc.xlayer.tech}"

echo "Bot Difficulty : $BOT_DIFFICULTY"
echo "Target Contract: $TAPEFOUR_ADDRESS"
echo "RPC Endpoint   : $XLAYER_RPC_URL"
echo "Starting operator loop with automatic restart..."

while true; do
  echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Starting operator service..."
  npx tsx "$DIR/operator.ts" || {
    EXIT_CODE=$?
    echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Operator process exited with code $EXIT_CODE. Restarting in 5s..."
    sleep 5
  }
done
