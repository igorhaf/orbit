FROM postgres:16-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends locales \
    && sed -i 's/^# *pt_BR.UTF-8 UTF-8/pt_BR.UTF-8 UTF-8/' /etc/locale.gen \
    && locale-gen pt_BR.UTF-8 \
    && rm -rf /var/lib/apt/lists/*
