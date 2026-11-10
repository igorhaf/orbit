import { randomUUID } from 'node:crypto';
import { Body, Controller, Get, HttpException, Inject, Injectable, Param, Put, Req } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { Db } from './db';
import type { AccessRequest } from './access/access';
import { AccessService } from './access/access';

type Aggregate = { count: number; errors: number; totalLatencyMs: number; maxLatencyMs: number };
type MetricRow = Record<string, unknown>;
type AlertProfile = {
  role_id: string;
  role_name: string;
  enabled: boolean;
  minimum_requests: number;
  failure_rate_percent: number;
  route_latency_ms: number;
  queue_failures: boolean;
  backup_failures: boolean;
  outbound_mail_failures: boolean;
};

@Injectable()
export class MonitoringService {
  private readonly startedAt = new Date().toISOString();
  private readonly requests = new Map<string, Aggregate>();
  private readonly maxSeries = 250;

  constructor(@Inject(Db) private readonly db: Db) {}

  private alertProfile(input: Record<string, unknown>) {
    const allowed = ['enabled', 'minimum_requests', 'failure_rate_percent', 'route_latency_ms', 'queue_failures', 'backup_failures', 'outbound_mail_failures'];
    if (!input || Object.keys(input).some(key => !allowed.includes(key))) throw new HttpException('Configuração de alerta inválida.', 400);
    const enabled = input.enabled;
    const minimumRequests = input.minimum_requests;
    const failureRate = input.failure_rate_percent;
    const routeLatency = input.route_latency_ms;
    const queueFailures = input.queue_failures;
    const backupFailures = input.backup_failures;
    const mailFailures = input.outbound_mail_failures;
    if (typeof enabled !== 'boolean' || !Number.isInteger(minimumRequests) || Number(minimumRequests) < 1 || Number(minimumRequests) > 100_000
      || typeof failureRate !== 'number' || !Number.isFinite(failureRate) || failureRate < 0 || failureRate > 100
      || !Number.isInteger(routeLatency) || Number(routeLatency) < 1 || Number(routeLatency) > 600_000
      || typeof queueFailures !== 'boolean' || typeof backupFailures !== 'boolean' || typeof mailFailures !== 'boolean') {
      throw new HttpException('Configuração de alerta inválida.', 400);
    }
    return { enabled, minimumRequests, failureRate, routeLatency, queueFailures, backupFailures, mailFailures };
  }

  async listAlertProfiles() {
    return this.db.query<AlertProfile>(`SELECT r.id AS role_id,r.name AS role_name,
      COALESCE(p.enabled,false) AS enabled,COALESCE(p.minimum_requests,20) AS minimum_requests,
      COALESCE(p.failure_rate_percent,5)::float AS failure_rate_percent,COALESCE(p.route_latency_ms,2000) AS route_latency_ms,
      COALESCE(p.queue_failures,true) AS queue_failures,COALESCE(p.backup_failures,true) AS backup_failures,
      COALESCE(p.outbound_mail_failures,false) AS outbound_mail_failures
      FROM access_roles r LEFT JOIN monitoring_alert_profiles p ON p.role_id=r.id ORDER BY r.name,r.id`);
  }

  async saveAlertProfile(actor: string, roleId: string, input: Record<string, unknown>) {
    if (!/^[a-z][a-z0-9_]{0,79}$/.test(roleId)) throw new HttpException('Perfil inválido.', 400);
    const profile = this.alertProfile(input);
    if (!await this.db.one('SELECT id FROM access_roles WHERE id=$1', [roleId])) throw new HttpException('Perfil de acesso não encontrado.', 404);
    const result = await this.db.one(`INSERT INTO monitoring_alert_profiles
      (role_id,enabled,minimum_requests,failure_rate_percent,route_latency_ms,queue_failures,backup_failures,outbound_mail_failures,updated_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT(role_id) DO UPDATE SET enabled=EXCLUDED.enabled,minimum_requests=EXCLUDED.minimum_requests,
        failure_rate_percent=EXCLUDED.failure_rate_percent,route_latency_ms=EXCLUDED.route_latency_ms,
        queue_failures=EXCLUDED.queue_failures,backup_failures=EXCLUDED.backup_failures,
        outbound_mail_failures=EXCLUDED.outbound_mail_failures,updated_by=EXCLUDED.updated_by,updated_at=now()
      RETURNING role_id,enabled,minimum_requests,failure_rate_percent,route_latency_ms,queue_failures,backup_failures,outbound_mail_failures`,
    [roleId,profile.enabled,profile.minimumRequests,profile.failureRate,profile.routeLatency,profile.queueFailures,profile.backupFailures,profile.mailFailures,actor]);
    if (!result) throw new HttpException('Perfil de acesso não encontrado.', 404);
    return result;
  }

