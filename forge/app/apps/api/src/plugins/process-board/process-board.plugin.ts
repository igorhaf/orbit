import type { PluginDefinition } from '../contract';

/** Reusable structured view; each domain supplies its authorized records and workflow. */
export const processBoardPlugin: PluginDefinition = {
  id: 'process-board', name: 'Gestão de processos', version: '1.0.0',
  description: 'Quadro único com grupos, fases e registros de processos fornecidos por plugins, sem duplicar dados de negócio.',
  dependencies: ['versioned-records', 'structured-view'],
  capabilities: [{ id: 'read', name: 'Consultar quadros de processos', permissions: ['plugin.process-board.read', 'views.structured.use'] }],
};
