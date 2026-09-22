#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [ ! -d .venv ]; then
  echo "==> Creating virtualenv"
  python3 -m venv .venv
fi
source .venv/bin/activate
pip install -q --upgrade pip
pip install -q -r requirements.txt
if [ ! -f .env ]; then
  cp .env.example .env
  echo "==> Created .env - add your ANTHROPIC_API_KEY, then rerun."
fi
echo "==> http://127.0.0.1:8000"
exec uvicorn backend.main:app --reload --port 8000
