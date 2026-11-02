#!/usr/bin/env python3
"""Durable, allowlisted release coordinator. Configuration lives outside client code."""
import contextlib
import fcntl
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import threading
import shutil
import tarfile
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from uuid import uuid4

ROOT = Path(os.environ.get('ORBIT_PLATFORM_ROOT', '/home/meada/projetos/orbit'))
STATE = Path(os.environ.get('ORBIT_PLATFORM_STATE', str(ROOT / 'control/state/platform')))
REGISTRY = ROOT / 'control/environments.json'
TERMINAL = {'success', 'failed', 'blocked', 'recovery_required', 'interrupted', 'recovered'}


def now():
    return datetime.now(timezone.utc).isoformat()


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2))
    temporary.chmod(0o600)
    temporary.replace(path)


def run(*args, cwd=None, timeout=120, input=None):
    identity = {}
    if args[0] == 'git' and os.geteuid() == 0:
        owner = Path(args[args.index('-C') + 1]).stat()
        identity = {'user': owner.st_uid, 'group': owner.st_gid}
    result = subprocess.run(args, cwd=cwd, input=input, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            start_new_session=True, timeout=timeout, check=False, **identity)
    if result.returncode:
        raise ValueError((result.stderr or result.stdout).decode(errors='replace')[-2000:])
    return result.stdout.decode(errors='replace').strip()


def git(path, *args):
    return run('git', '-c', 'safe.directory=' + str(path), '-C', str(path), *args)


def registry():
    data = json.loads(REGISTRY.read_text())
    for name, env in data.items():
        if not re.fullmatch(r'[a-z][a-z0-9-]*', name):
            raise ValueError('Identificador inválido no catálogo.')
        for key in ('path', 'compose', 'config'):
            if not Path(env[key]).resolve().is_relative_to(ROOT):
                raise ValueError('Caminho fora da raiz permitida no catálogo.')
    return data


