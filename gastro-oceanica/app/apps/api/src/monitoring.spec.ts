import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { MonitoringService } from './monitoring';
import { AccessGuard, AccessService } from './access/access';
import { corePrivileges, permissionForRoute } from './access/privileges';
import jwt from 'jsonwebtoken';

function response() {
  const emitter = new EventEmitter() as EventEmitter & { statusCode: number; locals: Record<string, unknown>; headers: Map<string, string>; setHeader(name: string, value: string): void };
  emitter.statusCode = 200;
  emitter.locals = {};
  emitter.headers = new Map();
  emitter.setHeader = (name, value) => emitter.headers.set(name, value);
  return emitter;
}

test('request metrics use server-generated IDs and safe route templates only', async () => {
  const service = new MonitoringService({ async query() { return []; } } as never);
  const req = { method: 'POST', url: '/cards/private-card-id?token=secret', route: { path: '/cards/:id' }, headers: { 'x-orbit-request-id': 'untrusted' } } as never;
  const res = response();
  let continued = false;
  const logged: string[] = [];
  const originalError = console.error;
  console.error = message => logged.push(String(message));
  let id: string | undefined;
  try {
    service.requestMiddleware(req, res as never, () => { continued = true; });
    id = res.headers.get('X-Orbit-Request-ID');
    assert.match(id || '', /^[0-9a-f-]{36}$/i);
    assert.notEqual(id, 'untrusted');
    assert.equal(res.locals.orbitRequestId, id);
    assert.equal(continued, true);
    res.statusCode = 500;
    res.emit('finish');

    const recovered = response();
    service.requestMiddleware({ method: 'POST', route: { path: '/cards/:id' } } as never, recovered as never, () => undefined);
    recovered.emit('finish');
  } finally {
    console.error = originalError;
  }

  const snapshot = await service.snapshot();
  assert.equal(snapshot.status, 'ok');
  assert.deepEqual(snapshot.dependencies, { database: 'ok' });
  assert.equal(snapshot.requestMetrics.routes.length, 1);
  assert.equal(snapshot.requestMetrics.routes[0].route, 'POST /cards/:id');
  assert.equal(snapshot.requestMetrics.routes[0].count, 2);
  assert.equal(snapshot.requestMetrics.routes[0].successes, 1);
  assert.equal(snapshot.requestMetrics.routes[0].errors, 1);
  assert.equal(JSON.parse(logged[0]).requestId, id);
  assert.equal(JSON.parse(logged[0]).route, '/cards/:id');
  assert.equal(JSON.stringify(logged).includes('private-card-id'), false);
  assert.equal(JSON.stringify(logged).includes('secret'), false);
  assert.equal(JSON.stringify(snapshot).includes('private-card-id'), false);
  assert.equal(JSON.stringify(snapshot).includes('secret'), false);
  assert.equal(JSON.stringify(snapshot).includes(id || ''), false);
});

test('monitoring reports dependency degradation without exposing database errors', async () => {
  const service = new MonitoringService({ async query() { throw new Error('password=private'); } } as never);
  const snapshot = await service.snapshot();
  assert.equal(snapshot.status, 'degraded');
  assert.deepEqual(snapshot.dependencies, { database: 'unavailable' });
  assert.equal(JSON.stringify(snapshot).includes('private'), false);
});

test('a missing operational metric source does not degrade unrelated monitoring groups', async () => {
  const db = {
    async query(sql: string) {
      if (sql === 'SELECT 1') return [];
      if (sql.includes('FROM card_ai_runs')) return [{ kind: 'prompt', status: 'success', count: 2, average_duration_ms: 100 }];
      if (sql.includes('FROM backup_cloud_copies')) throw new Error('optional backup provider schema unavailable');
      if (sql.includes('FROM access_audit')) return [{ blinded_accesses: 1, document_events: 2, document_generation_successes: 0, document_generation_failures: 0, mail_delivery_attempts: 3, mail_delivery_failures: 0 }];
      if (sql.includes('FROM monitoring_alert_profiles')) throw new Error('migration pending');
      throw new Error('unexpected query');
    },
  };
  const snapshot = await new MonitoringService(db as never).snapshot();
  assert.equal(snapshot.status, 'ok');
  assert.equal(snapshot.operationalMetrics.queues.status, 'available');
  assert.equal(snapshot.operationalMetrics.backups.status, 'unavailable');
  assert.equal(snapshot.operationalMetrics.blindedAccesses.status, 'available');
  assert.equal(snapshot.operationalMetrics.documentEvents.status, 'available');
  assert.equal(snapshot.operationalMetrics.outboundMail.status, 'available');
  assert.equal(snapshot.alertProfiles.status, 'unavailable');
});

