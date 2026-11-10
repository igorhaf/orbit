#!/bin/sh
set -eu
cd /home/meada/projetos/orbit
if [ ! -x node_modules/.bin/tsx ]; then npm ci; fi
npm run db:migrate
exec npm run dev
