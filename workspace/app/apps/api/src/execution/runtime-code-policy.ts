import { ForbiddenException } from '@nestjs/common';

/**
 * Runtime-level policy for the code-writing/execution product surface.
 * Legacy runtime IDs are retained for compatibility with existing databases;
 * the product names Forge and Workspace map to those IDs until their persisted
 * runtime identities are migrated explicitly.
 */
const CODE_DEVELOPMENT_RUNTIME_IDS = new Set(['dev', 'prod', 'forge', 'workspace']);
const CODE_DEVELOPMENT_PLUGIN_IDS = new Set(['software-development', 'codex-ide']);

export function canUseAiCodeDevelopment(runtimeId: string): boolean {
  return CODE_DEVELOPMENT_RUNTIME_IDS.has(runtimeId);
}

export function assertAiCodeDevelopmentAllowed(runtimeId: string): void {
  if (!canUseAiCodeDevelopment(runtimeId)) {
    throw new ForbiddenException({
      code: 'ai_code_development_unavailable',
      message: 'Desenvolvimento de código por IA está disponível somente no Forge e no Workspace.',
    });
  }
}

export function assertAiCodeDevelopmentPluginCanBeEnabled(runtimeId: string, pluginId: string, enabled: boolean): void {
  if (enabled && CODE_DEVELOPMENT_PLUGIN_IDS.has(pluginId) && !canUseAiCodeDevelopment(runtimeId)) {
    throw new ForbiddenException({
      code: 'ai_code_development_unavailable',
      message: 'Plugins de desenvolvimento de código por IA só podem ser ativados no Forge e no Workspace.',
    });
  }
}