test('monitoring snapshot aggregates queues, backups, blinded access, documents, and sends without identifiers', async () => {
  const db = {
    async query(sql: string) {
      if (sql === 'SELECT 1') return [];
      if (sql.includes('FROM card_ai_runs')) return [{ kind: 'prompt', status: 'error', count: 2, average_duration_ms: 425 }];
      if (sql.includes('FROM backup_cloud_copies')) return [{ kind: 'database', status: 'failed', count: 1 }];
      if (sql.includes('FROM access_audit')) return [{ blinded_accesses: 3, document_events: 4, document_generation_successes: 2, document_generation_failures: 1, mail_delivery_attempts: 5, mail_delivery_failures: 1 }];
      throw new Error('unexpected query');
    },
  };
  const service = new MonitoringService(db as never);
  const snapshot = await service.snapshot();
  assert.deepEqual(snapshot.operationalMetrics.queues.byKindAndStatus, [{ kind: 'prompt', status: 'error', count: 2, average_duration_ms: 425 }]);
  assert.deepEqual(snapshot.operationalMetrics.backups.byKindAndStatus, [{ kind: 'database', status: 'failed', count: 1 }]);
  assert.equal(snapshot.operationalMetrics.blindedAccesses.count, 3);
  assert.equal(snapshot.operationalMetrics.documentEvents.count, 4);
  assert.deepEqual(snapshot.operationalMetrics.documentGeneration, { status: 'available', successes: 2, failures: 1 });
  assert.deepEqual(snapshot.operationalMetrics.outboundMail, { status: 'available', attempts: 5, failures: 1 });
  const serialized = JSON.stringify(snapshot);
  for (const privateValue of ['dossier-private', 'user@example.test', 'refresh-token', 'process-uuid']) {
    assert.equal(serialized.includes(privateValue), false);
  }
});

test('monitoring alerts are computed only from the caller profile settings', async () => {
  const statements: Array<{ sql: string; params: unknown[] }> = [];
  const db = {
    async query(sql: string, params: unknown[] = []) {
      statements.push({ sql, params });
      if (sql === 'SELECT 1') return [];
      if (sql.includes('FROM card_ai_runs')) return [{ kind: 'prompt', status: 'failed', count: 1, average_duration_ms: 10 }];
      if (sql.includes('FROM backup_cloud_copies')) return [{ kind: 'database', status: 'failed', count: 1 }];
      if (sql.includes('FROM access_audit')) return [{ blinded_accesses: 0, document_events: 0, document_generation_successes: 0, document_generation_failures: 0, mail_delivery_attempts: 1, mail_delivery_failures: 1 }];
      if (sql.includes('FROM monitoring_alert_profiles')) return !Array.isArray(params[0]) || params[0].length === 0 ? [] : [{
        role_id: 'operator', minimum_requests: 1, failure_rate_percent: 1, route_latency_ms: 1,
        queue_failures: true, backup_failures: true, outbound_mail_failures: true,
      }];
      throw new Error('unexpected query');
    },
  };
  const service = new MonitoringService(db as never);
  const failed = response();
  const originalError = console.error;
  console.error = () => undefined;
  try {
    service.requestMiddleware({ method: 'GET', route: { path: '/monitoring' } } as never, failed as never, () => undefined);
    await new Promise(resolve => setTimeout(resolve, 5));
    failed.statusCode = 500;
    failed.emit('finish');
  } finally {
    console.error = originalError;
  }
  const own = await service.snapshot(['operator']);
  const unrelated = await service.snapshot([]);
  assert.deepEqual(own.alerts.map(alert => alert.code).sort(), ['backup.failure', 'http.error_rate', 'http.latency', 'mail.failure', 'queue.failure']);
  assert.equal(own.alerts.every(alert => alert.profile_id === 'operator'), true);
  assert.deepEqual(unrelated.alerts, []);
  const profileQuery = statements.find(statement => statement.sql.includes('FROM monitoring_alert_profiles'));
  assert.deepEqual(profileQuery?.params, [['operator']]);
});