def fingerprint(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def version(value):
    if not isinstance(value, str) or not re.fullmatch(r'\d+\.\d+\.\d+', value):
        raise ValueError('Versão precisa seguir major.minor.patch.')
    return tuple(map(int, value.split('.')))


def compatibility(core, plugins):
    issues = []
    current = version(core['version'])
    for plugin in plugins:
        rule = plugin.get('coreCompatibility')
        if not rule:
            continue
        if (current < version(rule['minVersion']) or
                (rule.get('maxExclusive') and current >= version(rule['maxExclusive'])) or
                (rule.get('pluginApiVersion') and rule['pluginApiVersion'] != core['pluginApiVersion'])):
            issues.append(f"Plugin {plugin['id']} exige outra versão do core/API de plugins.")
    return issues


def checkout(env):
    path = Path(env['path'])
    return {'head': git(path, 'rev-parse', 'HEAD'),
            'branch': git(path, 'branch', '--show-current'),
            'dirty': bool(git(path, 'status', '--porcelain', '--untracked-files=normal'))}


def runtime(env):
    path = Path(env['config']) / 'runtime-compatibility.json'
    try:
        return json.loads(path.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return {'core': None, 'plugins': [], 'pendingBootstrap': True}


def containers(env):
    values = []
    for name in env['containers']:
        try:
            info = json.loads(run('docker', 'inspect', name))[0]
            state = info['State']
            values.append({'name': name, 'state': state['Status'],
                           'health': state.get('Health', {}).get('Status', 'unknown'),
                           'imageId': info['Image']})
        except ValueError:
            values.append({'name': name, 'state': 'missing', 'health': 'unknown'})
    return values


def inventory():
    result = []
    for name, env in registry().items():
        item = {'id': name, 'name': env['name'], 'upstream': env.get('upstream'),
                'protected': bool(env.get('protected')), 'reason': env.get('reason'),
                'branch': env['branch'], 'port': env['port']}
        try:
            item.update(checkout(env))
            item['runtime'] = runtime(env)
            item['containers'] = containers(env)
            marker = STATE / 'installed' / (name + '.json')
            item['installed'] = json.loads(marker.read_text()) if marker.exists() else None
        except (OSError, ValueError) as error:
            item['error'] = str(error)[:1000]
        result.append(item)
    return result


def plan(target, actor):
    catalog = registry()
    if not isinstance(target, str) or target not in catalog or not catalog[target].get('upstream'):
        raise ValueError('Este ambiente não recebe atualizações de outro ambiente.')
    env = catalog[target]
    source = catalog[env['upstream']]
    origin, destination = checkout(source), checkout(env)
    blockers = []
    if env.get('protected'):
        blockers.append(env.get('reason', 'Ambiente protegido.'))
    if origin['branch'] != source['branch'] or destination['branch'] != env['branch']:
        blockers.append('Uma pasta está em uma branch diferente da configurada.')
    if origin['dirty']:
        blockers.append('A origem contém alterações não publicadas no Git. Registre uma versão antes de atualizar.')
    if destination['dirty']:
        blockers.append('O destino contém alterações locais. Preserve e registre essas alterações antes de atualizar.')
    try:
        core = json.loads(git(Path(source['path']), 'show', origin['head'] + ':apps/api/core-version.json'))
    except (ValueError, json.JSONDecodeError):
        core = None
        blockers.append('A versão de origem ainda não publica um manifesto de core. Publique a versão com a gestão de ambientes.')
    report = runtime(env)
    if report.get('pendingBootstrap'):
        blockers.append('O destino ainda precisa receber o contrato de compatibilidade inicial.')
    if core and core.get('releaseFormat') != 1:
        blockers.append('Atualize o CONTROL antes de publicar este formato de release.')
    if core:
        blockers.extend(compatibility(core, report.get('plugins', [])))
    value = {'id': str(uuid4()), 'target': target, 'source': env['upstream'], 'actor': actor,
             'createdAt': now(), 'sourceHead': origin['head'], 'targetHead': destination['head'],
             'registryHash': fingerprint(REGISTRY), 'core': core, 'blockers': blockers,
             'ready': not blockers, 'steps': ['Preservar alterações do cliente em uma integração isolada',
                 'Validar build e testes', 'Construir imagens', 'Salvar e verificar backup do banco do destino',
                 'Publicar e conferir saúde', 'Registrar versão e atualizar checkout']}
    write_json(STATE / 'plans' / (value['id'] + '.json'), value)
    return value


@contextlib.contextmanager
def lock_environment(target):
    path = STATE / 'locks' / (target + '.lock')
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('w') as stream:
        try:
            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ValueError('Já existe uma operação neste ambiente.')
        yield


def identifier(value):
    if not isinstance(value, str) or not re.fullmatch(r'[0-9a-f-]{36}', value):
        raise ValueError('Identificador inválido.')
    return value


def job_file(id):
    return STATE / 'jobs' / (identifier(id) + '.json')


def jobs(limit=100):
    values = sorted([json.loads(p.read_text()) for p in (STATE / 'jobs').glob('*.json')],
                  key=lambda j: j['createdAt'], reverse=True)
    return values if limit is None else values[:limit]


def save_job(job, status=None, message=None):
    if status:
        job['status'] = status
    job['updatedAt'] = now()
    if message:
        job.setdefault('events', []).append({'at': now(), 'message': message})
    write_json(job_file(job['id']), job)


def long_command(job, args, cwd=None, timeout=1800):
    log = STATE / 'logs' / (job['id'] + '.log')
    log.parent.mkdir(parents=True, exist_ok=True)
    with log.open('ab') as output:
        process = subprocess.Popen(args, cwd=cwd, stdout=output, stderr=output, start_new_session=True)
        try:
            code = process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGTERM)
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
            raise ValueError('A operação excedeu o tempo limite. Consulte o registro de execução.')
        if code:
            raise ValueError('Uma verificação ou comando falhou. Consulte o registro de execução.')


def compose(env, *args, override=None):
    command = ['docker', 'compose', '-f', env['compose']]
    if override:
        command += ['-f', str(override)]
    return command + list(args)


def application_database(env):
    from urllib.parse import urlparse, unquote
    entries = json.loads(run('docker', 'inspect', '-f', '{{json .Config.Env}}', env['containers'][0]))
    database_url = next((v.split('=', 1)[1] for v in entries if v.startswith('DATABASE_URL=')), '')
    url = urlparse(database_url)
    database, role = unquote(url.path.lstrip('/')), unquote(url.username or '')
    if url.scheme not in ('postgres', 'postgresql') or not re.fullmatch(r'[a-zA-Z_][a-zA-Z0-9_-]*', database) or not re.fullmatch(r'[a-zA-Z_][a-zA-Z0-9_]*', role):
        raise ValueError('Banco e papel da aplicação não puderam ser identificados.')
    if database != env.get('database'):
        raise ValueError('O banco ativo da aplicação difere do banco autorizado no catálogo.')
    return database, role


def db_command(env, sql):
    database, _role = application_database(env)
    return run('docker', 'exec', env['db'], 'sh', '-c',
               'exec psql -X -tA -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$1" -c "$2"',
               'platform-sql', database, sql)


def assert_idle(env):
    count = db_command(env, "SELECT (SELECT count(*) FROM card_ai_runs WHERE status IN ('queued','running','waiting_answer')) + (SELECT count(*) FROM card_runs WHERE status IN ('queued','running','waiting_approval')) + (SELECT count(*) FROM delivery_runs r LEFT JOIN delivery_steps s ON s.id=r.current_step_id WHERE r.status IN ('queued','running','waiting_approval') AND NOT (r.status='running' AND coalesce(s.type,'')='environment.update'))")
    if int(count or '0'):
        raise ValueError('Há execuções ou perguntas pendentes neste ambiente. Aguarde a fila antes de atualizar.')


def schema(env):
    history = db_command(env, "SELECT coalesce(string_agg(version||':'||checksum,',' ORDER BY version),'') FROM schema_migrations")
    database, _role = application_database(env)
    definition = run('docker', 'exec', env['db'], 'sh', '-c',
                     'exec pg_dump --schema-only -U "$POSTGRES_USER" -d "$1"', 'platform-schema', database, timeout=120)
    stable = '\n'.join(line for line in definition.splitlines()
                       if not line.startswith(('\\restrict ', '\\unrestrict ', '--')))
    return hashlib.sha256((history + '\n' + stable).encode()).hexdigest()


def backup(env, job):
    database, role = application_database(env)
    path = STATE / 'backups' / (job['id'] + '.dump')
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('wb') as stream:
        result = subprocess.run(['docker', 'exec', env['db'], 'sh', '-c',
            'exec pg_dump -Fc --no-owner --no-acl -U "$POSTGRES_USER" -d "$1"', 'platform-backup', database], stdout=stream, stderr=subprocess.PIPE, timeout=300)
    path.chmod(0o600)
    if result.returncode:
        raise ValueError('Não foi possível gerar o backup anterior à atualização.')
    with path.open('rb') as stream:
        subprocess.run(['docker', 'exec', '-i', env['db'], 'pg_restore', '-l'], stdin=stream, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, check=True, timeout=60)
    checksum = fingerprint(path)
    job['backup'] = {'file': path.name, 'sha256': checksum, 'role': role, 'database': database}
    save_job(job, message='Backup do banco do destino verificado.')


def wait_healthy(env, seconds=180):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        state = containers(env)
        if all(c['state'] == 'running' and c['health'] == 'healthy' for c in state):
            return
        time.sleep(3)
    raise ValueError('O ambiente não ficou saudável dentro do prazo de publicação.')


def restore_images(job, env):
    for image, previous in job.get('previousImages', {}).items():
        run('docker', 'tag', previous, image)
    long_command(job, compose(env, 'up', '-d', '--no-deps', '--force-recreate', *env['services']))
    wait_healthy(env)


def candidate_context(env, job, candidate):
    if env.get('buildLayout', 'application') == 'application':
        return candidate
    if env.get('buildLayout') != 'instance':
        raise ValueError('Layout de build não suportado no catálogo.')
    wrapper = STATE / 'candidates' / (job['id'] + '-context')
    wrapper.mkdir(parents=True, exist_ok=True)
    app = wrapper / 'app'
    app.mkdir(exist_ok=True)
    with subprocess.Popen(['git', '-c', 'safe.directory=' + str(candidate), '-C', str(candidate), 'archive', 'HEAD'], stdout=subprocess.PIPE) as process:
        with tarfile.open(fileobj=process.stdout, mode='r|') as archive:
            archive.extractall(app, filter='data')
        if process.wait(timeout=60):
            raise ValueError('Não foi possível preparar os arquivos versionados do cliente.')
    instance = Path(env['path']).parent
    for relative in env.get('buildFiles', []):
        source = (instance / relative).resolve()
        if not source.is_relative_to(instance.resolve()) or Path(relative).is_absolute():
            raise ValueError('Arquivo de build fora da instância.')
        if source.is_file():
            destination = wrapper / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, destination)
    return wrapper


