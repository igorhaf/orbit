# Resumo executivo — sondagem do Orbit

**Data da inspeção:** 2026-11-13  
**Escopo observado:** repositório `/home/meada/projetos/orbit`, com ênfase no runtime DEV e comparação estrutural com PROD, Safdoulas, Suindá e CONTROL.  
**Natureza:** leitura estática de código, migrations, testes e documentação. Nenhum serviço, teste, migração, banco ou deploy foi executado.

## Panorama

O Orbit é uma aplicação web/API com quadros e cartões, workspaces, permissões, plugins e dois caminhos distintos de trabalho com IA: execuções configuradas por cartão e sessões de prompt Codex. A persistência principal usa PostgreSQL. O repositório também inclui runtimes de produto separados e ferramentas locais de catálogo, geração, verificação, recuperação de contexto e entrega.

Há capacidade operacional real em várias partes: plugins têm contratos e registro de dependências; cartões podem iniciar execuções persistidas; um worker busca tarefas no banco; contexto de projeto é montado a partir de arquivos `.orbit`; e Codex é invocado como processo local. Isso não constitui, por si só, um orquestrador de agentes de primeira classe. Agentes e skills são principalmente documentos do projeto; a opção “Múltiplos agentes” instrui o Codex a habilitar seu suporte nativo, sem que o Orbit registre cada agente-filho, sua alocação ou comunicação.

O repositório consolidado é recente e contém cópias de aplicação que ainda podem divergir. Os pacotes compartilhados cobrem um subconjunto declarado de arquivos. A documentação e configurações contêm inconsistências observáveis, incluindo o alcance do CONTROL, portas publicadas e a afirmação de que Suindá teria repositório Git dedicado.

## Inventário resumido

O inventário detalhado contém **34 áreas**: **17 IMPLEMENTADAS**, **11 PARCIAIS**, **3 NÃO LOCALIZADAS**, **1 SIMULADA** e **2 NÃO VERIFICÁVEIS**. Esses rótulos descrevem a evidência encontrada no código e configuração; não equivalem a uma homologação funcional.

Os principais limites observados para uma futura evolução de orquestração são: ausência localizada de versão restaurável de cartões e grafo de dependências; ausência de identidade/execução de agentes-filhos controlada pelo Orbit; concorrência e recuperação dependentes do processo/worker atual; e falta de confirmação operacional de serviços, provedores externos e compatibilidade total entre combinações de plugins.

## Principais componentes

- API NestJS e PostgreSQL: `forge/app/apps/api/src/main.ts`, `sql/schema.sql`, `sql/migrations/`.
- Interface Next.js: `forge/app/apps/web/app/` e `components/`.
- Execução por cartão e Codex: `forge/app/apps/api/src/execution/`.
- Sessões de prompt Codex: `forge/app/apps/api/src/plugins/ai/`.
- Plugins e contratos: `forge/app/apps/api/src/plugins/contract.ts`, `execution/registries.ts`.
- Runtimes e operação: `dev/`, `prod/`, `safdoulas/`, `suinda/`, `control/`.
- Ferramentas de aceleração: `tools/orbit/`, `packages/`, `orbit.workspace.json`.

## Limites e cautelas

- A árvore de trabalho estava modificada e continha arquivos não rastreados. As conclusões representam o código local observado, não apenas um commit limpo ou uma versão publicada.
- Não foram lidos valores de segredos, arquivos de banco de dados, backups ou conteúdo de diretórios de dependências/build/cache.
- Não foi confirmada a saúde atual de serviços, a configuração real persistida em bancos, o sucesso de chamadas externas, nem a configuração Git armazenada nos projetos do banco.
- Testes foram localizados, mas não executados. Sua existência é evidência de cobertura implementada, não de aprovação atual.
- `IMPLEMENTADA` indica mecanismo identificável no código/configuração. `NÃO VERIFICÁVEL` indica que a fonte necessária não foi examinada ou que execução externa seria necessária. Ausência em busca delimitada não prova inexistência definitiva.

## Referências principais

- Organização declarada: `README.md:1-27`, `MONOREPO.md:5-45`, `orbit.workspace.json`.
- Núcleo de dados: `forge/app/apps/api/sql/schema.sql:2-114`.
- Execução persistida: `forge/app/apps/api/sql/migrations/001_executable_cards.sql:1-49`.
- Codex e execução: `forge/app/apps/api/src/execution/execution.service.ts`, `codex-executor.ts`, `plugins/ai/prompt-sessions.ts`.
- Contrato de plugins: `forge/app/apps/api/src/plugins/contract.ts:203-248`.
- Contexto local de desenvolvimento: `docs/acceleration/README.md`, `tools/orbit/knowledge.mjs`.
