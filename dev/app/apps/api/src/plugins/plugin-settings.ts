import { Body, Controller, HttpException, Inject, Param, Patch, Req, type OnModuleDestroy } from '@nestjs/common';
import type { Pool } from 'pg';
import { AccessService, type AccessRequest } from '../access/access';
import { Db } from '../db';
import { EditorialAuthorizationGenerationRepository } from '../execution/editorial-authorization-generation';
import { reconcileEditorialPluginSetting, type PluginSettingReconciliationResult } from '../execution/editorial-plugin-settings-orchestration';
import { recoverEditorialPluginSetting } from '../execution/editorial-plugin-settings-recovery';
import { PluginRegistry } from '../execution/registries';
import { hasBoardViewAfterChange, REQUIRED_BOARD_VIEW_PLUGIN_IDS } from './board-views/required-views';
import { assertPluginSettingsDatabaseBoundary, type PluginSettingsApproval } from './plugin-settings-boundary';

type Notify = (id: string) => void | Promise<void>;
type Observation = Map<string, boolean>;

function reject(status: number, message: string, code?: string): never {
  throw new HttpException(code ? { statusCode: status, message, code } : message, status);
}

export class PluginSettingsService implements OnModuleDestroy {
  private pending: Promise<unknown> = Promise.resolve();
  private timer?: NodeJS.Timeout;
  private polling = false;
  private closed = false;
  private shutdown?: Promise<void>;

  private constructor(
    private readonly db: Db,
    private readonly registry: PluginRegistry,
    private readonly defaults: ReadonlyMap<string, boolean>,
    private readonly notify: Notify,
    private readonly mode: 'legacy' | 'paused' | 'participant',
    private readonly repository?: EditorialAuthorizationGenerationRepository,
    private readonly closePrivatePool?: () => Promise<void>,
  ) {}

  static beforeCutover(db: Db, registry: PluginRegistry, defaults: ReadonlyMap<string, boolean>,
    notify: Notify, mode: 'legacy' | 'paused',
  ) {
    return new PluginSettingsService(db, registry, defaults, notify, mode);
  }

  /** Only trusted, explicitly composed hosts can supply and transfer ownership of this pool. */
  static async participant(db: Db, privatePool: Pool, registry: PluginRegistry,
    defaults: ReadonlyMap<string, boolean>, notify: Notify, pollMs = 5000, approval?: PluginSettingsApproval,
  ) {
    if (privatePool === db.pool) throw new Error('separate_plugin_configuration_pool_required');
    try {
      const anchor = await assertPluginSettingsDatabaseBoundary(db.pool, privatePool, approval);
      const service = new PluginSettingsService(db, registry, defaults, notify, 'participant',
        new EditorialAuthorizationGenerationRepository(privatePool, anchor), () => privatePool.end());
      await service.refresh(false);
      service.timer = setInterval(() => {
        if (service.polling || service.closed) return;
        service.polling = true;
        void service.refresh().catch(() => undefined).finally(() => { service.polling = false; });
      }, pollMs);
      service.timer.unref();
      return service;
    } catch (error) {
      await privatePool.end();
      throw error;
    }
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.pending.then(operation);
    this.pending = next.catch(() => undefined);
    return next;
  }

  private async applyObservation(observation: Observation, publish: boolean) {
    const changed = this.registry.catalog()
      .filter(plugin => observation.get(plugin.id) !== undefined && plugin.configuredEnabled !== observation.get(plugin.id));
    for (const plugin of changed) this.registry.setEnabled(plugin.id, observation.get(plugin.id)!);
    // Apply all configured bits first so dependency visibility derives from the same observation.
    if (publish) for (const plugin of changed) await this.notify(plugin.id);
  }

  /** Refresh hints carry no state. Polling also repairs missed or reordered hints. */
  refresh(publish = true) {
    return this.serialize(async () => {
      if (!this.repository || this.closed) return;
      const { settings } = await this.repository.observePluginSettings();
      const observation = new Map(this.registry.catalog().map(plugin => [
        plugin.id, settings.get(plugin.id) ?? this.defaults.get(plugin.id) ?? true,
      ]));
      await this.applyObservation(observation, publish);
    });
  }

