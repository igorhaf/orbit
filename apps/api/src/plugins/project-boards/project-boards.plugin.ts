import type { PluginDefinition } from '../contract';
import type { PluginRegistry } from '../../execution/registries';
import type { Request, Response, NextFunction } from 'express';

export const projectBoardsPlugin: PluginDefinition = {
  id: 'project-boards', name: 'Criação de projetos e quadros', version: '1.0.0',
  description: 'Criação e cópia de quadros e cadastro de projetos, independente da IA e dos quadros fornecidos por outros plugins.',
  capabilities: [
    { id: 'boards', name: 'Criar quadros', permissions: ['boards.write'] },
    { id: 'projects', name: 'Cadastrar projetos', permissions: ['projects.write'] },
  ],
};

/** Only creation routes belong here; existing resources remain accessible. */
export function isProjectBoardCreation(path: string, method: string): boolean {
  return method === 'POST' && (/^\/boards\/?$/.test(path) || /^\/boards\/[^/]+\/copy\/?$/.test(path) || /^\/ai\/projects(?:\/directories)?\/?$/.test(path));
}

export function projectBoardCreationAccess(registry: PluginRegistry) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (isProjectBoardCreation(req.path, req.method) && !registry.isEnabled('project-boards')) {
      res.status(409).json({ message: 'A criação de projetos e quadros está desativada nesta instância.' });
      return;
    }
    next();
  };
}
