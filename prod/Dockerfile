FROM node:24-bookworm-slim AS build
WORKDIR /home/meada/projetos/orbit
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci
COPY . .
ARG ORBIT_API_PROXY_URL=http://api-prod:4000
ENV ORBIT_API_PROXY_URL=${ORBIT_API_PROXY_URL}
RUN npm run build

FROM node:24-bookworm-slim AS api
RUN apt-get update && apt-get install -y --no-install-recommends bash ca-certificates git openssh-client libpq5 procps python-is-python3 python3 ripgrep sqlite3 \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g @openai/codex@0.162.1 bun@1.4.2 \
    && mkdir -p /home/meada/.codex /home/meada/projetos/orbit/.orbit/sessions /home/meada/projetos/orbit/apps/api/.orbit/sessions
COPY --from=postgres:16-bookworm /usr/lib/postgresql/16/bin/ /usr/lib/postgresql/16/bin/
# Official binary pinned by release and digest; installed persistently in the API image.
COPY --from=cloudflare/cloudflared:2026.10.0@sha256:9b49eed8f62806d5d45ddf59ecefb5710429598ea6d3fcccd2af938f621b2b07 /usr/local/bin/cloudflared /usr/local/bin/cloudflared
RUN cloudflared version
COPY --from=build /home/meada/projetos/orbit /home/meada/projetos/orbit
COPY .orbit-container-entrypoint.sh /usr/local/bin/orbit-entrypoint
ENV PATH=/usr/lib/postgresql/16/bin:${PATH} CODEX_HOME=/home/meada/.codex
WORKDIR /home/meada/projetos/orbit/apps/api
USER node
CMD ["sh", "/usr/local/bin/orbit-entrypoint"]

FROM node:24-bookworm-slim AS web
COPY --from=build /home/meada/projetos/orbit /home/meada/projetos/orbit
WORKDIR /home/meada/projetos/orbit
ENV ORBIT_API_PROXY_URL=http://api-prod:4000 WEB_HOSTNAME=0.0.0.0 PORT=3000
USER node
CMD ["npm", "run", "start", "-w", "apps/web"]
