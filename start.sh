#!/bin/sh
set -e

echo "Pushing schema to database..."
node node_modules/prisma/build/index.js db push --skip-generate --accept-data-loss

echo "Starting server..."
exec node server.js
