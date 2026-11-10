FROM node:24-bookworm-slim AS build
WORKDIR /home/meada/projetos/orbit
COPY app/package.json app/package-lock.json ./
COPY app/apps/api/package.json apps/api/package.json
COPY app/apps/web/package.json apps/web/package.json
RUN npm ci
COPY app/ .
ARG ORBIT_API_PROXY_URL=http://api:4000
ARG THEME=dark
ENV ORBIT_API_PROXY_URL=${ORBIT_API_PROXY_URL} THEME=${THEME} ORBIT_PRODUCT=suinda
RUN npm run build

FROM node:24-bookworm-slim AS api
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates libpq5 procps \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /home/meada/projetos/orbit/data/backups /data/config /data/backups
COPY --from=postgres:16-bookworm /usr/lib/postgresql/16/bin/ /usr/lib/postgresql/16/bin/
COPY --from=build /home/meada/projetos/orbit /home/meada/projetos/orbit
COPY docker-entrypoint.sh /usr/local/bin/suinda-entrypoint
ENV PATH=/usr/lib/postgresql/16/bin:${PATH} CODEX_HOME=/home/meada/.local/share/orbit-codex
WORKDIR /home/meada/projetos/orbit/apps/api
USER node
ENTRYPOINT ["sh", "/usr/local/bin/suinda-entrypoint"]

FROM node:24-bookworm-slim AS web
COPY --from=build /home/meada/projetos/orbit /home/meada/projetos/orbit
WORKDIR /home/meada/projetos/orbit
ENV ORBIT_API_PROXY_URL=http://api:4000 WEB_HOSTNAME=0.0.0.0 PORT=3000
USER node
CMD ["npm", "run", "start", "-w", "apps/web"]