def override_for(env, job, candidate=None):
    value = {}
    images = {}
    context = candidate_context(env, job, candidate) if candidate else None
    for index, service in enumerate(env['services']):
        image = 'orbit-platform-candidate:' + job['id'] + '-' + str(index)
        values = {'image': image}
        if candidate:
            values['build'] = {'context': str(context), 'dockerfile': env['dockerfile']}
        if env.get('mutableRuntime'):
            values['environment'] = {'ORBIT_NEXT_DIST_DIR': '.next-platform-validation'}
        value[service] = values
        images[env['images'][index]] = image
    path = STATE / 'candidates' / (job['id'] + '.compose.json')
    write_json(path, {'services': value})
    job['candidateImages'] = images
    return path


def maintenance(env, job, enable):
    path = Path(env['config']) / '.platform-maintenance.json'
    if enable:
        try:
            with path.open('x') as stream:
                json.dump({'jobId': job['id'], 'since': now()}, stream)
        except FileExistsError:
            raise ValueError('O ambiente já está em manutenção. Confira a operação anterior.')
    elif path.exists() and json.loads(path.read_text()).get('jobId') == job['id']:
        path.unlink()


def validate_candidate(job, env, override):
    workdir = env.get('runtimeRoot', '/home/meada/projetos/orbit')
    if env.get('mutableRuntime'):
        long_command(job, compose(env, 'run', '--rm', '--no-deps', '--workdir', workdir, '--entrypoint', 'npm', env['apiService'], 'run', 'build', override=override))
        long_command(job, compose(env, 'run', '--rm', '--no-deps', '--workdir', workdir, '--entrypoint', 'npm', env['apiService'], 'run', 'test:unit', override=override), timeout=900)
    else:
        image = job['candidateImages'][env['images'][env['services'].index(env['apiService'])]]
        # A disposable writable layer lets tests create fixtures without mounting customer data or credentials.
        cpus = ','.join(map(str, sorted(os.sched_getaffinity(0))[:2]))
        long_command(job, ['docker', 'run', '--rm', '--network', 'none', '--cpuset-cpus', cpus, '--user', '0:0', '--workdir', workdir,
                           '--entrypoint', 'npm', image, 'run', 'test:unit'], timeout=900)


