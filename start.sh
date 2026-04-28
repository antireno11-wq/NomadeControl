#!/bin/sh
set -e

echo "Resolving any failed migrations..."
node node_modules/prisma/build/index.js migrate resolve --rolled-back 20260226152219_init || true
node node_modules/prisma/build/index.js migrate resolve --rolled-back 20260423215627_add_documento_tarea || true

echo "Running migrations..."
node node_modules/prisma/build/index.js migrate deploy

echo "Starting server..."
exec node server.js