  readonly requestMiddleware = (req: Request, res: Response, next: NextFunction) => {
    const requestId = randomUUID();
    const started = process.hrtime.bigint();
    res.setHeader('X-Orbit-Request-ID', requestId);
    res.locals.orbitRequestId = requestId;
    res.once('finish', () => {
      const route = typeof req.route?.path === 'string' && req.route.path.startsWith('/') ? req.route.path : 'unmatched';
      const key = `${String(req.method || 'UNKNOWN').slice(0, 12)} ${String(route).slice(0, 180)}`;
      const bucket = this.requests.has(key) || this.requests.size < this.maxSeries ? key : 'OTHER';
      const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
      const aggregate = this.requests.get(bucket) || { count: 0, errors: 0, totalLatencyMs: 0, maxLatencyMs: 0 };
      aggregate.count++;
      if (res.statusCode >= 500) aggregate.errors++;
      aggregate.totalLatencyMs += durationMs;
      aggregate.maxLatencyMs = Math.max(aggregate.maxLatencyMs, durationMs);
      this.requests.set(bucket, aggregate);
      if (res.statusCode >= 500) {
        console.error(JSON.stringify({ event: 'http_request_failed', requestId, method: req.method, route, status: res.statusCode, durationMs: Math.round(durationMs) }));
      }
    });
    next();
  };

