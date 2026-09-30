import { HttpException, Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { ActionDispatcher } from '../action-dispatcher';
import { defineAction, defineCapability, defineContribution, definePlugin } from '../plugins/sdk';

@Injectable()
export class DeployPlugin implements OnModuleInit {
  constructor(@Inject(ActionDispatcher) private dispatcher: ActionDispatcher) {}

  onModuleInit() {
    this.dispatcher.register('deploy.publish', async (request) => {
      await this.queue(request.userId);
    });
  }

  private async target() {
    const applicationRoot = resolve(process.cwd(), '../..');
    const stableSibling = applicationRoot.endsWith('-dev')
      ? applicationRoot.slice(0, -4)
      : applicationRoot;
    const candidates = [...new Set([
      process.env.ORBIT_DEPLOY_ROOT && resolve(process.env.ORBIT_DEPLOY_ROOT),
      stableSibling,
      applicationRoot,
    ].filter((candidate): candidate is string => Boolean(candidate)))];
    for (const root of candidates) {
      try {
        const manager = join(root, '.orbit-deploy-manager');
        if (Date.now() - (await stat(manager)).mtimeMs <= 10_000) return root;
      } catch {
        continue;
      }
    }
    throw new HttpException(
      { message: `O plugin Deploy não encontrou um gerenciador ativo. Inicie “npm run orbit:serve” em ${stableSibling}.` },
      409,
    );
  }

  private request(root: string, userId: string) {
    return writeFile(
      join(root, '.orbit-deploy-request'),
      JSON.stringify({ requested_at: new Date().toISOString(), user_id: userId }),
      { mode: 0o600 },
    );
  }

  async queue(userId: string) {
    const root = await this.target();
    const timer = setTimeout(() => {
      void this.request(root, userId).catch((error) => console.error('Deploy plugin:', error));
    }, 750);
    timer.unref();
    return { ok: true, message: 'Publicação adicionada à fila.' };
  }

  async publish(userId: string) {
    const root = await this.target();
    await this.request(root, userId);
    return {
      ok: true,
      message: 'Publicação iniciada. O desenvolvimento será compilado, enviado ao main e o Orbit será reiniciado.',
    };
  }
}

export const deployPluginDefinition = (plugin: DeployPlugin) =>
  definePlugin({
    id: 'deploy',
    name: 'Deploy local',
    version: '1.0.0',
    description: 'Publica a versão de desenvolvimento do Orbit no ambiente principal.',
    scope: 'workspace',
    capabilities: [
      defineCapability({
        id: 'environment.deploy',
        name: 'Publicar ambiente',
      }),
    ],
    actions: [
      defineAction({
        id: 'publish',
        name: 'Publicar Orbit',
        requiredCapabilities: ['environment.deploy'],
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        outputSchema: {
          type: 'object',
          required: ['type', 'label', 'value'],
          properties: {
            type: { const: 'json' },
            label: { type: 'string' },
            value: { type: 'object' },
          },
        },
        async execute(_input, context) {
          const value = await plugin.publish(context.userId || 'system');
          return { type: 'json', label: 'Deploy', value };
        },
      }),
    ],
    contributions: {
      automationActions: [
        defineContribution({
          id: 'deploy.publish',
          label: 'Publicar Orbit',
          description: 'Compila o develop, atualiza o main e reinicia a aplicação.',
          scope: 'workspace',
        }),
      ],
      automationTemplates: [
        defineContribution({
          id: 'deploy.publish-orbit',
          name: 'Publicar o Orbit',
          description: 'Fluxo manual e auditável para publicar o develop no ambiente principal.',
          category: 'Entrega',
          tags: ['deploy', 'publicação', 'plugin'],
          definition: {
            trigger: { type: 'board_button' },
            conditions: [],
            actions: [{ type: 'deploy.publish', target: 'board' }],
          },
        }),
      ],
    },
  });
