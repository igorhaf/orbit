import 'reflect-metadata';
import { Controller, Get, Inject, Module, type DynamicModule } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Pool, type PoolClient } from 'pg';
import { AccessGuard, AccessService } from '../../apps/api/src/access/access';
import { Db } from '../../apps/api/src/db';
import { PluginRegistry } from '../../apps/api/src/execution/registries';
import { createPluginSettingsPrivatePool } from '../../apps/api/src/plugins/plugin-settings-boundary';
import { composePluginSettingsHost } from '../../apps/api/src/plugins/plugin-settings-host';
import { PluginSettingsController, PluginSettingsService } from '../../apps/api/src/plugins/plugin-settings';

@Controller()
class FixtureCatalog {
  constructor(@Inject(PluginRegistry) private readonly registry: PluginRegistry) {}
  @Get('plugins') plugins() { return this.registry.catalog(); }
}

@Module({})
class FixtureApi {}

async function run() {
  const host = process.env.R6_TEST_SOCKET;
  if (!host || !/^\/tmp\/orbit-r6-http-[A-Za-z0-9]+$/.test(host) || !process.send) {
    throw new Error('Private HTTP fixture socket and IPC required');
  }
  const connection = { host, port: 55446, database: 'orbit_r5ca_fixture' };
  const db = Object.create(Db.prototype) as Db;
  db.pool = new Pool({ ...connection, user: 'http_app', statement_timeout: 5000 });
  const writer = createPluginSettingsPrivatePool({ ...connection, user: 'http_writer' });
  const identity = await db.one<{ ok: boolean }>(
    "SELECT inet_server_addr() IS NULL AND current_database()='orbit_r5ca_fixture' AND current_user='http_app' AS ok",
  );
  if (!identity?.ok) throw new Error('Unexpected fixture identity');

  let fail: 'registry' | 'notification' | 'ack' | undefined;
  let dropAck = false;
  let disconnected = false;
  const connect = writer.connect.bind(writer) as () => Promise<PoolClient>;
  // Faults are scoped to fixture IPC and this private pool.
  writer.connect = (async () => {
    if (disconnected) throw new Error('Fixture private connection is offline');
    const client = await connect();
    return {
      query: async (...args: [string, ...unknown[]]) => {
        const query = client.query.bind(client) as (...input: unknown[]) => Promise<unknown>;
        const result = await query(...args);
        if (args[0].includes('UPDATE editorial_authorization_generation') && fail === 'ack') dropAck = true;
        if (args[0] === 'COMMIT' && dropAck) {
          dropAck = false;
          fail = undefined;
          throw new Error('Fixture drops COMMIT acknowledgement');
        }
        return result;
      },
      release: (error?: Error | boolean) => client.release(error),
    };
  }) as typeof writer.connect;
  const registry = new PluginRegistry();
  for (const id of ['board-view', 'structured-view', 'vault', 'vault-child', 'default-off']) {
    registry.register({ id, name: id, version: '1.0.0', dependencies: id === 'vault-child' ? ['vault'] : [] });
  }
  const set = registry.setEnabled.bind(registry);
  registry.setEnabled = (id, enabled) => {
    if (fail === 'registry') {
      fail = undefined;
      throw new Error('Fixture registry failure');
    }
    set(id, enabled);
  };
  const defaults = new Map([['default-off', false]]);
  const service = process.env.ORBIT_PLUGIN_SETTINGS_MODE
    ? await composePluginSettingsHost(db, registry, defaults, () => {}, process.env)
    : await PluginSettingsService.participant(db, writer, registry, defaults, () => {
    if (fail === 'notification') {
      fail = undefined;
      throw new Error('Fixture notification failure');
    }
  }, Number(process.env.R6_TEST_POLL_MS || 100));
  const mod: DynamicModule = {
    module: FixtureApi,
    controllers: [PluginSettingsController, FixtureCatalog],
    providers: [
      AccessService, AccessGuard,
      { provide: PluginSettingsService, useValue: service },
      { provide: PluginRegistry, useValue: registry },
      { provide: Db, useValue: db },
    ],
  };
  const app = await NestFactory.create(mod, { logger: false, abortOnError: false });
  app.useGlobalGuards(app.get(AccessGuard));
  await app.listen(0, '127.0.0.1');
  process.on('message', message => {
    if (message === 'stop') void app.close().then(() => process.disconnect());
    else if (message === 'hint') {
      void service.refresh().then(() => process.send?.({ hint: true }), () => process.send?.({ hint: false }));
    } else if (message === 'disconnect-writer' || message === 'reconnect-writer') {
      disconnected = message === 'disconnect-writer';
      process.send?.({ disconnected });
    }
    else if (message === 'registry' || message === 'notification' || message === 'ack') {
      fail = message;
      process.send?.({ fault: message });
    }
  });
  process.send({ port: app.getHttpServer().address().port });
}

void run().catch(error => {
  process.stderr.write(String(error) + '\n');
  process.exitCode = 1;
  process.disconnect?.();
  // If construction failed after a Pool initialized, do not hold the test open.
  setImmediate(() => process.exit(1));
});