def execute(job):
    env = registry()[job['target']]
    source = registry().get(env.get('upstream'))
    candidate = None
    gates = []
    try:
        with lock_environment(job['target']):
            if env.get('protected'):
                raise ValueError(env.get('reason', 'Ambiente protegido.'))
            assert_idle(env)
            if source:
                assert_idle(source)
            if job['operation'] == 'check':
                save_job(job, 'running', 'Validando build e testes no código atual, sem publicar.')
                # The application Dockerfile is the existing build gate, including API/web lint and TypeScript.
                override = override_for(env, job)
                long_command(job, compose(env, 'build', *env['services'], override=override))
                validate_candidate(job, env, override)
                save_job(job, 'success', 'Build e testes passaram; nenhuma instância foi reiniciada.')
                return
            saved = json.loads((STATE / 'plans' / (identifier(job['planId']) + '.json')).read_text())
            fresh = plan(job['target'], job['actor'])
            if not fresh['ready']:
                raise ValueError('; '.join(fresh['blockers']))
            if any(saved.get(key) != fresh.get(key) for key in ('sourceHead', 'targetHead', 'registryHash')):
                raise ValueError('Origem ou destino mudou desde a verificação. Prepare outra atualização.')
            save_job(job, 'running', 'Preparando integração isolada com a versão aprovada.')
            target = Path(env['path'])
            candidate = STATE / 'candidates' / job['id']
            candidate.parent.mkdir(parents=True, exist_ok=True)
            if os.geteuid() == 0:
                owner = target.stat()
                os.chown(candidate.parent, owner.st_uid, owner.st_gid)
            git(target, 'fetch', '--no-tags', source['path'], saved['sourceHead'])
            git(target, 'worktree', 'add', '--detach', str(candidate), saved['targetHead'])
            try:
                git(candidate, '-c', 'user.name=Orbit Release', '-c', 'user.email=release@orbit.local', 'merge', '--no-ff', '--no-edit', saved['sourceHead'])
            except ValueError:
                raise ValueError('Conflito de integração: o checkout original e o ambiente foram preservados. Resolva os conflitos antes de preparar outra atualização.')
            revision = git(candidate, 'rev-parse', 'HEAD')
            job['candidateHead'] = revision
            job['targetHead'] = saved['targetHead']
            override = override_for(env, job, candidate)
            save_job(job, message='Construindo a versão candidata e executando os testes.')
            long_command(job, compose(env, 'build', *env['services'], override=override))
            validate_candidate(job, env, override)
            if checkout(env)['dirty'] or git(target, 'rev-parse', 'HEAD') != saved['targetHead']:
                raise ValueError('O destino foi editado durante a preparação. A publicação foi interrompida.')
            for gated in [env] + ([source] if source else []):
                maintenance(gated, job, True)
                gates.append(gated)
                assert_idle(gated)
            before = schema(env)
            job['schemaBefore'] = before
            # Pin actual running image IDs before recreating containers.
            job['previousImages'] = {}
            for name, image in zip(env['containers'], env['images']):
                image_id = run('docker', 'inspect', '-f', '{{.Image}}', name)
                tag = 'orbit-platform-recovery:' + job['id'] + '-' + str(len(job['previousImages']))
                run('docker', 'tag', image_id, tag)
                job['previousImages'][image] = tag
            backup(env, job)
            save_job(job, message='Publicando a candidata; o banco e as configurações permanecem exclusivos do destino.')
            job['publicationStarted'] = True
            save_job(job)
            for published, built in job['candidateImages'].items():
                run('docker', 'tag', built, published)
            long_command(job, compose(env, 'up', '-d', '--no-deps', '--force-recreate', *env['services']))
            wait_healthy(env)
            git(target, 'merge', '--ff-only', revision)
            installed = {'target': job['target'], 'source': env['upstream'], 'sourceHead': saved['sourceHead'],
                         'head': revision, 'core': saved['core'], 'jobId': job['id'], 'installedAt': now()}
            write_json(STATE / 'installed' / (job['target'] + '.json'), installed)
            save_job(job, 'success', 'Versão publicada, checkout atualizado e saúde confirmada.')
    except Exception as error:
        if job.get('publicationStarted'):
            for container in env['containers']:
                try:
                    long_command(job, ['docker', 'logs', '--tail', '80', container], timeout=20)
                except Exception:
                    pass
            try:
                if schema(env) == job['schemaBefore']:
                    restore_images(job, env)
                    save_job(job, 'failed', 'Publicação reprovada; imagens anteriores restauradas. ' + str(error))
                else:
                    save_job(job, 'recovery_required', 'O schema mudou: recuperação exige revisão do backup; nenhum banco foi restaurado automaticamente. ' + str(error))
            except Exception as recovery:
                save_job(job, 'recovery_required', 'Recuperação precisa de atenção: ' + str(recovery))
        else:
            save_job(job, 'blocked' if isinstance(error, ValueError) else 'failed', str(error)[:2000])
    finally:
        for gated in gates:
            if job.get('status') != 'recovery_required' or gated is not env:
                maintenance(gated, job, False)
        if candidate and not job.get('publicationStarted'):
            try:
                git(Path(env['path']), 'worktree', 'remove', '--force', str(candidate))
            except ValueError:
                pass


