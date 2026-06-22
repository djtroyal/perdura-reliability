#!/bin/bash
# Start the Perdura Reliability Engineering and Statistics Suite
set -e
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# ---------------------------------------------------------------------------
# 1. Determine Python / venv
# ---------------------------------------------------------------------------
if [ -d "$REPO_DIR/.venv" ]; then
  PY="$REPO_DIR/.venv/bin/python"
  PIP="$REPO_DIR/.venv/bin/pip"
else
  PY="${PYTHON:-python3}"
  PIP="${PIP:-pip3}"
fi

# ---------------------------------------------------------------------------
# 2. Install the library in editable mode (if not already)
# ---------------------------------------------------------------------------
if ! "$PY" -c "import reliability" 2>/dev/null; then
  echo "Installing reliability library..."
  "$PIP" install -e "$REPO_DIR" -q
fi

# ---------------------------------------------------------------------------
# 3. Install backend dependencies (FastAPI / Uvicorn / Pydantic)
# ---------------------------------------------------------------------------
if ! "$PY" -c "import fastapi; import uvicorn" 2>/dev/null; then
  echo "Installing backend dependencies..."
  "$PIP" install -r "$REPO_DIR/gui/backend/requirements.txt" -q
fi

# ---------------------------------------------------------------------------
# 4. Install frontend dependencies
# ---------------------------------------------------------------------------
if [ ! -d "$REPO_DIR/gui/frontend/node_modules" ]; then
  echo "Installing frontend dependencies..."
  cd "$REPO_DIR/gui/frontend" && npm install
fi

# ---------------------------------------------------------------------------
# 5. Quick import check — fail fast with a clear message
# ---------------------------------------------------------------------------
echo "Checking backend imports..."
cd "$REPO_DIR/gui/backend"
if ! "$PY" -c "from main import app" 2>&1; then
  echo ""
  echo "ERROR: Backend failed to import. Check the error above."
  echo "  Try:  $PIP install -r $REPO_DIR/gui/backend/requirements.txt"
  echo "        $PIP install -e $REPO_DIR"
  exit 1
fi

# ---------------------------------------------------------------------------
# 6. Kill any leftover processes on our ports
# ---------------------------------------------------------------------------
for PORT in 8000 5173; do
  PIDS=$(lsof -ti :"$PORT" 2>/dev/null || true)
  if [ -n "$PIDS" ]; then
    echo "Killing leftover process(es) on port $PORT..."
    echo "$PIDS" | xargs kill -9 2>/dev/null || true
    sleep 0.5
  fi
done

# ---------------------------------------------------------------------------
# 7. Start servers
# ---------------------------------------------------------------------------
echo "Starting backend on port 8000..."
cd "$REPO_DIR/gui/backend"
"$PY" -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload &
BACKEND_PID=$!

echo "Starting frontend on port 5173..."
cd "$REPO_DIR/gui/frontend"
npm run dev &
FRONTEND_PID=$!

echo ""
echo "  Backend:  http://localhost:8000"
echo "  Frontend: http://localhost:5173"
echo ""
echo "Press Ctrl+C to stop both servers."

cleanup() {
  echo ""
  echo "Shutting down..."
  # Kill the uvicorn reloader and all its children
  kill $BACKEND_PID 2>/dev/null
  pkill -P $BACKEND_PID 2>/dev/null
  kill $FRONTEND_PID 2>/dev/null
  pkill -P $FRONTEND_PID 2>/dev/null
  # Final sweep — catch any orphaned uvicorn workers
  sleep 0.5
  for PORT in 8000 5173; do
    PIDS=$(lsof -ti :"$PORT" 2>/dev/null || true)
    [ -n "$PIDS" ] && echo "$PIDS" | xargs kill -9 2>/dev/null || true
  done
  exit 0
}

trap cleanup INT TERM
wait
