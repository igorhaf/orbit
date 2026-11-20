import assert from 'node:assert/strict';
import test from 'node:test';
import { PluginRegistry } from './execution/registries';
import { GastroInventoryService, gastroInventoryPlugin } from './gastro-inventory.plugin';
import { profileSimulationPluginExamples } from './access/profile-simulation-plugins';

function registry() {
  const plugins = new PluginRegistry();
  plugins.register({ id: 'versioned-records', name: 'Registros versionados', version: '1.0.0' });
  plugins.register({ id: 'workspaces', name: 'Workspaces', version: '1.0.0' });
  plugins.register({ id: 'gastro-clinic', name: 'Gestão clínica', version: '1.0.0', dependencies: ['versioned-records', 'workspaces'] });
  plugins.register(gastroInventoryPlugin);
  return plugins;
}

test('Gastro inventory checks the product toggle and delegates read/write permission to the exact workspace scope', async () => {
  const space = '00000000-0000-4000-8000-000000000001';
  const calls: unknown[][] = [];
  const db = { one: async () => ({ id: space }), query: async () => [] };
  const access = { require: async (...args: unknown[]) => { calls.push(args); }, audit: async () => undefined };
  const plugins = registry();
  const service = new GastroInventoryService(db as never, access as never, plugins);
  await service.products(space, 'actor');
  await service.createProduct(space, 'actor', { name: 'Material', unit: 'unidade' });
  assert.deepEqual(calls, [
    ['actor', 'plugin.gastro-inventory.read', 'workspace', space],
    ['actor', 'plugin.gastro-inventory.write', 'workspace', space],
  ]);
  plugins.setEnabled('gastro-inventory', false);
  await assert.rejects(() => service.products(space, 'actor'), /desativado/i);
});

test('Gastro inventory contributes only synthetic ROOT examples to profiles with inventory read access', () => {
  const examples = profileSimulationPluginExamples([gastroInventoryPlugin], {
    roleId: 'inventory-reader', roleName: 'Leitura de estoque', permissions: ['plugin.gastro-inventory.read'],
  });
  assert.deepEqual(examples.map(({ id, type, is_demo }) => ({ id, type, is_demo })), [
    { id: 'gastro-inventory:stock-overview', type: 'inventory_overview', is_demo: true },
    { id: 'gastro-inventory:lot-review', type: 'inventory_lot', is_demo: true },
  ]);
  assert.deepEqual(profileSimulationPluginExamples([gastroInventoryPlugin], {
    roleId: 'unrelated', roleName: 'Outro perfil', permissions: ['plugin.gastro-clinic.read'],
  }), []);
});
