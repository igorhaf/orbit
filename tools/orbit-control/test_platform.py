import importlib.util
import json
from pathlib import Path
import tempfile
import subprocess
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('platform_control', Path(__file__).with_name('release_control.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class PlatformTests(unittest.TestCase):
    def test_busy_delivery_blocks_release_except_the_durable_environment_update_step(self):
        with patch.object(m, 'db_command', return_value='1') as command:
            with self.assertRaisesRegex(ValueError, 'execuções'):
                m.assert_idle({})
            sql = command.call_args.args[1]
            self.assertIn('delivery_runs', sql)
            self.assertIn("coalesce(s.type,'')='environment.update'", sql)

    def test_database_commands_use_the_application_database_and_reject_catalog_mismatch(self):
        env = {'containers': ['api'], 'db': 'postgres', 'database': 'customer'}
        calls = []
        def run(*args, **_kwargs):
            calls.append(args)
            if args[1] == 'inspect':
                return json.dumps(['DATABASE_URL=postgresql://app:secret@postgres/customer'])
            return '0'
        with patch.object(m, 'run', side_effect=run):
            self.assertEqual(m.db_command(env, 'SELECT 0'), '0')
            self.assertEqual(calls[-1][-2:], ('customer', 'SELECT 0'))
            self.assertNotIn('$POSTGRES_DB', calls[-1][5])
            env['database'] = 'wrong_database'
            with self.assertRaisesRegex(ValueError, 'banco autorizado'):
                m.db_command(env, 'DELETE FROM anything')

    def test_compatibility_accepts_bounds_and_rejects_breaking_core(self):
        plugins = [{'id': 'client', 'coreCompatibility': {'minVersion': '1.0.0', 'maxExclusive': '2.0.0', 'pluginApiVersion': 1}}]
        self.assertEqual(m.compatibility({'version': '1.1.0', 'pluginApiVersion': 1}, plugins), [])
        self.assertTrue(m.compatibility({'version': '2.0.0', 'pluginApiVersion': 1}, plugins))
        self.assertTrue(m.compatibility({'version': '1.0.0', 'pluginApiVersion': 2}, plugins))

    def test_protected_client_cannot_start_any_operation(self):
        with patch.object(m, 'registry', return_value={'client': {'protected': True, 'reason': 'Goal ativo'}}):
            with self.assertRaisesRegex(ValueError, 'Goal ativo'):
                m.start({'target': 'client', 'operation': 'check'}, 'actor')

    def test_unknown_commands_and_fields_are_rejected(self):
        with self.assertRaises(ValueError):
            m.start({'target': 'prod', 'operation': 'shell', 'command': 'rm'}, 'actor')
        with self.assertRaises(ValueError):
            m.identifier('../../etc/passwd')

    def test_maintenance_gate_cannot_be_removed_by_another_job(self):
        with tempfile.TemporaryDirectory() as temp:
            env = {'config': temp}
            m.maintenance(env, {'id': 'first'}, True)
            with self.assertRaises(ValueError):
                m.maintenance(env, {'id': 'second'}, True)
            m.maintenance(env, {'id': 'second'}, False)
            self.assertTrue((Path(temp) / '.platform-maintenance.json').exists())
            m.maintenance(env, {'id': 'first'}, False)
            self.assertFalse((Path(temp) / '.platform-maintenance.json').exists())

    def test_image_overrides_preserve_published_tags(self):
        with tempfile.TemporaryDirectory() as temp, patch.object(m, 'STATE', Path(temp)):
            env = {'services': ['api', 'web'], 'images': ['published-api', 'published-web'], 'dockerfile': '/Dockerfile'}
            job = {'id': 'candidate'}
            path = m.override_for(env, job, Path('/candidate'))
            data = json.loads(path.read_text())
            self.assertNotEqual(data['services']['api']['image'], 'published-api')
            self.assertEqual(data['services']['api']['build']['context'], '/candidate')

    def test_lock_rejects_overlapping_publications(self):
        with tempfile.TemporaryDirectory() as temp, patch.object(m, 'STATE', Path(temp)):
            with m.lock_environment('prod'):
                with self.assertRaisesRegex(ValueError, 'Já existe'):
                    with m.lock_environment('prod'):
                        pass

    def test_dirty_source_and_destination_block_release_without_modifying_git(self):
        with tempfile.TemporaryDirectory() as temp, patch.object(m, 'STATE', Path(temp)):
            catalog = {'dev': {'path': '/dev', 'branch': 'develop'}, 'prod': {'path': '/prod', 'branch': 'main', 'upstream': 'dev'}}
            def checkout(env):
                return {'head': 'a' * 40, 'branch': env['branch'], 'dirty': True}
            with patch.object(m, 'registry', return_value=catalog), patch.object(m, 'checkout', side_effect=checkout), patch.object(m, 'git', side_effect=ValueError('legacy')), patch.object(m, 'runtime', return_value={'plugins': []}), patch.object(m, 'fingerprint', return_value='hash'):
                result = m.plan('prod', 'actor')
                self.assertFalse(result['ready'])
                self.assertTrue(any('origem' in b for b in result['blockers']))
                self.assertTrue(any('destino' in b for b in result['blockers']))

    def test_real_git_integration_preserves_customer_files_and_refuses_failed_validation(self):
        for mode in ('success', 'instance-success', 'test-failure', 'health-failure'):
            fail_tests = mode == 'test-failure'
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                source, target = root / 'source', root / 'target'
                def g(path, *args):
                    return subprocess.check_output(['git', '-C', str(path), *args], stderr=subprocess.DEVNULL).decode().strip()
                source.mkdir()
                g(source, 'init', '-q', '-b', 'develop')
                g(source, 'config', 'user.name', 'Test')
                g(source, 'config', 'user.email', 'test@orbit.local')
                (source / 'apps/api').mkdir(parents=True)
                core = {'version': '1.0.0', 'pluginApiVersion': 1, 'releaseFormat': 1}
                (source / 'apps/api/core-version.json').write_text(json.dumps(core))
                g(source, 'add', '.')
                g(source, 'commit', '-qm', 'base')
                subprocess.check_call(['git', 'clone', '-q', str(source), str(target)])
                g(target, 'checkout', '-qb', 'main')
                g(target, 'config', 'user.name', 'Test')
                g(target, 'config', 'user.email', 'test@orbit.local')
                (target / 'customer-plugin.txt').write_text('customer rules')
                g(target, 'add', '.')
                g(target, 'commit', '-qm', 'customer plugin')
                original_head = g(target, 'rev-parse', 'HEAD')
                (source / 'core-feature.txt').write_text('generic feature')
                g(source, 'add', '.')
                g(source, 'commit', '-qm', 'core feature')
                for directory in ('source-config', 'target-config'):
                    (root / directory).mkdir()
                    (root / directory / 'runtime-compatibility.json').write_text(json.dumps({'core': core, 'plugins': []}))
                catalog = {
                    'dev': {'path': str(source), 'branch': 'develop', 'config': str(root / 'source-config')},
                    'prod': {'path': str(target), 'branch': 'main', 'upstream': 'dev', 'config': str(root / 'target-config'),
                             'services': ['api', 'web'], 'containers': ['app-api', 'app-web'], 'images': ['stable-api', 'stable-web'],
                             'apiService': 'api', 'compose': str(root / 'compose.yml'), 'dockerfile': str(root / 'Dockerfile')}
                }
                if mode == 'instance-success':
                    catalog['prod']['buildLayout'] = 'instance'
                    catalog['prod']['buildFiles'] = ['docker-entrypoint.sh']
                    (root / 'docker-entrypoint.sh').write_text('#!/bin/sh\n')
                registry_file = root / 'registry.json'
                registry_file.write_text(json.dumps(catalog))
                actual_run = m.run
                sequence = []
                def run(*args, **kwargs):
                    if args[0] == 'git':
                        return actual_run(*args, **kwargs)
                    sequence.append(tuple(args))
                    return 'old-image-id'
                def command(job, args, **kwargs):
                    sequence.append(tuple(args))
                    if 'test:unit' in args:
                        self.assertIn('--workdir', args)
                        self.assertEqual(args[args.index('--workdir') + 1], '/home/meada/projetos/orbit')
                        self.assertEqual(args[args.index('--network') + 1], 'none')
                        self.assertLessEqual(len(args[args.index('--cpuset-cpus') + 1].split(',')), 2)
                        self.assertNotIn('--volume', args)
                    if fail_tests and 'test:unit' in args:
                        raise ValueError('unit test failed')
                def backup(env, job):
                    sequence.append(('verified-backup',))
                    job['backup'] = {'file': 'test.dump', 'sha256': 'verified'}
                with patch.object(m, 'STATE', root / 'state'), patch.object(m, 'REGISTRY', registry_file), patch.object(m, 'registry', return_value=catalog), patch.object(m, 'run', side_effect=run), patch.object(m, 'long_command', side_effect=command), patch.object(m, 'assert_idle'), patch.object(m, 'schema', side_effect=['before','after'] if mode=='health-failure' else None, return_value='unchanged'), patch.object(m, 'backup', side_effect=backup), patch.object(m, 'wait_healthy', side_effect=ValueError('health failed') if mode=='health-failure' else None):
                    plan = m.plan('prod', 'operator')
                    self.assertTrue(plan['ready'], plan['blockers'])
                    job = {'id': '12345678-1234-1234-1234-123456789012', 'target': 'prod', 'actor': 'operator', 'operation': 'update', 'planId': plan['id'], 'status': 'queued', 'createdAt': m.now(), 'events': []}
                    m.execute(job)
                    self.assertEqual((target / 'customer-plugin.txt').read_text(), 'customer rules')
                    self.assertEqual(g(target, 'branch', '--show-current'), 'main')
                    if mode == 'health-failure':
                        self.assertEqual(job['status'], 'recovery_required')
                        self.assertEqual(g(target, 'rev-parse', 'HEAD'), original_head)
                        self.assertTrue((root / 'target-config/.platform-maintenance.json').exists())
                        self.assertFalse((root / 'source-config/.platform-maintenance.json').exists())
                    elif fail_tests:
                        self.assertNotEqual(job['status'], 'success')
                        self.assertEqual(g(target, 'rev-parse', 'HEAD'), original_head)
                        self.assertFalse(any('stable-api' in entry and 'tag' in entry for entry in sequence))
                    else:
                        self.assertEqual(job['status'], 'success', job['events'])
                        self.assertEqual((target / 'core-feature.txt').read_text(), 'generic feature')
                        backup_index = sequence.index(('verified-backup',))
                        publication_index = next(i for i, entry in enumerate(sequence) if 'stable-api' in entry and 'tag' in entry)
                        self.assertLess(backup_index, publication_index)

    def test_recovery_never_stops_services_when_backup_checksum_is_invalid(self):
        with tempfile.TemporaryDirectory() as temp, patch.object(m, 'STATE', Path(temp)):
            id = '12345678-1234-1234-1234-123456789012'
            m.write_json(m.job_file(id), {'id': id, 'target': 'prod', 'status': 'recovery_required', 'backup': {'file': 'missing.dump', 'sha256': 'bad'}})
            with patch.object(m, 'registry', return_value={'prod': {}}), patch.object(m, 'long_command') as command:
                with self.assertRaisesRegex(ValueError, 'Backup ausente'):
                    m.recover(id, 'operator', 'prod')
                command.assert_not_called()

if __name__ == '__main__':
    unittest.main()
