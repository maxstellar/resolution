#!/bin/sh
set -e

echo "Waiting for database..."
until pg_isready -d "$DATABASE_URL" -q; do
  sleep 2
done

echo "Database ready, running migrations..."
bunx drizzle-kit push

echo "Starting app..."
exec bun build/index.js
