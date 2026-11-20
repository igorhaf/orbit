# Inventário de funcionalidades

**Base principal:** código DEV (`forge/app`), considerado ponto de integração segundo `docs/product-experience.md`. Quando um achado se refere a outro runtime ou configuração, isso está indicado. “Testes existentes” significa que há arquivos de teste relacionados; eles não foram executados.

| ID | Funcionalidade / objetivo | Estado | Evidência, dependências e persistência | Testes/evidência de funcionamento e limites |
| --- | --- | --- | --- | --- |
| F01 | Monorepo com runtimes DEV, PROD, Safdoulas e Suindá | IMPLEMENTADA | `README.md:7-20`, `orbit.workspace.json`; diretórios, perfis e configuração por ambiente | Estrutura local confirmada; não prova execução de cada serviço |
| F02 | Administração CONTROL de todos os produtos | PARCIAL | `control/environments.json`; `control/bin/orbit-env.py:14-16,41-43` cobre dev/prod | Safdoulas/Suindá não aparecem no helper analisado; Compose não foi executado |
| F03 | Workspaces, membros e compartilhamento de recursos | IMPLEMENTADA | `forge/app/apps/api/src/workspaces/workspaces.plugin.ts`; `schema.sql:53`, migration 068/069 | Testes de workspaces existem; compartilhamento de cartões entre workspaces não localizado |
| F04 | Quadros, listas e cartões com associações | IMPLEMENTADA | `schema.sql:59-114,143-258`; `main.ts` e páginas `apps/web/app/` | UI e rotas presentes; inclui assignees, labels, comentários, checklists, anexos e watchers |
| F05 | Criar, editar, mover, arquivar, restaurar e excluir cartões | IMPLEMENTADA | `main.ts:668-682,736-824,838-980` | Exclusão definitiva exige arquivamento; edição altera registro existente |
| F06 | Versionamento restaurável do conteúdo integral de cartões | NÃO LOCALIZADA | Schema de `cards` sem tabela geral de revisões; alterações e atividades estão em `main.ts:881-963` e `schema.sql:259` | Feed de atividades não equivale a snapshots restauráveis |
| F07 | Grafo de dependências bloqueantes entre cartões | NÃO LOCALIZADA | Relações encontradas incluem parent/merge/link, mas busca não localizou `depends-on` no modelo de cartão | A tabela `card_runs.chain` é para execução, não evidência de dependência entre cards |
| F08 | Configuração de execução por cartão | IMPLEMENTADA | `execution.controller.ts:7-15`; `execution.service.ts:53-80`; migration 001 | Config persistida em `card_execution_configs`; pode selecionar projeto, agente, executor, action, skills, permissões e contexto |
| F09 | Execução de actions de plugins e filesystem | IMPLEMENTADA | `execution/registries.ts:145-160`; `execution.service.ts:22-34` | Contratos JSON Schema e permissões; ações executadas pelo host API |
| F10 | Prompt assistido Codex no cartão com histórico | IMPLEMENTADA | `plugins/ai/prompt-sessions.ts:378,413-482`; `schema.sql:408-462` | `card_ai_runs` guarda prompt, estado, sessão, resultado e alterações; histórico limita a 20 itens |
| F11 | Invocação de Codex CLI para executar código | IMPLEMENTADA | `execution/codex-executor.ts:10-43`; `plugins/ai/codex-provider.ts:120-130` | Usa processo local, limites de contexto, sinalização de cancelamento e saída capturada; não é SDK remoto |
| F12 | Agentes e skills como recursos de projeto | IMPLEMENTADA | `execution/project-registry.ts:26-107`; recursos `.orbit/agents`, `skills`, `rules`, `knowledge` e `plugins` | Conteúdo Markdown/YAML validado e hasheado; dependência de filesystem e arquivos do projeto |
| F13 | Cadastro e gerenciamento de agentes como entidades independentes | PARCIAL | `AgentRegistry` resolve documentos do projeto (`project-registry.ts:106`); configuração vive em `orbit.yaml` | Não foi localizado CRUD/tabela de agentes ou ciclo de vida individual no banco |
| F14 | Checkbox “Múltiplos agentes” integrado à execução | PARCIAL | `prompt-sessions.ts:37,413-416,482`; migração do campo em `schema.sql:435` | Salva preferência e acrescenta instrução/flag nativa do Codex; não confirma que subagentes foram usados |
| F15 | Supervisão, filhos, comunicação e resultados por agente | NÃO LOCALIZADA | Nenhuma tabela/entidade/rota de child-agent identificada | Falta rastreio próprio do Orbit de alocação, mensagens, custos e resultados individuais |
| F16 | Filas persistidas e reivindicação de trabalho | IMPLEMENTADA | `card_runs`, `card_run_logs` em migration 001; `RunRepository.enqueue`; claim com lock no código de execução | Idempotência por chave e `FOR UPDATE SKIP LOCKED`; worker examinado é local ao processo |
| F17 | Prioridade programável, calendário e dependências de fila | PARCIAL | Jobs são selecionados por criação e há filas/automação em vários módulos | Não localizei scheduler genérico que priorize dependências do usuário ou DAG entre cards |
| F18 | Concorrência e execução horizontal garantida | PARCIAL | Worker periódico em `execution.service.ts`; locking PostgreSQL | Há proteção contra dupla reivindicação, mas a capacidade e política multi-processo não foram homologadas |
| F19 | Retry automático e política por erro | PARCIAL | Execução pode ser enfileirada novamente pelo usuário; recovery de stale existe | Retry com backoff/política por tipo não localizado; efeitos externos podem impedir repetição segura |
| F20 | Cancelamento de execução | PARCIAL | `execution.service.ts:94-141`; `POST execution/runs/:id/cancel` | Cancelamento de execução isolada existe; prompt AI aceita cancelamento queued/waiting_answer, não foi localizado cancelamento de prompt running |
| F21 | Recuperação de execuções interrompidas | IMPLEMENTADA | `execution.service.ts:143-149`; prompt worker/maintenance em `prompt-sessions.ts:51-94` | Runs stale são marcados como falha/erro; não há retry automático comprovado |
| F22 | Continuidade de sessão Codex | IMPLEMENTADA | `card_ai_runs.codex_session_id`, migration 013; `codex-provider.ts:172-184,236-239` | Sessão pode ser retomada e fallback cria sessão nova se a anterior não puder ser retomada; não é memória sem limite |
| F23 | Construção e restrição do contexto do agente | IMPLEMENTADA | `execution/context-builder.ts:11-51`, `project-registry.ts`, `execution/security.ts` | Inclui instruções, skills, recursos e contexto selecionado; verifica permissões, paths, segredos e limites |
| F24 | Recuperação semântica de conhecimento na aplicação | PARCIAL | `plugins/ai/knowledge-retrieval.ts`; `embeddings.ts`; migration 144 | Serviço e armazenamento de vetores existem, escopados por workspace/plugin/coleção; consumidores host passam candidatos; integração como contexto geral de toda execução não foi localizada |
| F25 | Indexação lexical para ferramenta local de desenvolvimento | IMPLEMENTADA | `tools/orbit/knowledge.mjs:176-235`; `docs/acceleration/knowledge.md:8-14` | BM25 local com hashes, linhas e indicação stale; é separado do RAG vetorial da aplicação |
| F26 | Plugins com contratos, dependências, capabilities e contributions | IMPLEMENTADA | `plugins/contract.ts:203-248`; `execution/registries.ts:21-162` | Há testes do registry/SDK; testes não provam compatibilidade de todas as combinações de produção |
| F27 | Conectores externos (GitHub, Google, Microsoft, Dropbox, e-mail etc.) | PARCIAL | Plugins/adapters em `src/github`, `git`, `google`, `calendar`, `mail`, `dropbox` | Código e testes localizados; credenciais, webhooks e serviços externos não foram testados nesta inspeção |
| F28 | Git associado a projetos e cartões | PARCIAL | `src/git/`, migrations 040 e tabelas `git_card_commits`, `git_pipeline_runs` | Há operações/integrações no código; estado de branches e remotes persistido em cada banco não foi inspecionado |
| F29 | Pipelines de entrega/deploy e rollback | PARCIAL | `src/delivery/`; `docs/delivery-pipelines/README.md` | Guia registra etapas/runs/approvals, mas docs de release dizem que provedores foram mockados e produção não exercitada |
| F30 | Simular perfil ROOT com contexto de produto | SIMULADA | `access/profile-simulation-context.ts`; `access.ts:82-139` | Perfil e permissões efetivas são simulados; exemplos são fictícios e rotas de domínio ficam bloqueadas durante a simulação |
| F31 | Auditoria imutável de ações de acesso | IMPLEMENTADA | Migration 119; `plugins/records/audit.ts:41` | Eventos com encadeamento/hash e verificação; não equivale ao registro universal de toda alteração de card |
| F32 | Observabilidade, alertas e filas | IMPLEMENTADA | `src/monitoring.ts`, `queues`, `main.ts` endpoints `codex/queues`, `monitoring` | Mecanismos de UI/API e testes existem; não verifiquei métricas ou alarmes em operação |
| F33 | Compatibilidade comprovada de todas as versões de plugin em todos os runtimes | NÃO VERIFICÁVEL | `scripts/verify-plugin-compatibility.mjs`, locks compartilhados e testes por runtime | Verificação de código/config existe; não executei o verificador nem toda combinação/runtime |
| F34 | Saúde e execução atual dos serviços por ambiente | NÃO VERIFICÁVEL | Compose, configuração e endpoint `/health` estão no código/configuração | Não consultei endpoints, processos, containers ou logs nesta auditoria |

## Contagem por classificação

| Classificação | Quantidade |
| --- | ---: |
| IMPLEMENTADA | 17 |
| PARCIAL | 11 |
| SIMULADA | 1 |
| NÃO LOCALIZADA | 3 |
| NÃO VERIFICÁVEL | 2 |
| PLANEJADA | 0 identificadas nesta amostra |
| LEGADA | 0 identificadas nesta amostra |

“0 identificadas” não afirma que não haja planos ou legado; significa que nenhuma linha do inventário foi classificada exclusivamente nessas categorias. Contradições documentais e restos históricos operacionais estão no relatório 07.
