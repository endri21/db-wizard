#!/bin/sh
set -e

echo "[entrypoint] Initializing application database schema..."
node -e "require('dotenv').config(); require('./server/store').init().then(()=>{console.log('DB init completed.');}).catch((err)=>{console.error(err); process.exit(1);})"

if [ "${RUN_DB_SEED:-false}" = "true" ]; then
  echo "[entrypoint] Seeding database..."
  node server/seed.js
fi

echo "[entrypoint] Starting DB Wizard..."
exec "$@"
