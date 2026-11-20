#!/bin/sh
set -eu
cd /home/meada/projetos/orbit
npm run db:migrate
exec npm run start -w apps/api