  async snapshot(profileIds?: string[]) {
    let database: 'ok' | 'unavailable' = 'ok';
    try { await this.db.query('SELECT 1'); } catch { database = 'unavailable'; }
    const requests = [...this.requests.entries()].map(([route, value]) => ({
      route,
      count: value.count,
      successes: value.count - value.errors,
      errors: value.errors,
      averageLatencyMs: Number((value.totalLatencyMs / value.count).toFixed(2)),
      maxLatencyMs: Number(value.maxLatencyMs.toFixed(2)),
    })).sort((a, b) => a.route.localeCompare(b.route));
    const safeAggregate = async (sql: string, params: unknown[] = []): Promise<{ status: 'available' | 'unavailable'; rows: MetricRow[] }> => {
      try { return { status: 'available', rows: await this.db.query<MetricRow>(sql, params) }; }
      catch { return { status: 'unavailable', rows: [] }; }
    };
    const [queues, backups, privacyAndDocuments, configuredAlerts] = database === 'ok' ? await Promise.all([
      safeAggregate(`SELECT kind,status,count(*)::int AS count,
        COALESCE(round(avg(EXTRACT(epoch FROM (finished_at-started_at))*1000) FILTER(WHERE started_at IS NOT NULL AND finished_at IS NOT NULL))::int,0) AS average_duration_ms
        FROM (
          SELECT 'prompt'::text AS kind,status,started_at,finished_at FROM card_ai_runs WHERE created_at>=now()-interval '30 days'
          UNION ALL SELECT 'comment',status,started_at,finished_at FROM card_ai_comment_jobs WHERE created_at>=now()-interval '30 days'
          UNION ALL SELECT 'execution',status,started_at,finished_at FROM card_runs WHERE created_at>=now()-interval '30 days'
          UNION ALL SELECT 'delivery',status,started_at,finished_at FROM delivery_runs WHERE created_at>=now()-interval '30 days'
        ) runs GROUP BY kind,status ORDER BY kind,status`),
      safeAggregate(`SELECT kind,status,count(*)::int AS count FROM (
          SELECT 'database'::text AS kind,status FROM backup_cloud_copies WHERE created_at>=now()-interval '30 days'
          UNION ALL SELECT 'configuration',status FROM config_backup_cloud_copies WHERE created_at>=now()-interval '30 days'
          UNION ALL SELECT 'vault',status FROM vault_backup_cloud_copies WHERE created_at>=now()-interval '30 days'
          UNION ALL SELECT 'attachments',status FROM attachment_backup_cloud_copies WHERE created_at>=now()-interval '30 days'
        ) copies GROUP BY kind,status ORDER BY kind,status`),
      safeAggregate(`SELECT
          count(*) FILTER(WHERE action='documents.file.read.anonymized')::int AS blinded_accesses,
          count(*) FILTER(WHERE action LIKE 'documents.%')::int AS document_events,
          count(*) FILTER(WHERE action='documents.generation.succeeded')::int AS document_generation_successes,
          count(*) FILTER(WHERE action='documents.generation.failed')::int AS document_generation_failures,
          count(*) FILTER(WHERE action IN ('mail.delivery.succeeded','mail.delivery.failed'))::int AS mail_delivery_attempts,
          count(*) FILTER(WHERE action='mail.delivery.failed')::int AS mail_delivery_failures
        FROM access_audit WHERE created_at>=now()-interval '30 days'`),
      safeAggregate(`SELECT role_id,enabled,minimum_requests,failure_rate_percent::float AS failure_rate_percent,route_latency_ms,
          queue_failures,backup_failures,outbound_mail_failures
        FROM monitoring_alert_profiles WHERE enabled AND ($1::text[] IS NULL OR role_id=ANY($1::text[]))`, profileIds === undefined ? [null] : [profileIds]),
    ]) : [{ status: 'unavailable' as const, rows: [] }, { status: 'unavailable' as const, rows: [] }, { status: 'unavailable' as const, rows: [] }, { status: 'unavailable' as const, rows: [] }];
    const eventTotals = privacyAndDocuments.rows[0] || {};
    const alerts: Array<{ profile_id: string; code: string; severity: 'warning' | 'critical'; route?: string }> = [];
    for (const profile of configuredAlerts.rows) {
      for (const route of requests) {
        const rate = route.count ? route.errors * 100 / route.count : 0;
        if (route.count >= Number(profile.minimum_requests) && rate >= Number(profile.failure_rate_percent)) alerts.push({ profile_id: String(profile.role_id), code: 'http.error_rate', severity: rate >= 20 ? 'critical' : 'warning', route: route.route });
        if (route.maxLatencyMs >= Number(profile.route_latency_ms)) alerts.push({ profile_id: String(profile.role_id), code: 'http.latency', severity: 'warning', route: route.route });
      }
      if (profile.queue_failures && queues.rows.some(row => ['error','failed'].includes(String(row.status)) && Number(row.count) > 0)) alerts.push({ profile_id: String(profile.role_id), code: 'queue.failure', severity: 'warning' });
      if (profile.backup_failures && backups.rows.some(row => row.status === 'failed' && Number(row.count) > 0)) alerts.push({ profile_id: String(profile.role_id), code: 'backup.failure', severity: 'critical' });
      if (profile.outbound_mail_failures && Number(eventTotals.mail_delivery_failures || 0) > 0) alerts.push({ profile_id: String(profile.role_id), code: 'mail.failure', severity: 'warning' });
    }
    return {
      status: database === 'ok' ? 'ok' : 'degraded',
      startedAt: this.startedAt,
      uptimeSeconds: Math.floor(process.uptime()),
      dependencies: { database },
      requestMetrics: { retention: 'process-memory', seriesLimit: this.maxSeries, routes: requests },
      operationalMetrics: {
        window: '30 days',
        queues: { status: queues.status, byKindAndStatus: queues.rows },
        backups: { status: backups.status, byKindAndStatus: backups.rows },
        blindedAccesses: { status: privacyAndDocuments.status, count: Number(eventTotals.blinded_accesses || 0) },
        documentEvents: { status: privacyAndDocuments.status, count: Number(eventTotals.document_events || 0) },
        documentGeneration: {
          status: privacyAndDocuments.status,
          successes: Number(eventTotals.document_generation_successes || 0),
          failures: Number(eventTotals.document_generation_failures || 0),
        },
        outboundMail: {
          status: privacyAndDocuments.status,
          attempts: Number(eventTotals.mail_delivery_attempts || 0),
          failures: Number(eventTotals.mail_delivery_failures || 0),
        },
      },
      alertProfiles: { status: configuredAlerts.status },
      alerts,
    };
  }
}

@Controller('monitoring')
export class MonitoringController {
  constructor(@Inject(MonitoringService) private readonly monitoring: MonitoringService, @Inject(AccessService) private readonly access: AccessService) {}

  @Get()
  async snapshot(@Req() req: AccessRequest) {
    const actor = req.orbitActor!;
    const account = await this.access.account(actor);
    const profiles = account.is_root ? undefined : (await this.access.grants(actor)).map(row => row.role_id);
    return this.monitoring.snapshot(profiles);
  }

  @Get('alert-profiles') alertProfiles() { return this.monitoring.listAlertProfiles(); }

  @Put('alert-profiles/:roleId') async saveAlertProfile(@Req() req: AccessRequest, @Param('roleId') roleId: string, @Body() body: Record<string, unknown>) {
      const result = await this.monitoring.saveAlertProfile(req.orbitActor!, roleId, body);
    await this.access.audit(req.orbitActor!, 'monitoring.alert_profile.updated', roleId);
    return result;
  }
}
