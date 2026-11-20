import type { PluginDefinition, ProfileSimulationExample } from '../plugins/contract';

export type ProfileSimulationPluginContext = {
  roleId: string;
  roleName: string;
  permissions: readonly string[];
};

/**
 * Domain plugins may add bounded synthetic examples to the ROOT simulation
 * popup. These values are presentation-only: this helper never writes them or
 * grants access to the plugin's real routes.
 */
export function profileSimulationPluginExamples(
  plugins: readonly PluginDefinition[],
  context: ProfileSimulationPluginContext,
): ProfileSimulationExample[] {
  const examples: ProfileSimulationExample[] = [];
  for (const plugin of plugins) {
    const provide = plugin.contributions?.profileSimulationExamples;
    if (!provide) continue;
    let values: readonly ProfileSimulationExample[];
    try { values = provide(context); } catch { continue; }
    if (!Array.isArray(values)) continue;
    for (const item of values.slice(0, 12)) {
      if (!item || typeof item.id !== 'string' || !/^[a-z0-9][a-z0-9._:-]{0,119}$/i.test(item.id)
        || typeof item.title !== 'string' || typeof item.type !== 'string'
        || typeof item.state !== 'string' || typeof item.description !== 'string'
        || item.is_demo !== true) continue;
      examples.push({
        id: `${plugin.id}:${item.id}`.slice(0, 180),
        title: item.title.slice(0, 160), type: item.type.slice(0, 60),
        state: item.state.slice(0, 60), description: item.description.slice(0, 500), is_demo: true,
      });
      if (examples.length >= 60) return examples;
    }
  }
  return examples;
}

export function withProfileSimulationPluginExamples<T extends { records: Array<{ id: string }> }>(
  base: T,
  plugins: readonly PluginDefinition[],
  context: ProfileSimulationPluginContext,
): T {
  const existing = new Set(base.records.map(record => record.id));
  const additional = profileSimulationPluginExamples(plugins, context).filter(example => !existing.has(example.id));
  return { ...base, records: [...base.records, ...additional] };
}
