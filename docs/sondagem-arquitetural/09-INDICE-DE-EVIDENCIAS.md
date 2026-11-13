# Índice de evidências

Referências abaixo apontam para os arquivos examinados. Os números são linhas atuais da árvore observada e podem mudar conforme novas alterações locais sejam feitas.

## Organização e ambientes

| Tema | Evidências |
| --- | --- |
| Monorepo e runtimes | `README.md:1-27`; `MONOREPO.md:5-45`; `orbit.workspace.json` |
| Arquitetura/portas | `README-ARCHITECTURE.md:10-21,54-89`; `compose.yml:4-48,50-130,132-197`; `safdoulas/compose.yml:1-104`; `suinda/compose.yml:1-95` |
| Configuração CONTROL | `control/environments.json`; `control/bin/orbit-env.py:14-43`; `control/Dockerfile:1-6` |
| Git legado Safdoulas | `safdoulas/compose.yml:1,7,13,34-35,88-89`; `MONOREPO.md:16-20` |
| Aceleração e compartilhamento | `docs/acceleration/README.md:9-45,63-96`; `orbit.workspace.json`; `tools/orbit/cli.mjs`; `scripts/verify-plugin-compatibility.mjs` |

## Quadros, cartões e persistência

| Tema | Evidências |
| --- | --- |
| Entidades fundamentais | `dev/app/apps/api/sql/schema.sql:2-114` |
| Associações de cartão | `schema.sql:143-258` |
| Feed de atividade | `schema.sql:259-286`; `dev/app/apps/api/src/features.ts:214` |
| CRUD/fluxos | `dev/app/apps/api/src/main.ts:668-682,736-824,838-980` |
| Workspaces | `dev/app/apps/api/src/workspaces/workspaces.plugin.ts:17-20`; migrations 068 e 069 |
| Execução por cartão | `sql/migrations/001_executable_cards.sql:1-49`; `src/execution/execution.controller.ts:7-15`; `execution.service.ts:53-149` |
| Runs de prompt Codex | `sql/schema.sql:408-462`; `src/plugins/ai/prompt-sessions.ts:37,378,413-482` |
| Revisão de records de plugins | `sql/migrations/118_extension_records.sql:1-70` |
| Auditoria imutável | `sql/migrations/119_immutable_audit_history.sql`; `src/plugins/records/audit.ts:41` |

## Agentes, Codex e contexto

| Tema | Evidências |
| --- | --- |
| Contrato de execução | `src/execution/types.ts`; `src/execution/config.ts`; `src/execution/execution.controller.ts:7-15` |
| Registro de executores/plugins | `src/execution/registries.ts:7-162` |
| Projeto e documentos agent/skill | `src/execution/project-registry.ts:26-107` |
| Contexto/limites | `src/execution/context-builder.ts:11-51`; `src/execution/security.ts` |
| Codex CLI de execução | `src/execution/codex-executor.ts:10-43` |
| Provedor Codex de prompt | `src/plugins/ai/codex-provider.ts:120-130,172-184,236-239` |
| Multi-agent | `src/plugins/ai/prompt-sessions.ts:37,413-416,467-482`; `src/plugins/ai/codex-provider.ts:120-128`; migration de campo no schema 435 |
| Prompt arquitetural | `src/orbit-architecture.ts:1-48` |
| BM25 para desenvolvimento | `tools/orbit/knowledge.mjs:176-235`; `docs/acceleration/knowledge.md:8-14` |
| Vetores/RAG | `src/plugins/ai/knowledge-retrieval.ts:25-90`; `src/plugins/ai/embeddings.ts`; `sql/migrations/144_orbit_knowledge_embeddings.sql:1-12` |

## Plugins, conectores e entrega

| Tema | Evidências |
| --- | --- |
| Contrato de plugin | `src/plugins/contract.ts:203-248` |
| Descoberta, dependências e activation | `src/execution/registries.ts:21-162`; `src/plugins/sdk.ts` |
| Conectores | `src/github/`, `src/git/`, `src/google/`, `src/calendar/`, `src/mail/`, `src/dropbox/`, `src/alexa-orbit/` |
| Webhooks | `src/plugins/webhooks.ts`; migration `146_orbit_webhooks.sql` |
| Entrega | `src/delivery/`; `prod/app/docs/delivery-pipelines/README.md`; `prod/app/docs/delivery-release-and-rollback.md:20-22` |
| Testes do contract/registry | `src/plugins/contract.spec.ts`, `core-compatibility.spec.ts`, `sdk.spec.ts`; `src/execution/execution.integration.spec.ts` |

## Interface e simulação de perfil

| Tema | Evidências |
| --- | --- |
| Home e quadro DEV | `dev/app/apps/web/app/page.tsx`; `app/board/[id]/page.tsx`; `components/card-dialog.tsx` |
| Plugin navigation/UI | `dev/app/apps/web/app/plugins/page.tsx`; `lib/plugin-navigation.ts`; `components/plugin-navigation.tsx` |
| Perfil simulado e contexto de demonstração | `dev/app/apps/api/src/access/profile-simulation-context.ts:15`; `access/access.ts:82-139` |
| Testes de acesso e navegação | `src/access/access.spec.ts`; `src/access/profile-simulation-context.spec.ts`; `apps/web/lib/plugin-navigation.spec.ts` |

## Testes e limites

Arquivos de teste foram identificados pelo nome junto aos módulos. Nenhum teste foi executado; nenhum endpoint ou runtime foi exercitado. Valores de segredos e conteúdo de arquivos sensíveis não foram lidos. Consulte `00-RESUMO-EXECUTIVO.md` para o escopo e as limitações completas.
