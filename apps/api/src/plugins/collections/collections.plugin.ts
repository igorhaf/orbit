import type { PluginDefinition } from '../contract';
import type { AccessService } from '../../access/access';
import type { Db } from '../../db';
import type { PluginRegistry } from '../../execution/registries';

export const collectionsPlugin: PluginDefinition = {
  id: 'collections', name: 'Coleções', version: '1.0.0',
  description: 'Categorias e cartões reutilizáveis, com ativação e privilégios próprios; os dados são preservados quando desativado.',
  capabilities: ['read', 'write'].map(action => ({ id: action, name: action === 'read' ? 'Consultar coleções' : 'Organizar coleções', permissions: [`plugin.collections.${action}`] })),
};

export function installCollectionsAccess(db: Db, registry: PluginRegistry, access: AccessService) {
  access.registerBoardPolicy(async (boardId, user, permission, snapshot) => {
    const board = snapshot || await db.one<{ is_collection: boolean }>('SELECT is_collection FROM boards WHERE id=$1', [boardId]);
    if (!board?.is_collection) return true;
    return registry.isEnabled('collections') && access.has(user, `plugin.collections.${permission === 'boards.write' ? 'write' : 'read'}`);
  });
}