test('monitoring alert profile save validates fields and upserts only safe threshold configuration', async () => {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const db = {
    async one(sql: string, params: unknown[] = []) {
      calls.push({ sql, params });
      if (sql.includes('FROM access_roles')) return { id: 'operator' };
      if (sql.includes('INSERT INTO monitoring_alert_profiles')) return { role_id: 'operator', enabled: true };
      return null;
    },
  };
  const service = new MonitoringService(db as never);
  const settings = { enabled: true, minimum_requests: 25, failure_rate_percent: 5, route_latency_ms: 1800, queue_failures: true, backup_failures: true, outbound_mail_failures: false };
  assert.deepEqual(await service.saveAlertProfile('actor-id', 'operator', settings), { role_id: 'operator', enabled: true });
  assert.equal(calls[1].sql.includes('ON CONFLICT(role_id) DO UPDATE'), true);
  assert.deepEqual(calls[1].params.slice(0, 2), ['operator', true]);
  await assert.rejects(() => service.saveAlertProfile('actor-id', 'operator', { ...settings, hidden: 'secret' }), /Configuração de alerta inválida/);
  await assert.rejects(() => service.saveAlertProfile('actor-id', 'operator', { ...settings, failure_rate_percent: 500 }), /Configuração de alerta inválida/);
});

test('monitoring metrics route is protected by the core RBAC privilege', () => {
  assert.equal(permissionForRoute('/monitoring', 'GET'), 'monitoring.read');
  assert.equal(permissionForRoute('/monitoring', 'PATCH'), 'monitoring.write');
  assert.equal(permissionForRoute('/monitoring/alert-profiles/operator', 'PUT'), 'monitoring.write');
});

test('monitoring endpoint enforces monitoring.read on the server', async () => {
  const previousSecret = process.env.JWT_SECRET;
  const secret = 'monitoring-test-secret-that-is-long-enough';
  process.env.JWT_SECRET = secret;
  const userId = '9e83466f-8c77-4e68-bff2-8ec2542a567c';
  let grants: string[] = ['boards.read'];
  const db = {
    async one(_sql: string, values: unknown[]) {
      return { id: values[0], name: 'Test', email: 'test@example.invalid', is_root: false, disabled: false, session_version: 1 };
    },
    async query(sql: string) {
      if (sql.includes('FROM access_grants')) return [{ role_id: 'test', name: 'Test', permissions: grants }];
      return [];
    },
  };
  try {
    const access = new AccessService(db as never);
    access.registerPermissions(corePrivileges.map(privilege => privilege.id));
    const guard = new AccessGuard(access, db as never);
    const request = {
      path: '/monitoring', method: 'GET', headers: { authorization: `Bearer ${jwt.sign({ sub: userId, version: 1 }, secret)}` },
    };
    const context = { switchToHttp: () => ({ getRequest: () => request }) } as never;
    await assert.rejects(() => guard.canActivate(context), /Acesso não autorizado/);
    grants = ['monitoring.read'];
    assert.equal(await guard.canActivate(context), true);
    request.path = '/monitoring/alert-profiles/operator';
    request.method = 'PUT';
    await assert.rejects(() => guard.canActivate(context), /Acesso não autorizado/);
    grants = ['monitoring.write'];
    assert.equal(await guard.canActivate(context), true);
  } finally {
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
});