def recover(id, actor, acknowledgement):
    job = json.loads(job_file(id).read_text())
    env = registry()[job['target']]
    if job['status'] != 'recovery_required' or acknowledgement != job['target'] or env.get('protected'):
        raise ValueError('Recuperação não autorizada para este ambiente.')
    path = STATE / 'backups' / job['backup']['file']
    if not path.is_file() or fingerprint(path) != job['backup']['sha256']:
        raise ValueError('Backup ausente ou com checksum inválido; nada foi alterado.')
    if checkout(env)['dirty'] or checkout(env)['head'] != job.get('targetHead'):
        raise ValueError('O checkout foi alterado; revise o código antes de restaurar o banco.')
    database, active_role = application_database(env)
    if database != job['backup'].get('database') or active_role != job['backup'].get('role'):
        raise ValueError('O banco ou o papel ativo mudou desde o backup. Revise antes de restaurar.')
    with lock_environment(job['target']):
        save_job(job, 'running', 'Recuperação com restauração de banco autorizada explicitamente por ' + actor)
        try:
            role = job['backup']['role']
            if not re.fullmatch(r'[a-zA-Z_][a-zA-Z0-9_]*', role):
                raise ValueError('Papel de restauração inválido.')
            long_command(job, compose(env, 'stop', *env['services']))
            db_command(env, 'DROP SCHEMA public CASCADE; CREATE SCHEMA public AUTHORIZATION "' + role + '";')
            with path.open('rb') as stream:
                result = subprocess.run(['docker', 'exec', '-i', env['db'], 'sh', '-c',
                    'exec pg_restore --exit-on-error --no-owner --no-acl --role="$1" -U "$POSTGRES_USER" -d "$2"',
                    'platform-restore', role, database], stdin=stream, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=300)
                if result.returncode:
                    raise ValueError('A restauração falhou. O ambiente permanece protegido para revisão.')
            restore_images(job, env)
            maintenance(env, job, False)
            save_job(job, 'recovered', 'Banco anterior e imagens anteriores restaurados; ambiente saudável.')
        except Exception as error:
            save_job(job, 'recovery_required', str(error))
    return job


