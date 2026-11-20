import assert from 'node:assert/strict';
import express from 'express';
import test from 'node:test';
import { HttpException } from '@nestjs/common';
import { PublicWorkspaceBrandingController, WorkspaceBrandingService } from './workspace-branding';

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
  return { service: new WorkspaceBrandingService(db as never, workspaces as never), statements };
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
    assert.equal(queryName, `_orbit-verification.${pending.custom_domain}`);
    return [['orbit-domain-verification=token-a']];
  });
  assert.equal(result.domain_verified, true);
  const update = statements.find(item => item.sql.includes('UPDATE workspace_branding SET domain_verified_at'));
  assert.match(update?.sql || '', /workspace_id=\$1 AND custom_domain=\$3 AND domain_verification_token=\$4 AND domain_verified_at IS NULL/);
  assert.deepEqual(update?.args, [workspaceA, actor, pending.custom_domain, pending.domain_verification_token]);
});

test('TXT verification rejects stale configuration after DNS lookup', async () => {
  const { service, statements } = makeService({ updateRow: null });
  await assert.rejects(service.verify(actor, workspaceA, async () => [['orbit-domain-verification=token-a']]),
    (error: unknown) => error instanceof HttpException && error.getStatus() === 409);
  assert.equal(statements.some(item => item.sql.startsWith('INSERT INTO access_audit')), false);
});

test('public branding uses the Express hostname selected by the trusted-proxy configuration', async () => {
  const seen: Array<string | undefined> = [];
  const controller = new PublicWorkspaceBrandingController({
    async publicForHost(host: string | undefined) { seen.push(host); return null; },
  } as never);
  await controller.current({ secure: true, hostname: 'verified.school.example.org', headers: { 'x-forwarded-host': 'attacker.example.net', host: 'internal-api:4000' } } as never);
  assert.deepEqual(seen, ['verified.school.example.org']);
});

test('public branding does not activate for a verified host over an insecure request', async () => {
  const seen: Array<string | undefined> = [];
  const controller = new PublicWorkspaceBrandingController({
    async publicForHost(host: string | undefined) { seen.push(host); return null; },
  } as never);
  const result = await controller.current({ secure: false, hostname: 'verified.school.example.org', headers: {} } as never);
  assert.equal(result, null);
  assert.deepEqual(seen, []);
});

test('domain branding requires HTTPS from a trusted proxy and ignores untrusted forwarded headers', async () => {
  const observedHosts: string[] = [];
  const controller = new PublicWorkspaceBrandingController({
    async publicForHost(host: string | undefined) { if (host) observedHosts.push(host); return host || null; },
  } as never);
  const trustedApp = express();
  trustedApp.set('trust proxy', ['127.0.0.1']);
  trustedApp.get('/host', async (request, response) => {
    const branding = await controller.current(request as never);
    if (branding === null) { response.status(404).end(); return; }
    response.json(branding);
  });
  const untrustedApp = express();
  untrustedApp.get('/host', async (request, response) => {
    const branding = await controller.current(request as never);
    if (branding === null) { response.status(404).end(); return; }
    response.json(branding);
  });
  const servers: Array<ReturnType<typeof trustedApp.listen>> = [];
  try {
    const trustedServer = trustedApp.listen(0, '127.0.0.1');
    const untrustedServer = untrustedApp.listen(0, '127.0.0.1');
    servers.push(trustedServer, untrustedServer);
    await Promise.all(servers.map(server => new Promise<void>((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    })));
    const trustedAddress = trustedServer.address();
    const untrustedAddress = untrustedServer.address();
    assert.ok(trustedAddress && typeof trustedAddress === 'object');
    assert.ok(untrustedAddress && typeof untrustedAddress === 'object');

    const untrustedProxyResponse = await fetch(`http://127.0.0.1:${untrustedAddress.port}/host`, {
      headers: { 'x-forwarded-host': 'attacker.example.net', 'x-forwarded-proto': 'https' },
    });
    assert.equal(untrustedProxyResponse.status, 404, 'untrusted forwarding metadata cannot activate branding');

    const insecureResponse = await fetch(`http://127.0.0.1:${trustedAddress.port}/host`, {
      headers: { 'x-forwarded-host': 'courses.example.org', 'x-forwarded-proto': 'http' },
    });
    assert.equal(insecureResponse.status, 404, 'a trusted proxy forwarding an HTTP request cannot activate branding');
    assert.deepEqual(observedHosts, []);

    const secureResponse = await fetch(`http://127.0.0.1:${trustedAddress.port}/host`, {
      headers: { 'x-forwarded-host': 'courses.example.org', 'x-forwarded-proto': 'https' },
    });
    assert.equal(secureResponse.status, 200);
    assert.equal(await secureResponse.json(), 'courses.example.org');
    assert.deepEqual(observedHosts, ['courses.example.org']);
  } finally {
    await Promise.all(servers.map(server => new Promise<void>((resolve, reject) =>
      server.close(error => error ? reject(error) : resolve()))));
  }
});

test('host branding is returned only through verified-domain and active-workspace filtering', async () => {
  const { service, statements } = makeService({ row: null });
  assert.equal(await service.publicForHost('courses.example.org:443'), null);
  const lookup = statements.find(item => item.sql.includes('FROM workspace_branding b JOIN workspaces'));
  assert.match(lookup?.sql || '', /b\.domain_verified_at IS NOT NULL AND w\.archived_at IS NULL/);
  assert.deepEqual(lookup?.args, ['courses.example.org']);
});
