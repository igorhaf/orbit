import { Controller, Get, HttpException, Inject, Injectable, Param, Query, Req } from '@nestjs/common';
import type { AccessRequest } from './access/access';
import { AccessService, id } from './access/access';
import { Db } from './db';
import { PluginRegistry } from './execution/registries';
import type { PluginDefinition } from './plugins/contract';
import { ExtensionRecords } from './plugins/records/records.service';

const fail = (message: string, status = 400): never => { throw new HttpException(message, status); };
const groupFields = {
  patient: { field: 'patient_id', kind: 'patient' },
  insurance: { field: 'insurance_provider_id', kind: 'insurance_provider' },
  service: { field: 'service_id', kind: 'service_catalog' },
  professional: { field: 'professional_id', kind: 'professional' },
} as const;
type GroupBy = keyof typeof groupFields;
type ReportGroup = { label: string; count: number; subgroups?: Array<{ label: string; count: number }> };
type ReportRecord = { id: string; workspace_id: string; kind: string; state: string; payload: Record<string, unknown>; title: string };

function reportPeriod(from: unknown, through: unknown, allPeriod: boolean) {
  const date = (value: unknown) => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const parsed = Date.parse(`${value}T00:00:00.000Z`);
    return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value ? parsed : null;
  };
  const start = date(from);
  const lastDay = date(through);
  if (start === null || lastDay === null) return fail('Informe um período válido com início anterior ou igual ao fim.');
  if (lastDay < start) return fail('Informe um período válido com início anterior ou igual ao fim.');
  if (allPeriod && from !== '0001-01-01') return fail('O período Todos precisa usar o início de histórico permitido.');
  const until = lastDay + 24 * 60 * 60 * 1000;
  if (!allPeriod && until - start > 366 * 24 * 60 * 60 * 1000) fail('O relatório aceita períodos personalizados de até 366 dias.');
  return { start: new Date(start).toISOString(), until: new Date(until).toISOString() };
}

export const gastroReportsPlugin: PluginDefinition = {
  id: 'gastro-reports', name: 'Relatórios administrativos', version: '1.0.0',
  parentPlugin: 'gastro-clinic', dependencies: ['gastro-clinic'],
  description: 'Consultas agregadas e somente leitura de atendimentos administrativos concluídos.',
  capabilities: [{ id: 'read', name: 'Consultar relatórios administrativos', permissions: ['plugin.gastro-reports.read'] }],
  handlesRoute: path => /^\/gastro-reports(?:\/|$)/.test(path),
  routePermission: () => null,
  contributions: {
    navigation: [{ id: 'gastro-reports', label: 'Relatórios', href: '/gastro-reports', permission: 'plugin.gastro-reports.read', order: 27 }],
    profileSimulationExamples: context => context.permissions.includes('plugin.gastro-reports.read') ? [
      { id: 'attendances-demo', title: 'Atendimentos concluídos', type: 'relatório', state: 'somente leitura', description: 'Exemplo sintético de agrupamento; nenhum dado de pessoas é consultado.', is_demo: true },
    ] : [],
  },
};

