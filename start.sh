#!/usr/bin/env bash
# One-command launcher (macOS/Linux). Double-click equivalent: ./start.sh
set -e
cd "$(dirname "$0")"

command -v node >/dev/null 2>&1 || {
  echo "Node.js not found - install it from https://nodejs.org/ and run again."
  exit 1
}

[ -d node_modules ] || {
  echo "Installing dependencies (one-time)..."
  npm install
}

exec npm start