start_lock = threading.Lock()


def start(body, actor):
    if set(body) - {'target', 'operation', 'planId'}:
        raise ValueError('Campos desconhecidos na operação.')
    catalog = registry()
    target = body.get('target')
    operation = body.get('operation')
    if not isinstance(target, str) or target not in catalog or operation not in ('check', 'update'):
        raise ValueError('Ambiente ou operação inválidos.')
    if catalog[target].get('protected'):
        raise ValueError(catalog[target].get('reason', 'Ambiente protegido.'))
    if operation == 'update':
        saved = json.loads((STATE / 'plans' / (identifier(body.get('planId')) + '.json')).read_text())
        if saved['target'] != target or saved['actor'] != actor or not saved['ready']:
            raise ValueError('Verifique a compatibilidade e resolva os bloqueios antes de atualizar.')
    with start_lock:
        if any(j['target'] == target and j['status'] not in TERMINAL for j in jobs(None)):
            raise ValueError('Já existe uma operação neste ambiente.')
        job = {'id': str(uuid4()), 'target': target, 'operation': operation, 'planId': body.get('planId'),
               'actor': actor, 'status': 'queued', 'createdAt': now(), 'events': []}
        save_job(job, message='Operação registrada no CONTROL.')
        threading.Thread(target=execute, args=(job,), daemon=True).start()
        return job


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass  # Never log request headers or the control token.

    def dispatch(self):
        if self.command == 'GET' and self.path == '/health':
            return self.reply(200, {'status': 'ok'})
        token = os.environ.get('ORBIT_PLATFORM_TOKEN', '')
        if not token or not hmac.compare_digest(self.headers.get('Authorization', ''), 'Bearer ' + token):
            return self.reply(401, {'message': 'Autenticação do CONTROL necessária.'})
        path = self.path.split('?')[0]
        try:
            if self.command == 'GET':
                if path == '/environments':
                    return self.reply(200, {'environments': inventory(), 'jobs': jobs()})
                if re.fullmatch('/jobs/[0-9a-f-]{36}', path):
                    return self.reply(200, json.loads(job_file(path.rsplit('/', 1)[1]).read_text()))
                if re.fullmatch('/jobs/[0-9a-f-]{36}/log', path):
                    file = STATE / 'logs' / (path.split('/')[2] + '.log')
                    return self.reply(200, {'log': file.read_text(errors='replace')[-64000:] if file.exists() else ''})
                raise ValueError('Recurso inexistente.')
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= 8192:
                raise ValueError('Tamanho de solicitação inválido.')
            body = json.loads(self.rfile.read(size))
            if not isinstance(body, dict):
                raise ValueError('O corpo precisa ser um objeto.')
            actor = self.headers.get('X-Orbit-Actor', '')
            if not re.fullmatch(r'[0-9a-f-]{36}', actor):
                raise ValueError('Ator da operação ausente.')
            if path == '/plans' and set(body) == {'target'}:
                return self.reply(200, plan(body['target'], actor))
            if path == '/jobs':
                return self.reply(202, start(body, actor))
            if re.fullmatch('/jobs/[0-9a-f-]{36}/recover', path) and set(body) == {'acknowledgement'}:
                return self.reply(200, recover(path.split('/')[2], actor, body['acknowledgement']))
            raise ValueError('Operação inexistente.')
        except (ValueError, OSError, subprocess.SubprocessError) as error:
            return self.reply(409, {'message': str(error)[:2000]})

    def reply(self, status, body):
        data = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(data)

    do_GET = dispatch
    do_POST = dispatch


def serve():
    STATE.mkdir(parents=True, exist_ok=True)
    STATE.chmod(0o750)
    if os.geteuid() == 0:
        owner = ROOT.stat()
        os.chown(STATE, owner.st_uid, owner.st_gid)
    for job in jobs(None):
        if job['status'] not in TERMINAL:
            save_job(job, 'recovery_required' if job.get('publicationStarted') else 'interrupted', 'O CONTROL foi reiniciado. Confira o estado do ambiente antes de tentar novamente.')
            for name, env in registry().items():
                if not job.get('publicationStarted') or name != job['target']:
                    maintenance(env, job, False)
    ThreadingHTTPServer(('0.0.0.0', 8787), Handler).serve_forever()


if __name__ == '__main__':
    serve()
