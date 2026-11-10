FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends bash ca-certificates docker.io git openssh-client libpq5 postgresql-client procps python-is-python3 python3 ripgrep sqlite3 \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g @openai/codex@0.162.1 bun@1.4.2 \
    && mkdir -p /home/meada/.codex /home/meada/.local/share/orbit-codex /home/meada/projetos/orbit
RUN chown -R node:node /home/meada/.codex /home/meada/.local/share/orbit-codex
COPY --from=postgres:16-bookworm /usr/lib/postgresql/16/bin/ /usr/lib/postgresql/16/bin/
# Official cloudflared binary pinned to a verified release digest; persists across recreations.
COPY --from=cloudflare/cloudflared:2026.10.0@sha256:9b49eed8f62806d5d45ddf59ecefb5710429598ea6d3fcccd2af938f621b2b07 /usr/local/bin/cloudflared /usr/local/bin/cloudflared
RUN cloudflared version
COPY .orbit-container-entrypoint.sh /usr/local/bin/orbit-entrypoint
ENV PATH=/usr/lib/postgresql/16/bin:${PATH}
WORKDIR /home/meada/projetos/orbit
USER node
CMD ["sh", "/usr/local/bin/orbit-entrypoint"]
