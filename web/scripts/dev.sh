#!/bin/sh
set -e

if [ ! -d node_modules ] || \
   [ ! -f node_modules/jsqr/package.json ] || \
   [ ! -f node_modules/vitest/package.json ]; then
  npm ci
fi

exec npx next dev --hostname 0.0.0.0 --port 3001
