import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Db } from '../db';
import { FeaturesService } from '../features';
import { SecretVault } from '../secrets';
import { GitPlugin } from './git.plugin';

const run = promisify(execFile);

test('Git repository path reports a missing folder and accepts the project root', async () => {
  const root = await mkdtemp(join(tmpdir(), 'orbit-git-path-'));
  const projectId = randomUUID();
  const userId = randomUUID();
  const statements: string[] = [];
  let registered = false;
  const db = {
    one: async (sql: string) => {
      statements.push(sql);
      if(sql.includes('FROM ai_projects'))return { id: projectId, local_path: root };
      if(sql.includes('FROM git_repositories'))return registered ? { id: randomUUID() } : null;
      registered = true;
      return { id: randomUUID(), relative_path: '.' };
    },
    query: async (sql: string) => { statements.push(sql); return []; },
  } as unknown as Db;
  const plugin = new GitPlugin(db, {} as FeaturesService, {} as SecretVault);
  try {
    await run('git', ['init', '-b', 'develop', root]);
    await assert.rejects(
      () => plugin.addRepository(projectId, userId, { name: 'Orbit', relative_path: './dev', branches: ['develop'] }),
      error => error instanceof Error && /pasta do repositório não existe/.test(error.message) && 'status' in error && error.status === 400,
    );
    assert.equal(statements.length, 2, 'A pasta inválida não deve gerar INSERT.');
    const repo = await plugin.addRepository(projectId, userId, { name: 'Orbit', relative_path: '.', branches: ['develop'] });
    assert.ok(repo);
    assert.equal(statements.filter(sql => sql.startsWith('INSERT INTO git_repositories')).length, 1);
    await assert.rejects(
      () => plugin.addRepository(projectId, userId, { name: 'Orbit', relative_path: './', branches: ['develop'] }),
      error => error instanceof Error && /já está cadastrada/.test(error.message) && 'status' in error && error.status === 409,
    );
    assert.equal(statements.filter(sql => sql.startsWith('INSERT INTO git_repositories')).length, 1, 'A pasta duplicada não deve gerar INSERT.');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
