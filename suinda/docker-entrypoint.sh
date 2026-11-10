#!/bin/sh
set -eu
cd /home/meada/projetos/orbit
if [ "${ORBIT_ENV:-}" = production ]; then
  npm run db:migrate
  exec node apps/api/dist/main.js
fi
if [ ! -x node_modules/.bin/tsx ] || [ ! -x node_modules/.bin/eslint ] || [ ! -x node_modules/.bin/tsc ] || [ ! -x node_modules/.bin/next ]; then npm ci; fi
npm run db:migrate
if [ "${ORBIT_API_ONLY:-}" = true ]; then
  exec npm run dev -w apps/api
fi
exec npm run dev