@Injectable()
export class GastroReportsService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(AccessService) private readonly access: AccessService,
    @Inject(PluginRegistry) private readonly plugins: PluginRegistry,
    @Inject(ExtensionRecords) private readonly records: ExtensionRecords,
  ) {}

  completedAppointments(workspaceId: string, user: string, from: unknown, through: unknown, groupBy: unknown, subgroupBy?: unknown, periodMode?: unknown) {
    return this.aggregateAppointments(workspaceId, user, from, through, groupBy, subgroupBy, periodMode, 'completed', 'completed');
  }

  patientAbsences(workspaceId: string, user: string, from: unknown, through: unknown, periodMode?: unknown) {
    return this.aggregateAppointments(workspaceId, user, from, through, 'patient', undefined, periodMode, 'no_show', 'patient_absences');
  }

  private async aggregateAppointments(workspaceId: string, user: string, from: unknown, through: unknown, groupBy: unknown, subgroupBy: unknown, periodMode: unknown, appointmentState: 'completed' | 'no_show', reportType: 'completed' | 'patient_absences') {
    id(workspaceId);
    if (!this.plugins.isEnabled('gastro-reports')) fail('O plugin de relatórios ou uma dependência está desativado.', 409);
    if (!Object.hasOwn(groupFields, String(groupBy))) fail('Agrupamento de relatório inválido.');
    const group = groupFields[groupBy as GroupBy];
    if (subgroupBy !== undefined && subgroupBy !== '' && !Object.hasOwn(groupFields, String(subgroupBy))) fail('Subagrupamento de relatório inválido.');
    const subgroupKey = subgroupBy === undefined || subgroupBy === '' ? null : subgroupBy as GroupBy;
    if (subgroupKey === groupBy) fail('O agrupamento principal e o subagrupamento precisam ser diferentes.');
    const subgroup = subgroupKey ? groupFields[subgroupKey] : null;
    if (periodMode !== undefined && periodMode !== 'all' && periodMode !== 'range') fail('Tipo de período inválido.');
    const allPeriod = periodMode === 'all';
    const period = reportPeriod(from, through, allPeriod);
    await this.access.require(user, 'plugin.gastro-reports.read', 'workspace', workspaceId);
    if (!await this.db.one('SELECT id FROM workspaces WHERE id=$1 AND archived_at IS NULL', [workspaceId])) fail('Workspace não encontrado ou arquivado.', 404);

    const maximumScanned = 5_000;
    const candidates = await this.db.query<{ id: string; appointment_at: string }>(`
      SELECT id,
        CASE WHEN pg_input_is_valid(payload->>'starts_at', 'timestamp with time zone')
          THEN (payload->>'starts_at')::timestamptz ELSE NULL END::text AS appointment_at
      FROM extension_records
      WHERE workspace_id=$1 AND plugin_id='gastro-clinic' AND kind='appointment' AND state=$4
        AND CASE WHEN pg_input_is_valid(payload->>'starts_at', 'timestamp with time zone')
          THEN (payload->>'starts_at')::timestamptz ELSE NULL END >= $2::timestamptz
        AND CASE WHEN pg_input_is_valid(payload->>'starts_at', 'timestamp with time zone')
          THEN (payload->>'starts_at')::timestamptz ELSE NULL END < $3::timestamptz
      LIMIT $5`,
    [workspaceId, period.start, period.until, appointmentState, maximumScanned + 1]);
    if (candidates.length > maximumScanned) fail('O relatório excede 5.000 atendimentos; selecione um período menor.', 413);

    const authorizedAppointments: ReportRecord[] = [];
    const authorizationBatchSize = 20;
    for (let offset = 0; offset < candidates.length; offset += authorizationBatchSize) {
      const batch = await Promise.all(candidates.slice(offset, offset + authorizationBatchSize).map(async candidate => {
        const record = await this.readAppointment(candidate.id, workspaceId, user);
        if (!record || record.state !== appointmentState) return null;
        const startsAt = typeof record.payload.starts_at === 'string' ? Date.parse(record.payload.starts_at) : NaN;
        const start = Date.parse(period.start);
        const until = Date.parse(period.until);
        return Number.isFinite(startsAt) && startsAt >= start && startsAt < until ? record : null;
      }));
      authorizedAppointments.push(...batch.filter((record): record is ReportRecord => record !== null));
    }

    const labels = new Map<string, string | null>();
    const counts = new Map<string, { label: string; count: number; subgroups: Map<string, { label: string; count: number }> }>();
    const resolveBucket = async (appointment: ReportRecord, field: typeof groupFields[GroupBy]) => {
      const value = appointment.payload[field.field];
      if (typeof value !== 'string' || !value) return { key: `${field.kind}:missing`, label: 'Não informado' };
      const cacheKey = `${field.kind}:${value}`;
      if (!labels.has(cacheKey)) labels.set(cacheKey, await this.readReferenceLabel(value, field.kind, workspaceId, user));
      const label = labels.get(cacheKey) ?? null;
      return label === null
        ? { key: `${field.kind}:unavailable`, label: 'Referência sem acesso' }
        : { key: cacheKey, label };
    };
    for (const appointment of authorizedAppointments) {
      const primary = await resolveBucket(appointment, group);
      const current = counts.get(primary.key) || { label: primary.label, count: 0, subgroups: new Map() };
      current.count += 1;
      if (subgroup) {
        const secondary = await resolveBucket(appointment, subgroup);
        const child = current.subgroups.get(secondary.key) || { label: secondary.label, count: 0 };
        child.count += 1;
        current.subgroups.set(secondary.key, child);
      }
      counts.set(primary.key, current);
    }

    await this.access.require(user, 'plugin.gastro-reports.read', 'workspace', workspaceId);
    const groups: ReportGroup[] = [...counts.values()]
      .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, 'pt-BR'))
      .map(({ label, count, subgroups }) => ({ label, count, ...(subgroup ? { subgroups: [...subgroups.values()]
        .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, 'pt-BR')) } : {}) }));
    return { report_type: reportType, from: allPeriod ? null : from as string, through: through as string, period_mode: allPeriod ? 'all' : 'range', group_by: groupBy as GroupBy, subgroup_by: subgroupKey,
      total: groups.reduce((sum, group) => sum + group.count, 0), groups, generated_at: new Date().toISOString() };
  }

  private async readAppointment(recordId: string, workspaceId: string, user: string): Promise<ReportRecord | null> {
    try {
      const record = await this.records.detail('gastro-clinic', recordId, user) as ReportRecord;
      return record.workspace_id === workspaceId && record.kind === 'appointment' ? record : null;
    } catch (error) {
      if (error instanceof HttpException && [403, 404].includes(error.getStatus())) return null;
      throw error;
    }
  }

  private async readReferenceLabel(recordId: string, kind: string, workspaceId: string, user: string): Promise<string | null> {
    try {
      const record = await this.records.detail('gastro-clinic', recordId, user) as ReportRecord;
      if (record.workspace_id !== workspaceId || record.kind !== kind || typeof record.title !== 'string') return null;
      return record.title;
    } catch (error) {
      if (error instanceof HttpException && [403, 404].includes(error.getStatus())) return null;
      throw error;
    }
  }
}

@Controller('gastro-reports')
export class GastroReportsController {
  constructor(@Inject(GastroReportsService) private readonly reports: GastroReportsService) {}
  @Get('workspaces/:workspace/completed-appointments') completedAppointments(
    @Req() req: AccessRequest,
    @Param('workspace') workspace: string,
    @Query('from') from: string,
    @Query('through') through: string,
    @Query('group_by') groupBy: string,
    @Query('sub_group_by') subgroupBy: string,
    @Query('period_mode') periodMode: string,
  ) {
    return this.reports.completedAppointments(workspace, String(req.orbitUser), from, through, groupBy, subgroupBy, periodMode);
  }

  @Get('workspaces/:workspace/patient-absences') patientAbsences(
    @Req() req: AccessRequest,
    @Param('workspace') workspace: string,
    @Query('from') from: string,
    @Query('through') through: string,
    @Query('period_mode') periodMode: string,
  ) {
    return this.reports.patientAbsences(workspace, String(req.orbitUser), from, through, periodMode);
  }
}