  private async legacyToggle(id: string, enabled: boolean) {
    const guard = await this.db.one<{ generation: string | null }>(
      "SELECT to_regclass('public.editorial_authorization_generation')::text AS generation",
    );
    if (!guard || guard.generation) reject(503, 'Configuração de plugins indisponível durante a transição.');
    const command = `INSERT INTO public.plugin_settings(plugin_id,enabled) VALUES($1,$2)
      ON CONFLICT(plugin_id) DO UPDATE SET enabled=EXCLUDED.enabled,updated_at=now()`;
    if (!enabled && (REQUIRED_BOARD_VIEW_PLUGIN_IDS as readonly string[]).includes(id)) {
      const client = await this.db.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended('orbit.required-board-view',0))");
        const rows = await client.query<{plugin_id: string; enabled: boolean}>(
          'SELECT plugin_id,enabled FROM public.plugin_settings WHERE plugin_id=ANY($1::text[])', [REQUIRED_BOARD_VIEW_PLUGIN_IDS],
        );
        if (!hasBoardViewAfterChange(new Map(rows.rows.map(row => [row.plugin_id, row.enabled])), id, enabled)) {
          reject(409, 'Mantenha ativo pelo menos um modo de quadro: Quadro visual ou Gestão estruturada.');
        }
        await client.query(command, [id, enabled]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally { client.release(); }
    } else {
      await this.db.query(command, [id, enabled]);
    }
    this.registry.setEnabled(id, enabled);
    await this.notify(id);
    return { id, enabled };
  }

  async toggle(id: string, enabled: unknown, authorize: () => Promise<void>) {
    return this.serialize(async () => {
      if (this.closed) reject(503, 'Configuração de plugins indisponível.');
      await authorize();
      if (!this.registry.isInstalled(id)) reject(404, 'O plugin não está instalado nesta instância.');
      if (typeof enabled !== 'boolean') reject(400, 'Estado do plugin inválido.');
      if (this.mode === 'legacy') return this.legacyToggle(id, enabled);
      const repository = this.repository;
      if (!repository) reject(503, 'Configuração de plugins indisponível durante a transição.');

      let generation;
      try { generation = await repository.observe(); }
      catch { reject(503, 'Writer de configuração indisponível.'); }
      const result = await reconcileEditorialPluginSetting(repository, this.registry, this.notify, generation, id, enabled);
      if (result.status === 'committed_local_stale' || result.status === 'commit_uncertain' || result.status === 'failed_unconfirmed') {
        // The next observation is a read, never a second command.
        const recovered = await recoverEditorialPluginSetting(repository, this.registry, id, undefined, this.defaults.get(id) ?? true);
        if (recovered.status === 'reconciled_observed') {
          try { await this.notify(id); } catch { /* Local state was recovered. */ }
        }
      }
      return this.response(id, enabled, result);
    });
  }

  private response(id: string, enabled: boolean, result: PluginSettingReconciliationResult) {
    switch (result.status) {
      case 'committed_reconciled':
      case 'committed_local_stale': return { id, enabled, sync: result.readiness.state };
      case 'commit_uncertain': return reject(503, 'Confirmação da gravação indisponível. Recarregue a configuração antes de tentar novamente.', result.status);
      case 'rejected':
        if (result.reason === 'required_board_view') return reject(409, 'Mantenha ativo pelo menos um modo de quadro: Quadro visual ou Gestão estruturada.', result.reason);
        if (result.reason === 'plugin_unknown' || result.reason === 'plugin_not_installed') return reject(404, 'O plugin não está instalado nesta instância.');
        if (result.reason === 'invalid_setting') return reject(400, 'Estado do plugin inválido.');
        return reject(409, 'A configuração mudou. Recarregue e tente novamente.', result.reason);
      default: return reject(503, 'A operação de configuração não pôde ser confirmada.', result.status);
    }
  }

  onModuleDestroy() {
    if (!this.shutdown) {
      this.closed = true;
      clearInterval(this.timer);
      this.shutdown = this.pending.then(() => this.closePrivatePool?.());
    }
    return this.shutdown;
  }
}

@Controller('plugins')
export class PluginSettingsController {
  constructor(
    @Inject(PluginSettingsService) private readonly settings: PluginSettingsService,
    @Inject(AccessService) private readonly access: AccessService,
  ) {}

  @Patch(':id')
  toggle(@Req() request: AccessRequest, @Param('id') id: string, @Body() body?: { enabled?: unknown }) {
    // The globally registered AccessGuard supplies the actor. Reauthenticate at
    // execution time in case a locally queued request outlives its session.
    const actor = request.orbitActor;
    if (!actor) reject(401, 'Faça login para continuar.');
    const token = request.headers.authorization?.replace(/^Bearer /i, '');
    if (!token) reject(401, 'Faça login para continuar.');
    return this.settings.toggle(id, body?.enabled, async () => {
      if ((await this.access.authenticate(token)).id !== actor) reject(403, 'Acesso não autorizado.');
      await this.access.require(actor, 'plugins.manage');
    });
  }
}
