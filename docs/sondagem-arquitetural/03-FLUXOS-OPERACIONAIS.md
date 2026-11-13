# Fluxos operacionais encontrados

## Criação e edição de cartões

1. O usuário interage com Home, lista/quadro ou formulário de cartão no Next.js (`dev/app/apps/web/app/page.tsx`, `app/board/[id]/page.tsx`, `components/card-dialog.tsx`).
2. A interface chama rotas HTTP da API com sessão/token em `apps/web/lib/api.ts`.
3. `ApiController` em `apps/api/src/main.ts` valida usuário, permissões e parâmetros e persiste dados relacionais.
4. Cartões são relacionados a lista e quadro; atividades registram ações. Edição atualiza a linha do cartão em lugar; não foi localizado snapshot geral de revisão.
5. Operações de quadro incluem mover/copiar/mesclar, arquivamento/restauração e exclusão condicionada ao estado arquivado (`main.ts:668-682,736-824,965-980`).

Dados principais: `boards`, `lists`, `cards`, `activities`, `comments`, `checklists`, `attachments`, `card_assignees`, `labels` (`sql/schema.sql:59-258`).

## Prompt Codex a partir do cartão

1. A interface envia instrução, modelo, esforço, origem, opção `multiple_agents` e metadados de contexto.
2. `PromptSessionsService.execute` valida o corpo, verifica acesso ao cartão/projeto, aplica defaults e grava uma linha `card_ai_runs` em estado `queued` (`plugins/ai/prompt-sessions.ts:413-482`).
3. Um worker consulta jobs e adquire locks no banco. Comentários e execução principal têm coordenação para evitar corrida no mesmo cartão (`prompt-sessions.ts:62-79,297-345`).
4. O prompt é montado com instrução Orbit, checklist, comentários/referências, arquivos selecionados, skills, write scope e checagens do projeto (`prompt-sessions.ts:426-468`).
5. `codex-provider.ts` chama Codex CLI, fornece modelo/esforço, modo de saída e opção nativa multi-agent. O identificador da sessão Codex é persistido para retomada (`codex-provider.ts:120-130,172-184`).
6. Saída, resumo, alterações de arquivo, estado, erro e timestamps ficam no histórico de runs. Reexecução é iniciada pelo usuário; recovery de sessão ausente pode iniciar uma sessão nova.

O fluxo habilita apoio nativo de subagentes no Codex, mas a inspeção não encontrou registros Orbit para cada agente-filho ou protocolo de comunicação independente.

## Execução configurada por cartão

1. Root/usuário autorizador configura projeto, agente, executor, action, skills, permissões, working directory, contexto e integrações (`execution.controller.ts:9-12`; `execution.service.ts:53-80`).
2. A API carrega o projeto do filesystem, valida recursos `.orbit`, skills, permissões, integração e action (`project-registry.ts`, `context-builder.ts`, `execution.service.ts:53-92`).
3. Ao solicitar run, a API cria linha em `card_runs` com snapshot dos campos de entrada e `request_key` idempotente (`run-repository.ts:10-18`, migration 001).
4. Worker periódico reclama uma execução, lança Codex CLI ou plugin action e grava logs/outputs. `FOR UPDATE SKIP LOCKED` evita que workers processem a mesma linha simultaneamente.
5. Cancelamento de queued marca estado terminal; cancelamento de running registra solicitação e aborta processo. Execuções stale são marcadas como failed, sem retry automático localizado.

Este caminho de “execução de action” é distinto do fluxo de prompt AI, embora ambos usem Codex em algumas ações e tenham coordenação por cartão.

## Criação e resolução de projeto/agente

Projetos de IA são cadastrados em `ai_projects` com caminho local e proprietário (`sql/schema.sql:408`). O `ProjectRegistry` valida que o caminho existe, evita raiz do filesystem, lê `.orbit/orbit.yaml`, descobre arquivos YAML/Markdown em diretórios `agents`, `skills`, `rules`, `knowledge`, `plugins`, confere referências e calcula hash dos documentos (`execution/project-registry.ts:27-105`). `AgentRegistry` e `SkillRegistry` são resolvers de documentos, não repositórios de agentes no banco (`project-registry.ts:106-107`).

## Git, validação e entrega

Há integrações Git no módulo `src/git/` e dados associados a repositórios, commits de cartões e pipelines. O plugin de entrega permite configurar alvos/etapas/runs/approvals. Contudo, documentação de release do PROD registra mocks para alguns provedores e não exercita fluxo de produção. A existência de scripts, tabelas ou telas não confirma execução operacional. Nenhum comando Git de escrita, pipeline, deploy ou promoção foi acionado nesta sondagem.

## Filas, retomada e falhas

`card_runs` e `card_ai_runs` são filas persistidas em bancos separados por runtime. Há heartbeats, timestamps e workers; execução stale é sinalizada como falha/erro. Mecanismos de retry automático com backoff não foram encontrados. A operação mais próxima de retomada é a continuação da sessão Codex do cartão ou o reenvio manual pelo usuário.

## Integrações externas

Plugins oferecem conectores e adapters para provedores. A API guarda conexões/credenciais em tabelas protegidas e possui OAuth/webhook handling. A investigação não leu valores locais de configuração nem acessou contas externas; autorização, escopos, limites de quota, callbacks e resultados reais permanecem não verificados.
