import assert from 'node:assert/strict';
import test from 'node:test';
import { HttpException } from '@nestjs/common';
import { WorkspaceBrandingService } from './workspace-branding';

const workspaceA = '22222222-2222-4222-8222-222222222222';
const workspaceB = '33333333-3333-4333-8333-333333333333';
const actor = '11111111-1111-4111-8111-111111111111';
const pending: { workspace_id: string; public_name: string; logo_url: string | null; primary_color: string; accent_color: string;
  custom_domain: string; domain_verification_token: string; domain_verified_at: Date | string | null } = {
  workspace_id: workspaceA, public_name: 'Escola A', logo_url: null, primary_color: '#123456', accent_color: '#abcdef',
  custom_domain: 'cursos.escola-a.example.org', domain_verification_token: 'token-a', domain_verified_at: null,
};

function makeService(options: { row?: typeof pending | null; updateRow?: typeof pending | null; denyWorkspace?: string } = {}) {
  const statements: Array<{ sql: string; args?: unknown[] }> = [];
  const db = {
    async one<T>(sql: string, args?: unknown[]): Promise<T | null> {
      statements.push({ sql, args });
      if (sql.includes('SELECT * FROM workspace_branding WHERE workspace_id=$1')) return (options.row ?? pending) as T;
      if (sql.includes('UPDATE workspace_branding SET domain_verified_at')) return (options.updateRow ?? null) as T;
      if (sql.includes('INSERT INTO workspace_branding')) return pending as T;
      if (sql.includes('FROM workspace_branding b JOIN workspaces')) return null;
      return null;
    },
    async query(sql: string, args?: unknown[]) { statements.push({ sql, args }); return []; },
  };
  const workspaces = {
    async shared(_user: string, workspace: string, manage: boolean) {
      assert.equal(manage, true);
      if (options.denyWorkspace === workspace) throw new HttpException('Compartilhamento não autorizado.', 403);
    },
  };
  const access = { registerRoutes() {} };
  return { service: new WorkspaceBrandingService(db as never, workspaces as never, access as never), statements };
}

test('branding validates public domains and logo URLs before writes', async () => {
  const { service, statements } = makeService();
  for (const domain of ['http://school.example.org', '127.0.0.1', 'localhost', 'school.local', 'bad..example.org']) {
    await assert.rejects(service.update(actor, workspaceA, { custom_domain: domain }),
      (error: unknown) => error instanceof HttpException && error.getStatus() === 400);
  }
  for (const logo of ['http://cdn.example.org/logo.png', 'https://127.0.0.1/logo.png', 'https://[::1]/logo.png',
    'https://metadata.internal/logo.png', 'https://host.local/logo.png', 'https://localhost/logo.png', 'javascript:alert(1)']) {
    await assert.rejects(service.update(actor, workspaceA, { logo_url: logo }),
      (error: unknown) => error instanceof HttpException && error.getStatus() === 400);
  }
  assert.equal(statements.some(item => item.sql.includes('INSERT INTO workspace_branding')), false);
});

test('brand colors meet WCAG AA contrast against white text and the dark surface', async () => {
  const { service } = makeService();
  await assert.rejects(service.update(actor, workspaceA, { primary_color: '#ffffff' }),
    (error: unknown) => error instanceof HttpException && error.getStatus() === 400 && /contraste mínimo de 4,5:1.*texto branco/.test(error.message));
  await assert.rejects(service.update(actor, workspaceA, { accent_color: '#222222' }),
    (error: unknown) => error instanceof HttpException && error.getStatus() === 400 && /contraste mínimo de 4,5:1.*superfície escura/.test(error.message));
  await service.update(actor, workspaceA, { primary_color: '#0c66e4', accent_color: '#38bdf8' });
});

test('branding management stays bound to the selected workspace and denies another workspace manager scope', async () => {
  const { service, statements } = makeService({ denyWorkspace: workspaceB });
  await assert.rejects(service.read(actor, workspaceB),
    (error: unknown) => error instanceof HttpException && error.getStatus() === 403);
  assert.equal(statements.length, 0);

  const allowed = makeService();
  await allowed.service.update(actor, workspaceA, { primary_color: '#0c66e4' });
  const save = allowed.statements.find(item => item.sql.includes('INSERT INTO workspace_branding'));
  assert.equal(save?.args?.[0], workspaceA);
});

test('TXT verification confirms only the same workspace, domain and token that were checked', async () => {
  const verified = { ...pending, domain_verified_at: new Date('2026-10-24T00:00:00Z') };
  const { service, statements } = makeService({ updateRow: verified });
  const result = await service.verify(actor, workspaceA, async queryName => {
    assert.equal(queryName, `_suinda-verification.${pending.custom_domain}`);
    return [['suinda-domain-verification=token-a']];
  });
  assert.equal(result.domain_verified, true);
  const update = statements.find(item => item.sql.includes('UPDATE workspace_branding SET domain_verified_at'));
  assert.match(update?.sql || '', /workspace_id=\$1 AND custom_domain=\$3 AND domain_verification_token=\$4 AND domain_verified_at IS NULL/);
  assert.deepEqual(update?.args, [workspaceA, actor, pending.custom_domain, pending.domain_verification_token]);
});

test('TXT verification rejects stale configuration after DNS lookup', async () => {
  const { service, statements } = makeService({ updateRow: null });
  await assert.rejects(service.verify(actor, workspaceA, async () => [['suinda-domain-verification=token-a']]),
    (error: unknown) => error instanceof HttpException && error.getStatus() === 409);
  assert.equal(statements.some(item => item.sql.startsWith('INSERT INTO access_audit')), false);
});

test('host branding is returned only through verified-domain and active-workspace filtering', async () => {
  const { service, statements } = makeService({ row: null });
  assert.equal(await service.publicForHost('courses.example.org:443'), null);
  const lookup = statements.find(item => item.sql.includes('FROM workspace_branding b JOIN workspaces'));
  assert.match(lookup?.sql || '', /b\.domain_verified_at IS NOT NULL AND w\.archived_at IS NULL/);
  assert.deepEqual(lookup?.args, ['courses.example.org']);
});
