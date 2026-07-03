#!/bin/sh
set -e

cd /app/apps/python-ai

CURRENT=$(alembic current 2>/dev/null | awk '{print $1}' || true)

if [ -z "$CURRENT" ]; then
  echo "Applying database migrations..."
  alembic upgrade head || alembic stamp head
else
  alembic upgrade head
fi

exec "$@"
