#!/usr/bin/env python3
"""Environment operations are deliberately limited to explicit services."""
import hashlib
import os
from pathlib import Path
import subprocess
import sys
from datetime import datetime, timezone
from urllib.parse import unquote, urlparse
from uuid import uuid4

COMPOSE = '/home/meada/projetos/orbit/compose.yml'
SNAPSHOTS = Path('/control/snapshots')
SERVICES = {'dev': ('db-dev', 'dev'), 'prod': ('db-prod', 'api-prod', 'web-prod')}
RUNTIME = {'dev': ('dev',), 'prod': ('api-prod', 'web-prod')}
CONTAINERS = {'dev': ('orbit-db-dev', 'orbit-dev'), 'prod': ('orbit-db-prod', 'orbit-prod-api', 'orbit-prod-web')}


def run(*command, env=None):
    subprocess.run(command, check=True, env=env)


def compose(*args):
    run('docker', 'compose', '-f', COMPOSE, *args)


def database_env(name):
    url = os.environ.get(f'CONTROL_{name.upper()}_DATABASE_URL')
    if not url:
        raise ValueError(f'Configuração do banco {name} ausente.')
    parsed = urlparse(url)
    if parsed.scheme not in ('postgres', 'postgresql') or not parsed.hostname or not parsed.path:
        raise ValueError(f'Configuração do banco {name} inválida.')
    if (parsed.hostname, parsed.port or 5432, parsed.path.lstrip('/'), unquote(parsed.username or '')) != (f'db-{name}', 5432, 'orbit', 'orbit'):
        raise ValueError(f'Configuração do banco {name} aponta para um destino ou papel inesperado; operação recusada.')
    return {**os.environ, 'PGHOST': parsed.hostname, 'PGPORT': str(parsed.port or 5432),
            'PGUSER': unquote(parsed.username or ''), 'PGPASSWORD': unquote(parsed.password or ''),
            'PGDATABASE': parsed.path.lstrip('/')}


def require_environment(args):
    if len(args) < 2 or args[1] not in SERVICES:
        raise ValueError('Informe explicitamente dev ou prod.')
    return args[1]


def snapshot_prod():
    SNAPSHOTS.mkdir(mode=0o700, parents=True, exist_ok=True)
    name = f'prod-{datetime.now(timezone.utc):%Y%m%dT%H%M%SZ}-{uuid4().hex[:8]}.dump'
    target = SNAPSHOTS / name
    temporary = SNAPSHOTS / (name + '.tmp')
    os.umask(0o077)
    try:
        run('pg_dump', '-Fc', '--no-owner', '--no-acl', '-f', str(temporary), env=database_env('prod'))
        subprocess.run(('pg_restore', '-l', str(temporary)), check=True, stdout=subprocess.DEVNULL)
        digest = file_digest(temporary)
        temporary.replace(target)
        (SNAPSHOTS / (name + '.sha256')).write_text(digest + '\n')
    finally:
        temporary.unlink(missing_ok=True)
    print(f'Snapshot PROD: {target.name} ({target.stat().st_size} bytes, SHA-256 {digest})')
    return name


def validated_snapshot(name):
    if not name or Path(name).name != name or not name.startswith('prod-') or not name.endswith('.dump'):
        raise ValueError('Informe o nome de um snapshot PROD válido.')
    source = SNAPSHOTS / name
    digest_file = SNAPSHOTS / (name + '.sha256')
    if not source.is_file() or not digest_file.is_file():
        raise ValueError('Snapshot ou checksum ausente.')
    if file_digest(source) != digest_file.read_text().strip():
        raise ValueError('Checksum do snapshot inválido.')
    subprocess.run(('pg_restore', '-l', str(source)), check=True, stdout=subprocess.DEVNULL)
    return source


def ensure_dev_app_role():
    """Restore ownership after pg_restore, including after the DEV volume is recreated."""
    config = Path('/home/meada/projetos/orbit/dev/data/config/api.env')
    entry = next((line.partition('=')[2].strip().strip('"\'') for line in config.read_text().splitlines()
                  if line.startswith('DATABASE_URL=')), None)
    if not entry:
        raise ValueError('DATABASE_URL ativa de DEV ausente.')
    parsed = urlparse(entry)
    if (parsed.hostname, parsed.path.lstrip('/'), unquote(parsed.username or '')) != ('db-dev', 'orbit', 'orbit_dev_app') or not parsed.password:
        raise ValueError('DATABASE_URL ativa de DEV não corresponde ao banco e papel permitidos.')
    password = unquote(parsed.password).replace("'", "''")
    sql = f"""BEGIN;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='orbit_dev_app') THEN
  CREATE ROLE orbit_dev_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '{password}';
 ELSE
  ALTER ROLE orbit_dev_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '{password}';
 END IF;
END $$;
GRANT CONNECT, TEMPORARY ON DATABASE orbit TO orbit_dev_app;
GRANT USAGE, CREATE ON SCHEMA public TO orbit_dev_app;
DO $$ DECLARE item record; BEGIN
 FOR item IN SELECT tablename FROM pg_tables WHERE schemaname='public' LOOP
  EXECUTE format('ALTER TABLE public.%I OWNER TO orbit_dev_app', item.tablename);
 END LOOP;
 FOR item IN SELECT sequencename FROM pg_sequences WHERE schemaname='public' LOOP
  EXECUTE format('ALTER SEQUENCE public.%I OWNER TO orbit_dev_app', item.sequencename);
 END LOOP;
END $$;
COMMIT;
"""
    subprocess.run(('psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1'), input=sql, text=True,
                   env=database_env('dev'), check=True)


