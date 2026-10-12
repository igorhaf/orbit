#!/bin/sh
set -eu
cd /home/meada/projetos/orbit
if [ "${ORBIT_ENV:-}" = production ]; then
  npm run db:migrate
  exec node apps/api/dist/main.js
fi
if [ ! -x node_modules/.bin/tsx ]; then npm ci; fi
npm run db:migrate
exec npm run dev
