import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const simulation = {
  dev: `require('./apps/api/src/access/profile-simulation-context.ts').profileSimulationContext.run({actorId: root, profile: {id: 'administrator', name: 'Fixture', permissions: [permission]}}, fn)`,
  prod: `access.runRequest(async () => { await access.activateProfileSimulation(root, 'administrator'); await fn(); })`,
  safdoulas: `new Promise((resolve, reject) => access.runRequestContext(() => { access.setProfileSimulation(root, {actorId: root, roleId: 'administrator', name: 'Fixture', permissions: [permission]}); fn().then(resolve, reject); }))`,
  suinda: `access.runWithRequestContext({path: '/fixture', method: 'GET'}, async () => { access.setProfileSimulation(root, 'administrator', 'Fixture', [permission]); await fn(); })`,
};

for (const [runtime, runSimulation] of Object.entries(simulation)) {
  test(`${runtime}: editorial grants are explicit and simulation cannot authorize editorial access`, () => {
    const cwd = join(root, runtime, 'app');
    execFileSync(process.execPath, ['--import', join(cwd, 'node_modules/tsx/dist/loader.mjs'), '--eval', `
      const assert = require('node:assert/strict');
      const { AccessService } = require('./apps/api/src/access/access.ts');
      const root = '00000000-0000-4000-8000-000000000001';
      const permission = 'discovery_review.approve';
      let permissions = [], denied = false;
      const query = async sql => {
        if (sql.includes('FROM users')) return [{id: root, is_root: true, disabled: false, session_version: 0}];
        if (sql.includes('FROM access_roles') && !sql.includes('FROM access_grants')) return [{id: 'administrator', name: 'Fixture', permissions: [permission]}];
        if (sql.includes('FROM access_grants')) return [{permissions}];
        if (sql.includes('FROM access_user_exceptions') && denied) return [{permission_id: permission, effect: 'deny'}];
        return [];
      };
      const access = new AccessService({query, one: async sql => (await query(sql))[0] ?? null});
      const transaction = {query: async sql => ({rows: await query(sql)})};
      (async () => {
        assert.deepEqual(await access.effective(root), ['*']);
        assert.equal(await access.has(root, permission), false);
        assert.deepEqual(await access.editorialPermissions(transaction, root), []);
        permissions = [permission];
        assert.equal(await access.has(root, permission), true);
        assert.deepEqual(await access.editorialPermissions(transaction, root), [permission]);
        denied = true;
        assert.equal(await access.has(root, permission), false);
        assert.deepEqual(await access.editorialPermissions(transaction, root), []);
        denied = false;
        const fn = async () => {
          assert.equal(await access.has(root, permission), false);
          await assert.rejects(access.editorialPermissions(transaction, root), error => error.getStatus() === 403);
        };
        await (${runSimulation});
        assert.deepEqual(await access.effective(root), ['*']);
      })().catch(error => { console.error(error); process.exitCode = 1; });
    `], { cwd, env: { ...process.env, TSX_TSCONFIG_PATH: join(cwd, 'apps/api/tsconfig.json'), TSX_DISABLE_CACHE: '1' }, timeout: 15000, stdio: 'pipe' });
  });
}