def start_restored_dev():
    compose('run', '--rm', '--no-deps', '--entrypoint', 'sh', 'dev', '-c', 'npm run db:migrate')
    compose('up', '-d', '--no-deps', 'dev')


def restore_dev(name):
    source = validated_snapshot(name)
    compose('stop', 'dev')
    print('DEV parado; restaurando somente db-dev.', flush=True)
    run('psql', '-X', '-v', 'ON_ERROR_STOP=1', '-c', 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;', env=database_env('dev'))
    run('pg_restore', '--exit-on-error', '--no-owner', '--no-acl', '-d', 'orbit', str(source), env=database_env('dev'))
    ensure_dev_app_role()
    start_restored_dev()
    print(f'DEV restaurado de {name}; PROD e CONTROL não foram parados.')


def reset_dev(name):
    source = validated_snapshot(name)
    compose('stop', 'dev', 'db-dev')
    compose('rm', '-f', 'dev', 'db-dev')
    run('docker', 'volume', 'rm', 'orbit_db_dev_data')
    compose('up', '-d', '--wait', 'db-dev')
    run('pg_restore', '--exit-on-error', '--no-owner', '--no-acl', '-d', 'orbit', str(source), env=database_env('dev'))
    ensure_dev_app_role()
    start_restored_dev()
    print(f'Volume e runtime DEV recriados de {name}; PROD e CONTROL não foram alterados.')


def file_digest(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def main(args):
    if not args:
        raise ValueError('Use status, health, logs, start, stop, restart, rebuild, migrate, snapshot, restore, reset-data, sync-data ou destroy.')
    action = args[0]
    if action == 'status' and len(args) == 1:
        compose('ps', '-a')
    elif action == 'health' and len(args) == 2:
        name = require_environment(args)
        for container in CONTAINERS[name]:
            run('docker', 'inspect', '--format', '{{.Name}} {{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}', container)
    elif action == 'logs' and len(args) == 2:
        name = require_environment(args)
        compose('logs', '--tail', '100', '-f', *SERVICES[name])
    elif action == 'start' and len(args) == 2:
        name = require_environment(args)
        compose('up', '-d', *SERVICES[name])
    elif action == 'stop' and len(args) == 2:
        name = require_environment(args)
        compose('stop', *reversed(SERVICES[name]))
    elif action == 'restart' and len(args) == 2:
        name = require_environment(args)
        compose('restart', *RUNTIME[name])
    elif action == 'rebuild' and len(args) == 2:
        name = require_environment(args)
        compose('build', *RUNTIME[name])
        compose('up', '-d', '--no-deps', '--force-recreate', *RUNTIME[name])
    elif action == 'migrate' and len(args) == 2:
        name = require_environment(args)
        service = 'dev' if name == 'dev' else 'api-prod'
        compose('exec', '-T', service, 'npm', 'run', 'db:migrate')
    elif action == 'snapshot' and args == ['snapshot', 'prod']:
        snapshot_prod()
    elif action == 'verify-snapshot' and len(args) == 3 and args[1] == 'prod':
        source = validated_snapshot(args[2])
        print(f'Snapshot PROD íntegro: {source.name}')
    elif action == 'restore' and len(args) == 3 and args[1] == 'dev':
        restore_dev(args[2])
    elif action == 'reset' and len(args) == 3 and args[1] == 'dev':
        reset_dev(args[2])
    elif action == 'reset-data' and len(args) == 3 and args[1] == 'dev':
        reset_dev(args[2])
    elif args == ['sync-data', 'dev', '--from', 'prod']:
        restore_dev(snapshot_prod())
    elif action == 'destroy' and args == ['destroy', 'dev']:
        compose('stop', 'dev')
        compose('rm', '-f', 'dev')
        print('Container DEV removido; banco e volume DEV preservados.')
    else:
        raise ValueError('Comando inválido ou ambiente não permitido.')


if __name__ == '__main__':
    try:
        main(sys.argv[1:])
    except (ValueError, subprocess.CalledProcessError) as error:
        print(f'[CONTROL] {error}', file=sys.stderr)
        sys.exit(1)
