# ORBIT - Relatorio Completo do Sistema
## Inventario Detalhado de Funcionalidades, Regras de Negocio e Arquitetura

**Data:** 14 de Fevereiro de 2026
**Versao:** 2.1
**Status:** Em evolucao ativa
**PROMPTs implementados:** 278 (250 reports documentados)

---

## 1. VISAO GERAL

O ORBIT e um sistema de orquestracao de IA para gestao de projetos de software. Ele analisa codebases existentes, extrai regras de negocio automaticamente, gera backlogs hierarquicos (Epics, Stories, Tasks, Subtasks) usando inteligencia artificial, e permite acompanhar todo o ciclo de vida de desenvolvimento.

### Numeros do Projeto

| Metrica | Valor |
|---------|-------|
| Linhas de codigo Python (backend) | 69.187 |
| Linhas de codigo TypeScript (frontend) | 41.800 |
| Arquivos Python | 173 |
| Arquivos TypeScript/TSX | 133 |
| Prompts YAML externalizados | 64 |
| Contratos YAML de governanca | 70 |
| Reports de implementacao (PROMPT_*.md) | 250 |
| Modelos de IA configurados | 18 |
| AI Flow Chains ativas | 8 |
| Tabelas no banco de dados | 24 |
| Endpoints de API | 120+ |

### Stack Tecnologica

| Camada | Tecnologia |
|--------|-----------|
| Backend | FastAPI + SQLAlchemy + Alembic |
| Frontend | Next.js 14 (App Router) + React + TypeScript + Tailwind CSS |
| Banco de Dados | PostgreSQL 16 com pgvector |
| Cache | Redis (multi-level L1/L2/L3) |
| Busca Semantica | pgvector (384 dimensoes, all-MiniLM-L6-v2) |
| Modelos Locais | Ollama (Gemma3 12B, Qwen3 14B, DeepSeek-R1 14B, Phi-4 14B, Codestral 22B) |
| Modelos Cloud | Anthropic (Claude), OpenAI (GPT), Google (Gemini) |
| Containerizacao | Docker Compose (7 servicos) |

### Servicos Docker

| Servico | Imagem | Porta | Funcao |
|---------|--------|-------|--------|
| postgres | pgvector/pgvector:pg16 | 5432 | Banco principal + busca vetorial |
| backend | Custom (FastAPI) | 8000 | API REST + servicos de IA |
| frontend | Custom (Next.js) | 3000 | Interface web |
| redis | redis:alpine | 6379 | Cache L1/L2/L3 + fila de jobs |
| ollama | ollama/ollama | 11434 | Modelos locais de IA |
| qdrant | qdrant/qdrant | 6333 | Banco vetorial auxiliar |

---

## 2. MODELOS DE DADOS (24 Tabelas)

### 2.1. Project (Projeto)

Entidade central. Representa um projeto de software vinculado a uma pasta de codigo.

| Campo | Tipo | Descricao |
|-------|------|-----------|
| id | UUID (PK) | Identificador unico |
| name | String | Nome do projeto (sugerido por IA ou manual) |
| description | Text | Descricao do projeto (gerada por IA, validada) |
| code_path | String (NOT NULL, imutavel) | Caminho absoluto da pasta de codigo |
| project_folder | String | Nome da pasta |
| status | Enum (draft/processing/active) | Estado do ciclo de vida |
| context_semantic | Text | Contexto semantico (para IA) |
| context_human | Text | Contexto legivel (para humanos) |
| context_locked | Boolean | Contexto travado apos primeira ativacao de Epic |
| context_locked_at | DateTime | Quando o contexto foi travado |
| initial_memory_context | JSON | Resultado do memory scan inicial |
| initial_scan_complete | Boolean | Se o scan inicial foi concluido |
| scan_depth | String | Profundidade do scan (quick/normal/deep) |
| custom_ignore_patterns | JSON | Padroes de arquivo a ignorar |
| stack_backend | String | Framework backend detectado |
| stack_database | String | Banco de dados detectado |
| stack_frontend | String | Framework frontend detectado |
| stack_css | String | Framework CSS detectado |
| stack_mobile | String | Framework mobile detectado |
| git_repository_info | JSON | Informacoes do repositorio git |
| created_at | DateTime | Data de criacao |
| updated_at | DateTime | Ultima atualizacao |

**Regras de negocio:**
- `code_path` e OBRIGATORIO e IMUTAVEL apos criacao (PROMPT #111)
- `context_locked` so pode ser setado para `true`, nunca voltar a `false`
- Quando `context_locked=true`, `context_semantic` e `context_human` nao podem ser alterados
- `status` segue o fluxo: draft -> processing -> active
- Projeto em `processing` nao pode ser editado pelo usuario
- Deletar um projeto deleta em cascata: tasks, interviews, prompts, wiki_pages, commits

### 2.2. Task (Card de Backlog)

Representa qualquer item do backlog: Epic, Story, Task, Subtask ou Bug. Segue o modelo JIRA.

| Campo | Tipo | Descricao |
|-------|------|-----------|
| id | UUID (PK) | Identificador unico |
| project_id | UUID (FK -> projects) | Projeto pai |
| parent_id | UUID (FK -> tasks, self-ref) | Card pai na hierarquia |
| item_type | Enum | Tipo: epic, story, task, subtask, bug |
| title | String | Titulo do card |
| description | Text | Descricao completa (Markdown) |
| generated_prompt | Text | Prompt semantico gerado (para IA gerar filhos) |
| status | Enum | Status kanban: backlog, todo, in_progress, review, done, blocked |
| workflow_state | String | Estado do workflow (draft, open, closed, etc.) |
| priority | Enum | Prioridade: critical, high, medium, low, trivial |
| severity | Enum | Severidade: blocker, critical, major, minor, trivial |
| story_points | Integer | Pontos de esforco estimado |
| labels | JSONB | Etiquetas (ex: ["suggested"]) |
| components | JSON | Componentes do sistema afetados |
| acceptance_criteria | JSON | Lista de criterios de aceitacao (strings) |
| reporter | String | Quem reportou (user, ai, watchdog) |
| assignee | String | Responsavel |
| sprint_id | UUID | Sprint associado |
| resolution | Enum | Resolucao: fixed, wont_fix, duplicate, etc. |
| resolution_comment | Text | Comentario da resolucao |
| status_history | JSON | Historico de mudancas de status |
| depends_on | JSON | Dependencias |
| blocked_reason | String | Motivo do bloqueio |
| pending_modification | JSON | Modificacao pendente de aprovacao |
| created_from_interview_id | UUID (FK) | Entrevista que originou o card |
| interview_question_ids | JSON | IDs das perguntas da entrevista |
| interview_insights | JSON | Insights extraidos da entrevista |
| subtask_suggestions | JSON | Sugestoes de subtasks pela IA |
| prompt_id | UUID (FK) | Prompt associado |
| prompt_template_id | UUID (FK) | Template de prompt |
| target_ai_model_id | UUID (FK) | Modelo de IA alvo |
| generation_context | JSON | Contexto usado na geracao |
| token_budget | Integer | Orcamento de tokens |
| actual_tokens_used | Integer | Tokens efetivamente usados |
| created_by_ai_model | String | Modelo que criou o card |
| type | String | Tipo legado (feature, bug, etc.) |
| entity | String | Entidade do dominio |
| file_path | String | Arquivo associado |
| complexity | Integer | Complexidade estimada |
| column | String | Coluna kanban legada |
| order | Integer | Ordem de exibicao |
| comments | JSON | Comentarios legados |
| created_at | DateTime | Data de criacao |
| updated_at | DateTime | Ultima atualizacao |

**Regras de negocio da hierarquia:**
- Epic -> 15-20 Stories (ao ativar)
- Story -> 5-8 Tasks (ao ativar)
- Task -> 3-5 Subtasks (ao ativar)
- Cards com `labels=["suggested"]` e `workflow_state="draft"` sao sugestoes da IA
- Ao ativar um card sugerido: remove label "suggested", muda workflow_state para "open", gera filhos
- Cards sugeridos NAO podem gerar filhos diretamente
- A primeira ativacao de Epic trava o contexto do projeto
- `generated_prompt` contem o texto semantico (com identificadores N1, P1, etc.)
- `description` contem o texto legivel para humanos

**Maquina de estados por tipo:**

| Tipo | Estados validos |
|------|----------------|
| Epic | backlog -> planning -> in_progress -> review -> done |
| Story | backlog -> ready -> in_progress -> review -> validation -> done |
| Task | backlog -> todo -> in_progress -> code_review -> testing -> done |
| Bug | new -> confirmed -> in_progress -> fixed -> verified -> closed |
| Subtask | todo -> in_progress -> done |

### 2.3. Interview (Entrevista)

Sessao de entrevista com IA para coleta de requisitos.

| Campo | Tipo | Descricao |
|-------|------|-----------|
| id | UUID (PK) | Identificador unico |
| project_id | UUID (FK -> projects) | Projeto associado |
| parent_task_id | UUID (FK -> tasks) | Task pai (para entrevistas focadas em card) |
| conversation_data | JSON | Historico completo da conversa |
| ai_model_used | String | Modelo de IA usado |
| status | Enum | Status: active, completed, cancelled |
| interview_mode | String | Modo: requirements, task_focused |
| task_type_selection | String | Tipo de task: bug, feature, refactor, enhancement |
| focus_topics | JSON | Topicos de foco |
| motivation_type | String | Tipo de motivacao |
| created_at | DateTime | Data de criacao |

**Regras de negocio:**
- Entrevista de contexto: minimo 3 perguntas fixas (Q1-Q3), sem limite maximo
- Entrevista de contexto: usuario decide quando terminar clicando "Gerar Contexto"
- Entrevista focada em card: perguntas especializadas por tipo (bug, feature, etc.)
- Perguntas sao fechadas com 5-8 opcoes de resposta
- Deletar uma task deleta em cascata suas entrevistas

### 2.4. AIModel (Modelo de IA)

Configuracao de modelos de IA disponiveis no sistema.

| Campo | Tipo | Descricao |
|-------|------|-----------|
| id | UUID (PK) | Identificador unico |
| name | String (unique) | Nome do modelo |
| provider | String | Provider: anthropic, openai, google, ollama |
| api_key | String | Chave de API (armazenada no banco, NAO no .env) |
| usage_type | Enum | Tipo de uso principal |
| is_active | Boolean | Se esta ativo |
| config | JSON | Configuracoes (temperature, max_tokens, top_p, top_k) |
| rate_limit_requests | Integer | Limite de requisicoes por janela |
| rate_limit_window_seconds | Integer | Janela de tempo do rate limit |
| timeout_seconds | Integer | Timeout para chamadas |
| max_concurrent_requests | Integer | Requisicoes simultaneas maximas |
| created_at | DateTime | Data de criacao |
| updated_at | DateTime | Ultima atualizacao |

**Regras de negocio:**
- API keys sao SEMPRE armazenadas no banco, NUNCA no .env
- Usuario configura via interface web em /ai-models
- 8 usage_types: interview, prompt_generation, commit_generation, task_execution, pattern_discovery, memory, queue_orchestration, general
- Qualquer provider pode ser configurado para qualquer usage_type
- Rate limiter registra uso ANTES da chamada para evitar estouro

**Modelos atualmente configurados (18 modelos):**

| Modelo | Provider | Status |
|--------|----------|--------|
| Gemma3 12B | ollama | Ativo |
| Qwen3 14B | ollama | Ativo |
| DeepSeek-R1 14B | ollama | Ativo |
| Phi-4 14B | ollama | Ativo |
| Codestral 22B | ollama | Ativo |
| DS-Coder-V2 16B | ollama | Ativo |
| Qwen2.5 32B | ollama | Ativo |
| Claude Haiku 3.5 | anthropic | Inativo |
| Claude Haiku 3.5 (Interview) | anthropic | Inativo |
| Claude Haiku 3.5 (General) | anthropic | Inativo |
| Claude Haiku 3.5 (Prompt Gen) | anthropic | Inativo |
| GPT-4o | openai | Inativo |
| GPT-4 Turbo | openai | Inativo |
| GPT-3.5 Turbo | openai | Inativo |
| Gemini 2.0 Flash | google | Inativo |
| Gemini 1.5 Pro | google | Inativo |
| Gemini 1.5 Flash | google | Inativo |
| Gemini 2.0 Flash (Pattern) | google | Inativo |

### 2.5. AIFlowChain (Cadeia de Fallback)

Configuracao de fallback por tipo de operacao. Se o primeiro modelo falha, tenta o segundo, depois o terceiro.

| Campo | Tipo | Descricao |
|-------|------|-----------|
| id | UUID (PK) | Identificador unico |
| usage_type | Enum (unique) | Tipo de operacao |
| chain | JSON (array de UUIDs) | Lista ordenada de modelos |
| node_positions | JSON | Posicoes dos nos no diagrama visual |
| utility_nodes | JSON | Nos utilitarios (Cache, RAG, Rate Limiter, etc.) |
| is_active | Boolean | Se esta ativa |
| created_at | DateTime | Data de criacao |
| updated_at | DateTime | Ultima atualizacao |

**Chains atuais (preset "Custo Minimo" - 100% Ollama local):**

| Operacao | Modelo 1 | Modelo 2 | Modelo 3 |
|----------|----------|----------|----------|
| interview | Gemma3 12B | Qwen3 14B | - |
| prompt_generation | Qwen3 14B | Gemma3 12B | - |
| task_execution | Qwen3 14B | Gemma3 12B | - |
| commit_generation | Gemma3 12B | Qwen3 14B | - |
| pattern_discovery | DeepSeek-R1 14B | Gemma3 12B | - |
| memory | Qwen3 14B | Gemma3 12B | DeepSeek-R1 14B |
| queue_orchestration | Qwen3 14B | Gemma3 12B | Phi-4 14B |
| general | Qwen3 14B | Gemma3 12B | DeepSeek-R1 14B |

**Regras de negocio:**
- Cada usage_type tem exatamente UMA chain ativa
- A chain e percorrida em ordem: se modelo 1 falha, tenta modelo 2, etc.
- Qwen3 e priorizado para operacoes que exigem output verboso e em portugues
- Gemma3 e priorizado para operacoes que exigem concisao (commits, interviews)
- DeepSeek-R1 e priorizado para raciocinio profundo (pattern discovery)

### 2.6. AIExecution (Log de Execucao de IA)

Registro de auditoria para cada chamada de IA.

| Campo | Tipo | Descricao |
|-------|------|-----------|
| id | UUID (PK) | Identificador unico |
| ai_model_id | UUID (FK) | Modelo usado |
| usage_type | String | Tipo de uso |
| input_messages | JSON | Mensagens de entrada |
| system_prompt | Text | System prompt |
| response_content | Text | Resposta da IA |
| input_tokens | Integer | Tokens de entrada |
| output_tokens | Integer | Tokens de saida |
| total_tokens | Integer | Tokens totais |
| provider | String | Provider usado |
| model_name | String | Nome do modelo |
| execution_time_ms | Integer | Tempo de execucao (ms) |
| chain_usage_type | String | Usage type da chain |
| chain_position | Integer | Posicao na chain (1, 2, 3) |
| chain_total | Integer | Total de modelos na chain |
| chain_fallback | Boolean | Se foi fallback |
| chain_source | String | Origem da chain |
| rag_enabled | Boolean | Se RAG estava ativo |
| rag_hit | Boolean | Se houve hit no RAG |
| rag_results_count | Integer | Quantidade de resultados RAG |
| rag_top_similarity | Float | Maior similaridade encontrada |
| error_message | Text | Mensagem de erro (se falhou) |
| created_at | DateTime | Data de execucao |

**Estatisticas atuais:**
- 243 execucoes registradas
- 100% via Ollama (modelos locais)
- 149.431 tokens de entrada, 88.837 tokens de saida
- 238.268 tokens totais consumidos

### 2.7. AsyncJob (Job Assincrono)

Jobs de background para operacoes demoradas.

| Campo | Tipo | Descricao |
|-------|------|-----------|
| id | UUID (PK) | Identificador unico |
| job_type | Enum | Tipo do job (21 tipos) |
| status | Enum | Status: pending, running, completed, failed, cancelled |
| priority | Integer | Prioridade numerica (3-10) |
| input_data | JSON | Dados de entrada |
| result | JSON | Resultado do job |
| error | Text | Erro (se falhou) |
| progress_percent | Float | Progresso (0-100%) |
| progress_message | String | Mensagem de progresso |
| project_id | UUID | Projeto associado |
| interview_id | UUID | Entrevista associada |
| task_id | UUID | Task associada |
| deep_link | String | Link para navegacao pos-conclusao |
| notification_title | String | Titulo da notificacao |
| created_at | DateTime | Criacao |
| started_at | DateTime | Inicio da execucao |
| completed_at | DateTime | Conclusao |

**21 tipos de job:**
1. `interview_message` - Processar mensagem de entrevista
2. `backlog_generation` - Gerar backlog de entrevista
3. `task_generation` - Gerar task
4. `project_provisioning` - Provisionar projeto (legado)
5. `epic_activation` - Ativar epic sugerido
6. `story_activation` - Ativar story sugerida
7. `task_activation` - Ativar task sugerida
8. `subtask_activation` - Ativar subtask sugerida
9. `task_execution` - Executar task (gerar codigo)
10. `batch_execution` - Execucao em lote
11. `commit_generation` - Gerar mensagem de commit
12. `interview_question` - Gerar pergunta de entrevista
13. `memory_scan` - Scan de memoria do codebase
14. `project_title` - Sugerir titulo do projeto
15. `context_generation` - Gerar contexto rico
16. `suggested_epics` - Gerar epics sugeridos
17. `cards_from_memory` - Gerar cards do scan de memoria
18. `children_generation` - Gerar filhos de um card
19. `project_pipeline` - Pipeline completo de criacao
20. `rag_continuous_scan` - Scan continuo do RAG
21. `wiki_rule_enrichment` - Enriquecimento de regras na wiki

**Prioridades:**
- CRITICAL (10): Mensagens de entrevista
- HIGH (7): Geracao de contexto, ativacao de epics
- NORMAL (5): Memory scan, commits, execucao
- LOW (3): Geracao em background, wiki enrichment

### 2.8. WikiPage (Pagina Wiki)

Documentacao estruturada do projeto, gerada automaticamente por IA.

| Campo | Tipo | Descricao |
|-------|------|-----------|
| id | UUID (PK) | Identificador unico |
| project_id | UUID (FK -> projects) | Projeto |
| slug | String | URL-friendly identifier |
| title | String | Titulo da pagina |
| content | Text | Conteudo (Markdown) |
| parent_id | UUID (FK -> wiki_pages, self-ref) | Pagina pai |
| order_index | Integer | Ordem de exibicao |
| source | String | Origem: ai_generated, user, enriched |
| created_at | DateTime | Data de criacao |
| updated_at | DateTime | Ultima atualizacao |

**Regras de negocio:**
- Paginas com `parent_id IS NULL` aparecem como itens raiz no sidebar
- Paginas `regra-*` DEVEM ter parent_id apontando para `regras-de-negocio`
- Se `regras-de-negocio` nao existe, e criada automaticamente como stub
- Wiki e gerada automaticamente durante o pipeline de criacao do projeto
- Secoes geradas: Visao Geral, Stack Tecnologica, Arquitetura, Features, Regras de Negocio, Integracoes
- Regras de negocio individuais recebem paginas proprias com conteudo enriquecido

### 2.9. Prompt (Registro de Prompt)

Registro de cada prompt executado pela IA.

| Campo | Tipo | Descricao |
|-------|------|-----------|
| id | UUID (PK) | Identificador unico |
| project_id | UUID (FK) | Projeto associado |
| created_from_interview_id | UUID (FK) | Entrevista de origem |
| parent_id | UUID (FK, self-ref) | Prompt pai (versionamento) |
| content | Text | Conteudo do prompt |
| type | String | Tipo do prompt |
| system_prompt | Text | System prompt usado |
| user_prompt | Text | User prompt usado |
| response | Text | Resposta da IA |
| input_tokens | Integer | Tokens de entrada |
| output_tokens | Integer | Tokens de saida |
| total_cost_usd | Float | Custo total em USD |
| execution_time_ms | Integer | Tempo de execucao |
| execution_metadata | JSON | Metadados da execucao |
| ai_model_used | String | Modelo usado |
| status | String | Status: pending, completed, failed |
| error_message | Text | Erro (se falhou) |
| is_reusable | Boolean | Se e reutilizavel |
| version | Integer | Versao |
| components | JSON | Componentes usados |

### 2.10. Spec (Especificacao de Framework)

Especificacoes de frameworks para reducao de tokens.

| Campo | Tipo | Descricao |
|-------|------|-----------|
| id | UUID (PK) | Identificador unico |
| category | String | Categoria (ex: laravel, nextjs) |
| name | String | Nome da spec |
| spec_type | String | Tipo da spec |
| title | String | Titulo |
| description | Text | Descricao |
| content | Text | Conteudo completo |
| language | String | Linguagem |
| framework_version | String | Versao do framework |
| scope | Enum | Escopo: framework (global) ou project (especifico) |
| is_active | Boolean | Se esta ativa |
| usage_count | Integer | Vezes que foi usada |
| version | Integer | Versao |
| project_id | UUID (FK, nullable) | Projeto (se scope=project) |
| discovery_metadata | JSON | Metadados de descoberta por IA |

**Regras de negocio:**
- Specs de escopo `framework` sao globais e reutilizaveis entre projetos
- Specs de escopo `project` sao especificas de um projeto
- Reducao de tokens: 60-80% na geracao de prompts, 15-20% adicional na execucao
- Reducao total: 70-85% de tokens economizados

### 2.11. Outras Tabelas

**PromptQueue** - Fila de execucao prioritaria por projeto
- Posicao, status, scores (prioridade, hierarquia, idade, dependencia)
- Manual override para reordenacao manual

**RAGFileState** - Estado de processamento por arquivo no RAG continuo
- file_path, file_hash, status (pending/processing/completed/failed/deleted)
- Rastreamento de regras extraidas por arquivo

**Commit** - Mensagens de commit geradas por IA
- Tipo (feat/fix/docs/refactor/test/chore/perf), mensagem, changes

**TaskResult** - Resultado de execucao de task (codigo gerado)
- output_code, validation_passed, validation_issues, attempts

**ChatSession** - Sessao de chat durante execucao de task

**ConsistencyIssue** - Inconsistencias detectadas no backlog
- Severidade (critical/warning/info), categoria, auto_fixable

**TaskRelationship** - Relacionamentos entre cards
- Tipos: blocks, blocked_by, depends_on, relates_to, duplicates, clones

**TaskComment** - Comentarios em cards (sistema JIRA-like)

**StatusTransition** - Historico de transicoes de status

**ProjectAnalysis** - Resultado de analise de arquivo/projeto uploadado

**SpecHistory** - Historico de versoes de specs

**SystemSettings** - Configuracoes globais do sistema (key-value)

**DiscoveryQueue** - Fila de descoberta de patterns

---

## 3. ENDPOINTS DE API (120+)

### 3.1. Projects (/api/v1/projects)

| Metodo | Path | Descricao |
|--------|------|-----------|
| GET | /browse-folders | Navegar pastas montadas em /projects |
| POST | / | Criar novo projeto com code_path |
| GET | / | Listar todos os projetos |
| GET | /{id} | Obter detalhes do projeto |
| PUT | /{id} | Atualizar projeto |
| DELETE | /{id} | Deletar projeto (cascata) |
| POST | /{id}/scan-memory | Disparar memory scan do codebase |
| POST | /{id}/context-interview | Iniciar entrevista de contexto |
| POST | /{id}/approve-context | Finalizar e travar contexto |

### 3.2. Tasks (/api/v1/tasks)

| Metodo | Path | Descricao |
|--------|------|-----------|
| GET | / | Listar tasks com filtros (project, status, type, priority) |
| POST | / | Criar task |
| GET | /{id} | Obter detalhes da task |
| PUT | /{id} | Atualizar task |
| DELETE | /{id} | Deletar task (cascata entrevistas) |
| POST | /{id}/activate | Ativar card sugerido (gera filhos) |
| POST | /{id}/approve | Aprovar modificacao pendente |
| POST | /{id}/reject | Rejeitar modificacao pendente |
| PATCH | /{id}/status | Atualizar status |
| PATCH | /{id}/description | Editar descricao inline |
| POST | /{id}/execute | Executar task (gerar codigo) |
| POST | /{id}/chat-session | Iniciar sessao de chat |

### 3.3. Interviews (/api/v1/interviews)

| Metodo | Path | Descricao |
|--------|------|-----------|
| POST | /start | Iniciar nova entrevista |
| POST | /{id}/message | Enviar mensagem na entrevista |
| GET | /{id} | Obter transcricao |
| DELETE | /{id} | Cancelar entrevista |
| GET | /{id}/questions | Obter pergunta atual |

### 3.4. AI Models (/api/v1/ai-models)

| Metodo | Path | Descricao |
|--------|------|-----------|
| GET | / | Listar modelos (com filtros) |
| POST | / | Criar modelo |
| GET | /{id} | Obter detalhes |
| PUT | /{id} | Atualizar modelo |
| DELETE | /{id} | Deletar modelo |
| PATCH | /{id}/toggle-active | Ativar/desativar |
| POST | /{id}/test | Testar API key |

### 3.5. AI Flow (/api/v1/ai-flow)

| Metodo | Path | Descricao |
|--------|------|-----------|
| GET | /chains | Listar todas as chains |
| GET | /chains/{usage_type} | Obter chain por tipo |
| PUT | /chains/{usage_type} | Criar/atualizar chain (upsert) |
| DELETE | /chains/{usage_type} | Deletar chain |
| GET | /chains/{usage_type}/metrics | Metricas dos modelos na chain |
| POST | /chains/{usage_type}/optimize | Reordenar chain com IA |
| GET | /chains/templates/list | Listar templates preset |
| POST | /chains/templates/apply | Aplicar template |
| GET | /analytics | Dashboard de analytics da chain |

### 3.6. Jobs (/api/v1/jobs)

| Metodo | Path | Descricao |
|--------|------|-----------|
| GET | / | Listar jobs com filtros e paginacao |
| GET | /stats | Estatisticas de jobs |
| GET | /active | Jobs ativos (pending/running) |
| GET | /{id} | Detalhes do job |
| PATCH | /{id}/cancel | Cancelar job |
| GET | /{id}/retry | Retentar job falho |
| POST | /cleanup-old | Limpar jobs antigos |

### 3.7. Backlog Generation (/api/v1/backlog-generation)

| Metodo | Path | Descricao |
|--------|------|-----------|
| POST | /interview/{id}/generate-epic | Gerar epic de entrevista |
| POST | /epic/{id}/generate-stories | Gerar stories de epic |
| POST | /story/{id}/generate-tasks | Gerar tasks de story |
| POST | /approve-epic | Aprovar e ativar epic |

### 3.8. Wiki (/api/v1/wiki)

| Metodo | Path | Descricao |
|--------|------|-----------|
| GET | / | Listar paginas |
| POST | / | Criar pagina |
| GET | /{slug} | Obter pagina por slug |
| PUT | /{slug} | Atualizar pagina |
| DELETE | /{slug} | Deletar pagina |
| GET | /{slug}/children | Obter sub-paginas |

### 3.9. Prompt Queue (/api/v1/prompt-queue)

| Metodo | Path | Descricao |
|--------|------|-----------|
| GET | / | Listar fila por projeto |
| PUT | /reorder | Reordenar fila (drag-and-drop) |
| POST | /execute-next | Executar proximo item |
| PATCH | /{id}/status | Atualizar status do item |

### 3.10. Outros Endpoints

| Grupo | Endpoints | Descricao |
|-------|-----------|-----------|
| AI Executions | 5 endpoints | Logs e metricas de execucoes de IA |
| Prompts | 6 endpoints | CRUD de prompts com versionamento |
| Specs | 7 endpoints | CRUD de specs com historico e rollback |
| Commits | 5 endpoints | Geracao e listagem de commits |
| Cost Analytics | 5 endpoints | Custos por provider, projeto, timeline |
| Cache Stats | 3 endpoints | Estatisticas de cache Redis |
| System Settings | 6 endpoints | Configuracoes globais |
| Console | 2 endpoints | Logs em tempo real |
| Knowledge | 2 endpoints | Contexto RAG e indexacao |
| Continuous RAG | 4 endpoints | Scan continuo de codebase |
| Contracts | 3 endpoints | Contratos de governanca |
| Chat Sessions | 3 endpoints | Sessoes de chat |

---

## 4. SERVICOS (44 Servicos)

### 4.1. Orquestracao de IA

**AIOrchestrator** (`ai_orchestrator.py`) - Servico central
- Selecao automatica de modelo por usage_type
- Cache Redis multi-nivel (L1: hash exato, L2: similaridade >95%, L3: template)
- Integracao com RAG para contexto
- Rate limiting por modelo
- Fallback automatico via AI Flow Chains
- Execucao de utility nodes (Cache, RAG, Transformer, Router, Retry, Validator, Cost Guard, Rate Limiter)
- Suporte a 3 providers: Anthropic, OpenAI, Google + Ollama local
- Todas as 120+ chamadas de IA do sistema passam por este servico

**UtilityNodeExecutor** (`utility_node_executor.py`)
- 8 tipos de utility nodes configuráveis no diagrama AI Flow
- Cache Node: cache com TTL configuravel
- RAG Node: injecao de contexto semantico
- Transformer Node: pre/pos-processamento de prompts
- Router Node: roteamento condicional
- Retry Node: retry com backoff exponencial
- Validator Node: validacao de output
- Cost Guard Node: limite de custo por execucao
- Rate Limiter Node: controle de taxa

### 4.2. Analise de Codigo

**CodebaseMemoryService** (`codebase_memory.py`)
- Scan multi-fase do codebase: Documentacao -> Dominio -> Logica -> Consolidacao
- Extracao de simbolos (classes, funcoes, imports, constantes)
- Priorizacao de arquivos: docs > config > migrations > models > services
- Deteccao de stack tecnologica
- Extracao de regras de negocio do codigo
- Armazenamento no RAG

**SymbolExtractor** (`symbol_extractor.py`)
- Extrai mapa de simbolos de cada arquivo sem IA
- Classes, funcoes, imports, constantes, decorators
- Usado como input para o codebase analysis via IA

**PatternRecognizer** (`pattern_recognizer.py`)
- Deteccao de patterns com IA (design patterns, architectural patterns)
- Scoring de confianca

**StaticPatternExtractor** (`static_pattern_extractor.py`)
- Extracao de patterns sem IA (regex-based)
- Mais rapido, usado como complemento

**PatternClusterer** (`pattern_clusterer.py`)
- Agrupamento de patterns similares
- Reducao de duplicatas

### 4.3. Geracao de Conteudo

**ContextGenerator** (`context_generator.py`) - ~6000 linhas
- Geracao de contexto rico a partir do memory scan
- Geracao de epics sugeridos incrementalmente
- Ativacao de cards (epic, story, task, subtask)
- Geracao de filhos (draft stories, draft tasks, draft subtasks)
- Contexto rico: analise arquitetural + dominio de negocio + mapa de features + consolidacao
- Validacao de resposta antes de salvar descricao

**PromptGenerator** (`prompt_generator.py`)
- Gera prompts para execucao de tasks
- Integracao com specs para reducao de tokens
- Compressao de contexto

**CommitGenerator** (`commit_generator.py`)
- Gera mensagens de commit semanticas
- Analise de diffs via CommitDiffAnalyzer
- Sumarizacao de mudancas

**SpecGenerator** (`spec_generator.py`)
- Gera specs de framework a partir de patterns detectados

### 4.4. RAG (Retrieval-Augmented Generation)

**RAGService** (`rag_service.py`)
- Embeddings: sentence-transformers "all-MiniLM-L6-v2" (384 dimensoes)
- Armazenamento em PostgreSQL com pgvector
- Busca por similaridade coseno
- Tipos de documento: business_rule, interview_answer, pattern, code_file, document
- Metadados: type, project_id, content_type, source

**PromptDocRAGSync** (`prompt_doc_rag_sync.py`)
- Sincroniza documentos de prompt com RAG

**SpecRAGSync** (`spec_rag_sync.py`)
- Sincroniza specs com RAG

**KnowledgeGraphBuilder** (`knowledge_graph_builder.py`)
- Constroi grafo de conhecimento a partir do codigo

### 4.5. Execucao e Validacao

**TaskExecutor** (`task_execution/executor.py`)
- Executa tasks gerando codigo
- Selecao dinamica de modelo
- Gerenciamento de budget de tokens
- Execucao em lote

**JobExecutor** (`job_executor.py`)
- Executor de jobs com fila de prioridade
- Controle de concorrencia
- Cleanup de jobs zombies

**ConsistencyValidator** (`consistency_validator.py`)
- Detecta inconsistencias no backlog
- Categorias: conflitos, duplicatas, dependencias ciclicas

**WorkflowValidator** (`workflow_validator.py`)
- Valida transicoes de estado do workflow

### 4.6. Cache e Performance

**CacheService** (`cache_service.py`)
- L1: Match exato por hash (TTL: 7 dias, hit rate esperado: ~20%)
- L2: Match semantico >95% similaridade (TTL: 1 dia, hit rate: ~10%)
- L3: Cache de template para prompts deterministicos (TTL: 30 dias, hit rate: ~5%)
- Hit rate total esperado: 30-35% = economia de 60-90% em custos

**RateLimiter** (`rate_limiter.py`)
- Rate limiting por modelo de IA
- Registra uso ANTES da chamada (preventivo)
- Janela de tempo configuravel por modelo

### 4.7. Prompts e Contratos

**PromptLoader** (`prompts/loader.py`)
- Carrega YAML templates de `backend/app/prompts/`
- Renderiza com Jinja2 (variaveis + componentes)
- Cache LRU para performance
- 64 templates organizados por categoria

**ContractLoader** (`contracts/loader.py`)
- Estende PromptLoader com governanca
- Regras de validacao e constrains
- Mapas semanticos
- 70 contratos organizados por dominio

---

## 5. SISTEMA DE PROMPTS (64 Arquivos YAML)

### 5.1. Backlog (7 arquivos)

| Arquivo | Descricao | Variaveis Obrigatorias |
|---------|-----------|----------------------|
| epic_from_interview.yaml | Gera Epic de entrevista | conversation_text, semantic_map_text |
| stories_from_epic.yaml | Decompoe Epic em 3-7 Stories | epic_title, epic_description |
| tasks_from_story.yaml | Decompoe Story em 3-10 Tasks | story_title, story_description |
| subtasks_from_task.yaml | Decompoe Task em 3-5 Subtasks | task_title, task_description |
| epic_from_rules.yaml | Gera Epic de regras de negocio | business_rules_text |
| suggest_title.yaml | Sugere titulo do projeto | codebase_analysis |
| meta_prompt_hierarchy.yaml | Orquestra geracao hierarquica | epic_title, epic_description |

### 5.2. Interviews (25 arquivos)

**Principais:**
- context_interview_ai.yaml - Perguntas fechadas com 5-8 opcoes
- unified_open.yaml - Entrevista aberta unificada
- fixed_questions_context.yaml - Q1-Q3 fixas para contexto
- requirements_analyst.yaml - Persona de analista de requisitos

**Por tipo de card (11 arquivos):**
bug.yaml, bugfix.yaml, design.yaml, documentation.yaml, enhancement.yaml, feature.yaml, generic.yaml, optimization.yaml, refactor.yaml, security.yaml, testing.yaml

**Por tipo de task (4 arquivos):**
feature.yaml, bug.yaml, enhancement.yaml, refactor.yaml

**Secoes especializadas (3 arquivos):**
business.yaml, design.yaml, mobile.yaml

### 5.3. Context (16 arquivos)

**Geracao de conteudo:**
- context_generation.yaml / context_generation_full.yaml
- activate_epic.yaml / activate_epic_full.yaml
- suggested_epics.yaml / suggested_epics_full.yaml
- story/task/subtask_specification.yaml

**Geracao de titulos:**
- story_titles_generation.yaml
- task_titles_generation.yaml
- subtask_titles_generation.yaml

**Drafts:**
- draft_stories.yaml, draft_tasks.yaml, draft_subtasks.yaml

**Contexto rico:**
- rich_context_architecture.yaml - Analise arquitetural
- rich_context_business_domain.yaml - Dominio de negocio
- rich_context_features.yaml - Mapa de funcionalidades
- rich_context_consolidation.yaml - Consolidacao final

**Wiki:**
- wiki_enrichment.yaml - Enriquecimento de paginas wiki
- wiki_rule_enrichment.yaml - Enriquecimento de regras de negocio

### 5.4. Memory (3 arquivos)

- codebase_analysis.yaml - Analise multi-fase do codebase
- consolidation.yaml - Consolidacao de resultados das fases
- detect_ignore_dirs.yaml - Deteccao de diretorios a ignorar

### 5.5. Outros

- commits/commit_message.yaml - Mensagens de commit semanticas
- discovery/pattern_discovery.yaml - Descoberta de patterns
- components/semantic_methodology.yaml - Metodologia de Referencias Semanticas
- components/json_output_rules.yaml - Regras de output JSON
- components/project_context.yaml - Contexto do projeto

---

## 6. SISTEMA DE CONTRATOS (70 Arquivos YAML)

### 6.1. Contratos de Negocio (8 arquivos)

**card_hierarchy.yaml** - Hierarquia de cards
- V1: Epic so pode ter Stories como filhos
- V2: Story so pode ter Tasks como filhos
- V3: Task so pode ter Subtasks como filhos
- V4: Subtask nao pode ter filhos
- C1: Epic ativado gera 15-20 Stories draft
- C2: Story ativada gera 5-8 Tasks draft
- C3: Task ativada gera 3-5 Subtasks draft
- C4: Identificadores semanticos sao herdados e incrementados

**semantic_references.yaml** - Metodologia de Referencias Semanticas
- V1: Identificadores devem seguir formato N1-N99, P1-P99, etc.
- V2: Identificadores sao imutaveis apos atribuicao
- V3: Cada identificador tem significado unico
- C1: 10 categorias: N(noun), P(process), E(endpoint), D(data), S(service), C(constraint), AC(acceptance), R(requirement), F(feature), M(module)
- C2: Filhos reutilizam identificadores do pai
- C3: Novos identificadores comecam apos o maximo do pai
- C4: Dual output: semantico (para IA) + humano (legivel)

**project_creation.yaml** - Criacao de projetos
- V1: code_path e obrigatorio (pasta existente)
- V2: code_path e imutavel apos criacao
- V3: Validacao de existencia da pasta
- C1: Pipeline: scan -> context -> epics -> wiki
- C2: Contexto travado apos primeira ativacao de Epic
- C3: Wizard incompleto deleta projeto automaticamente

**memory_scan.yaml** - Scan de codebase
- V1: code_path deve existir e ser acessivel
- V2: Profundidade: quick (100 arquivos), normal (500), deep (ilimitado)
- V3: Respeitar .gitignore e patterns de exclusao
- C1: 4 fases: Documentacao -> Dominio -> Logica -> Consolidacao
- C2: Priorizacao: docs > config > migrations > models > services > views > tests
- C3: Extracao de simbolos sem IA (rapido)
- C4: Analise por IA com mapa de simbolos (profundo)

**workflow_states.yaml** - Maquina de estados completa por tipo

**job_priorities.yaml** - Matriz de prioridade de jobs

**generation_counts.yaml** - Contadores de geracao por nivel

**queue_scoring.yaml** - Algoritmo de scoring da fila

### 6.2. Contratos de Geracao (18 arquivos)

Espelham os prompts de geracao com regras adicionais de governanca:
- Limites de tokens por operacao
- Temperatura recomendada por tipo
- Validacoes de output obrigatorias
- Regras de formatacao

### 6.3. Contratos de Entrevista (31 arquivos)

Espelham os prompts de entrevista com:
- Regras de formatacao de perguntas
- Limites de opcoes (5-8 por pergunta)
- Perguntas fixas obrigatorias
- Regras de deduplicacao

### 6.4. Contratos de Memoria (7 arquivos)

Regras para extracao e consolidacao:
- Formatos de output JSON obrigatorios
- Regras de idioma (portugues obrigatorio)
- Limites de tokens por fase
- Regras de priorizacao de arquivos

---

## 7. PAGINAS DO FRONTEND (25+ Paginas)

### 7.1. Paginas Principais

| Rota | Pagina | Descricao |
|------|--------|-----------|
| / | Dashboard | Analytics de custo, cache, tokens por provider |
| /projects | Lista de Projetos | Cards de projetos com status, busca, criacao |
| /projects/new | Wizard de Criacao | Selecao de pasta, scan, preview |
| /projects/[id] | Dashboard do Projeto | Tabs: Overview, Backlog, Kanban, Queue, Wiki, Interview, Specs, Commits, RAG, Analytics, Consistency |
| /projects/[id]/setup-context | Entrevista de Contexto | Chat com IA, review, confirmacao |
| /projects/[id]/execute | Execucao de Task | Output em tempo real, metricas |
| /projects/[id]/wiki | Wiki do Projeto | Navegacao, edicao, hierarquia |
| /projects/[id]/wiki/[slug] | Pagina Wiki | Conteudo, sub-paginas, edicao |
| /projects/[id]/knowledge | Base de Conhecimento | Regras, documentos, busca, RAG stats |
| /projects/[id]/consistency | Verificador de Consistencia | Issues, severidade, auto-fix |

### 7.2. Paginas de Configuracao

| Rota | Pagina | Descricao |
|------|--------|-----------|
| /ai-models | Gestao de Modelos | CRUD de modelos, providers, usage types |
| /ai-flow | Editor Visual de Chains | Diagrama estilo n8n, metricas, otimizacao |
| /settings | Configuracoes Gerais | Key-value settings |

### 7.3. Paginas de Monitoramento

| Rota | Pagina | Descricao |
|------|--------|-----------|
| /prompts | Historico de Prompts | Todos os prompts executados, busca, filtros |
| /ai-executions | Logs de Execucao | Logs completos, custo, erros |
| /jobs | Fila de Jobs | Lista, filtros, bulk actions, pause/resume |
| /console | Console em Tempo Real | Streaming de logs, AI Flow live |
| /contracts | Contratos de Negocio | Visualizacao de contratos YAML |
| /rag | Dashboard RAG | Monitoramento, indexacao, scan continuo |

### 7.4. Tabs do Projeto (11 tabs)

O dashboard do projeto tem 11 tabs organizadas em grupos:

**Grupo Principal:**
1. **Overview** - Descricao, estatisticas, edicao inline (double-click)
2. **Backlog** - Lista hierarquica (Epic -> Story -> Task -> Subtask), filtros, bulk actions
3. **Kanban** - Board com 6 colunas (Blocked, Backlog, To Do, In Progress, Review, Done)
4. **Queue** - Fila de execucao com drag-to-reorder

**Grupo Conhecimento:**
5. **Wiki** - Paginas wiki com sidebar, conteudo, sub-paginas
6. **Specs** - Especificacoes de framework do projeto

**Grupo Desenvolvimento:**
7. **Interview** - Entrevista de contexto (visivel se context_locked=false)
8. **Commits** - Historico de commits gerados

**Grupo Analytics:**
9. **RAG** - Estatisticas RAG, indexacao, scan continuo
10. **Analytics** - Metricas de bloqueio e execucao
11. **Consistency** - Issues de consistencia do backlog

---

## 8. COMPONENTES DO FRONTEND (60+ Componentes)

### 8.1. Layout

- **Layout** - Wrapper principal com navbar + sidebar + conteudo
- **Navbar** - Navegacao superior com logo, busca, notificacoes
- **Sidebar** - Menu lateral colapsavel (estado persistido em localStorage)
- **Breadcrumbs** - Navegacao por migalhas de pao

### 8.2. Backlog

- **BacklogListView** - Lista hierarquica com expand/collapse por nivel
- **ItemDetailPanel** - Painel de detalhes com 8 sub-tabs (Overview, Prompt, Acceptance Criteria, Interview, Children, Relationships, Comments, Transitions)
- **TaskCard** - Card individual de backlog
- **InlineCardCreator** - Criacao de card inline
- **BacklogFilters** - Filtros (tipo, prioridade, status, labels, busca)
- **BulkActionBar** - Acoes em massa
- **PromptQueuePanel** - Fila de execucao com drag-to-reorder
- **GenerationWizard** - Wizard de geracao hierarquica

### 8.3. Kanban

- **KanbanBoard** - Board com 6 colunas drag-and-drop
- **DroppableColumn** - Coluna com drop zone
- **DraggableTaskCard** - Card arrastavel

### 8.4. Interview

- **ChatInterface** - Interface de chat com IA (bolhas, opcoes, tempo real)
- **MessageBubble** - Bolha de mensagem individual
- **InterviewTree** - Arvore de perguntas/respostas
- **InterviewList** - Lista de entrevistas do projeto

### 8.5. Wiki

- **WikiPanel** - Painel wiki com sidebar + conteudo + edicao

### 8.6. RAG

- **CodeIndexingPanel** - Painel de indexacao de codigo
- **RagStatsCard** - Card de estatisticas RAG
- **ContinuousRAGPanel** - Painel de scan continuo
- **RagUsageTypeTable** - Tabela de uso por tipo
- **RagHitRatePieChart** - Grafico de hit rate

### 8.7. UI Primitives

- Button, Card, Input, Label, Select, Badge, Checkbox
- Dialog, ConfirmDialog, ErrorDialog
- FolderPicker, JobProgressBar, JobIndicator
- NotificationBell (sino com badge de contagem)
- AIModelBadge (badge com icone do provider)

### 8.8. Icons

Biblioteca de 30+ icones SVG inline: Brain, Search, Target, Wrench, Puzzle, Cog, CPU, Document, Microphone, etc.

---

## 9. REGRAS DE NEGOCIO CONSOLIDADAS

### 9.1. Projeto

| # | Regra | Origem |
|---|-------|--------|
| RN-P01 | code_path e obrigatorio e imutavel apos criacao | PROMPT #111 |
| RN-P02 | Projeto tem 3 estados: draft, processing, active | PROMPT #126 |
| RN-P03 | Projeto em processing nao pode ser editado | PROMPT #189 |
| RN-P04 | context_locked so muda de false para true, nunca volta | PROMPT #89 |
| RN-P05 | context_locked e setado na primeira ativacao de Epic | PROMPT #94 |
| RN-P06 | context_human e context_semantic sao imutaveis apos lock | PROMPT #89 |
| RN-P07 | Wizard incompleto deleta o projeto automaticamente | PROMPT #98 |
| RN-P08 | Pipeline de criacao: scan -> context -> epics -> wiki | PROMPT #121 |
| RN-P09 | Deletar projeto deleta em cascata: tasks, interviews, wiki, commits | - |
| RN-P10 | description so aceita conteudo com secoes validas (visao geral, stack, etc.) | PROMPT #277 |

### 9.2. Hierarquia de Cards

| # | Regra | Origem |
|---|-------|--------|
| RN-H01 | 4 niveis: Epic -> Story -> Task -> Subtask | PROMPT #102 |
| RN-H02 | Epic ativado gera 15-20 Stories como draft | PROMPT #102 |
| RN-H03 | Story ativada gera 5-8 Tasks como draft | PROMPT #102 |
| RN-H04 | Task ativada gera 3-5 Subtasks como draft | PROMPT #102 |
| RN-H05 | Cards sugeridos tem labels=["suggested"] e workflow_state="draft" | PROMPT #92 |
| RN-H06 | Ativar card: remove "suggested", muda state para "open", gera filhos | PROMPT #94 |
| RN-H07 | Cards sugeridos NAO podem gerar filhos diretamente | PROMPT #102 |
| RN-H08 | Primeira ativacao de Epic trava o contexto do projeto | PROMPT #94 |
| RN-H09 | Deletar task deleta em cascata suas entrevistas | PROMPT #88 |
| RN-H10 | Ativar card pai ativa em cascata ancestrais nao ativados | PROMPT #214 |
| RN-H11 | Gradiente de conteudo: Epic(negocio) -> Story(regras) -> Task(tecnico) -> Subtask(codigo) | PROMPT #83 |

### 9.3. Referencias Semanticas

| # | Regra | Origem |
|---|-------|--------|
| RN-S01 | 10 categorias de identificadores: N, P, E, D, S, C, AC, R, F, M | PROMPT #83 |
| RN-S02 | Identificadores sao IMUTAVEIS apos atribuicao | PROMPT #83 |
| RN-S03 | Cada identificador tem significado unico e permanente | PROMPT #83 |
| RN-S04 | Filhos reutilizam identificadores do pai sem redefinir | PROMPT #83 |
| RN-S05 | Novos identificadores incrementam a partir do maximo do pai | PROMPT #83 |
| RN-S06 | Dual output: generated_prompt (semantico) + description (humano) | PROMPT #85 |
| RN-S07 | Conversao semantico->humano via regex sem IA adicional | PROMPT #85 |

### 9.4. Entrevista

| # | Regra | Origem |
|---|-------|--------|
| RN-E01 | Entrevista de contexto: minimo 3 perguntas fixas (Q1-Q3) | PROMPT #89 |
| RN-E02 | Entrevista de contexto: sem limite maximo, usuario decide quando parar | PROMPT #93 |
| RN-E03 | Perguntas sao fechadas com 5-8 opcoes de resposta | PROMPT #109 |
| RN-E04 | Formato de opcoes: checkbox com simbolo especial | PROMPT #109 |
| RN-E05 | Deduplicacao automatica de perguntas | - |
| RN-E06 | Entrevista focada em card: perguntas especializadas por tipo | PROMPT #68 |
| RN-E07 | Setup-context so redireciona se context_locked=true | PROMPT #277 |

### 9.5. Modelos de IA

| # | Regra | Origem |
|---|-------|--------|
| RN-AI01 | API keys NUNCA no .env, SEMPRE no banco (tabela ai_models) | CLAUDE.md |
| RN-AI02 | Todas as chamadas de IA passam pelo AIOrchestrator | CLAUDE.md |
| RN-AI03 | Messages usam apenas roles "user" e "assistant" | CLAUDE.md |
| RN-AI04 | System prompt e passado como parametro separado | CLAUDE.md |
| RN-AI05 | AIOrchestrator converte formato para cada provider | CLAUDE.md |
| RN-AI06 | Cache automatico em todas as chamadas (L1/L2/L3) | PROMPT #74 |
| RN-AI07 | Rate limiter registra uso ANTES da chamada | PROMPT #159 |
| RN-AI08 | Cada usage_type tem exatamente UMA chain ativa | PROMPT #122 |
| RN-AI09 | Chain e percorrida em ordem: se modelo 1 falha, tenta modelo 2 | PROMPT #123 |
| RN-AI10 | 8 usage_types: interview, prompt_generation, commit_generation, task_execution, pattern_discovery, memory, queue_orchestration, general | - |

### 9.6. Wiki

| # | Regra | Origem |
|---|-------|--------|
| RN-W01 | Paginas com parent_id=NULL aparecem como raiz no sidebar | PROMPT #272 |
| RN-W02 | Paginas regra-* DEVEM ter parent_id para regras-de-negocio | PROMPT #277 |
| RN-W03 | Se regras-de-negocio nao existe, e criada automaticamente | PROMPT #277 |
| RN-W04 | Wiki e gerada automaticamente no pipeline de criacao | PROMPT #258 |
| RN-W05 | Secoes padrao: Visao Geral, Stack, Arquitetura, Features, Regras, Integracoes | - |
| RN-W06 | Links semanticos entre paginas (estilo Wikipedia) | PROMPT #273 |
| RN-W07 | Enriquecimento individual de regras via job de background | PROMPT #275 |

### 9.7. RAG (Retrieval-Augmented Generation)

| # | Regra | Origem |
|---|-------|--------|
| RN-R01 | Embeddings: all-MiniLM-L6-v2 (384 dimensoes) | PROMPT #110 |
| RN-R02 | Busca por similaridade coseno em pgvector | PROMPT #110 |
| RN-R03 | Tipos de documento: business_rule, interview_answer, pattern, code_file | - |
| RN-R04 | Metadata keys: type E content_type (OR clause em queries) | PROMPT #249 |
| RN-R05 | Scan continuo com rastreamento por arquivo (hash + timestamp) | PROMPT #218 |
| RN-R06 | Specs sincronizadas com RAG automaticamente | PROMPT #110 |

### 9.8. Jobs

| # | Regra | Origem |
|---|-------|--------|
| RN-J01 | Jobs sao executados em background (nao bloqueiam API) | PROMPT #65 |
| RN-J02 | Fila de prioridade: CRITICAL(10) > HIGH(7) > NORMAL(5) > LOW(3) | PROMPT #120 |
| RN-J03 | Notificacao em tempo real via WebSocket | PROMPT #134 |
| RN-J04 | Cleanup automatico de jobs zombies no restart | PROMPT #259 |
| RN-J05 | Cooldown de 5 minutos para watchdog (evita scan excessivo) | PROMPT #259 |
| RN-J06 | Deep links para navegacao pos-conclusao do job | PROMPT #128 |

### 9.9. Prompts

| # | Regra | Origem |
|---|-------|--------|
| RN-PR01 | Todos os prompts externalizados em YAML (nunca hardcoded) | PROMPT #103 |
| RN-PR02 | Modificacoes de prompts sempre no YAML, nunca no Python | PROMPT #109 |
| RN-PR03 | Variaveis dinamicas via Jinja2 ({{ variable }}) | PROMPT #103 |
| RN-PR04 | Componentes reutilizaveis via {{ components.name }} | PROMPT #103 |
| RN-PR05 | Todo conteudo gerado DEVE ser em portugues brasileiro | PROMPT #277 |

### 9.10. Specs e Tokens

| # | Regra | Origem |
|---|-------|--------|
| RN-T01 | Specs de framework reduzem 60-80% dos tokens na geracao | PROMPT #48 |
| RN-T02 | Specs seletivas na execucao reduzem 15-20% adicional | PROMPT #49 |
| RN-T03 | Reducao total: 70-85% de tokens economizados | PROMPT #49 |
| RN-T04 | Specs tem versionamento com historico e rollback | PROMPT #47 |

---

## 10. FLUXOS PRINCIPAIS

### 10.1. Criacao de Projeto

```
1. Usuario seleciona pasta de codigo no FolderPicker
2. Backend valida que code_path existe e e acessivel
3. Projeto criado com status="processing"
4. Pipeline assincrono inicia:
   a. Memory Scan (4 fases: docs -> domain -> logic -> consolidation)
   b. Extracao de stack, regras de negocio, features, entidades
   c. Consolidacao gera: titulo sugerido, contexto, descricao
   d. Geracao de Rich Context (arquitetura, dominio, features)
   e. Geracao de Wiki (6+ paginas)
   f. Geracao de Epics sugeridos (8-20 drafts)
   g. Armazenamento no RAG
5. Projeto muda para status="active"
6. Usuario ve projeto com wiki, epics sugeridos, contexto
```

### 10.2. Ativacao de Epic

```
1. Usuario clica "Aprovar" em epic sugerido (draft)
2. Remove label "suggested", muda workflow_state para "open"
3. Se primeira ativacao: trava context_locked=true
4. Gera 15-20 Stories como draft (usando geracao hierarquica)
5. Cada Story herda identificadores semanticos do Epic
6. Stories ficam como drafts aguardando ativacao
```

### 10.3. Entrevista de Contexto

```
1. Usuario clica na tab "Interview" do projeto
2. Navega para /projects/{id}/setup-context
3. Se context_locked=true: redireciona de volta (contexto ja definido)
4. Se context_locked=false: inicia entrevista
   a. 3 perguntas fixas obrigatorias (Q1-Q3)
   b. IA gera perguntas contextuais (Q4+) sem limite
   c. Cada pergunta: fechada, 5-8 opcoes
   d. Usuario decide quando parar clicando "Gerar Contexto"
5. Geracao de contexto (semantico + humano)
6. Review do contexto gerado
7. Confirmacao e lock do contexto
```

### 10.4. Execucao de Task

```
1. Usuario seleciona task no backlog
2. Clica "Execute" no ItemDetailPanel
3. AIOrchestrator seleciona modelo via chain de task_execution
4. Specs relevantes sao injetadas para reducao de tokens
5. Codigo e gerado em background (job assincrono)
6. Output em tempo real via console streaming
7. Resultado salvo em TaskResult com validacao
```

### 10.5. AI Flow Chain Fallback

```
1. Servico chama orchestrator.execute(usage_type="memory", ...)
2. AIOrchestrator busca chain ativa para usage_type
3. Chain: [Qwen3, Gemma3, DeepSeek-R1]
4. Tenta Qwen3 14B:
   - Se sucesso: retorna resultado, loga execucao
   - Se falha (timeout, erro, rate limit):
5. Tenta Gemma3 12B (fallback):
   - Se sucesso: retorna resultado, marca chain_fallback=true
   - Se falha:
6. Tenta DeepSeek-R1 14B (ultimo recurso):
   - Se sucesso: retorna resultado
   - Se falha: retorna erro ao chamador
```

---

## 11. HISTORICO DE EVOLUCAO

### Marcos Principais

| PROMPT | Data | Descricao |
|--------|------|-----------|
| #46-50 | Jan 2026 | Phases 1-4: Stack questions, specs database, token reduction |
| #68 | Jan 2026 | Dual-Mode Interview System |
| #69-72 | Jan 2026 | Refatoracao de modulos (interviews, task_executor, tasks, ChatInterface) |
| #74 | Jan 2026 | Cache Redis multi-nivel (L1/L2/L3) |
| #83 | Jan 2026 | Metodologia de Referencias Semanticas |
| #89-93 | Jan 2026 | Context Interview (perguntas fixas, ilimitado, lock) |
| #94-96 | Jan 2026 | Activate/Reject Epics sugeridos |
| #98 | Jan 2026 | Cleanup de projetos abandonados |
| #100 | Jan 2026 | Fix de model IDs invalidos |
| #102 | Jan 2026 | Geracao hierarquica (Epic -> Stories -> Tasks -> Subtasks) |
| #103 | Jan 2026 | Externalizacao de prompts para YAML (64 arquivos) |
| #110 | Jan 2026 | RAG Evolution com pgvector |
| #111 | Jan 2026 | code_path obrigatorio e imutavel |
| #118 | Fev 2026 | Codebase Memory Scan |
| #120-121 | Fev 2026 | Job Priority System, Project Creation Redesign |
| #122-125 | Fev 2026 | AI Flow Chains (visual editor, fallback, analytics) |
| #134 | Fev 2026 | WebSocket para notificacoes em tempo real |
| #152 | Fev 2026 | Rate Limiting por modelo |
| #163 | Fev 2026 | Memory Scan multi-fase com symbol extraction |
| #204-205 | Fev 2026 | Utility Nodes no AI Flow (8 tipos) |
| #215 | Fev 2026 | Prompt Queue Orchestration |
| #230 | Fev 2026 | Refactor do memory scan com symbol extractor |
| #256 | Fev 2026 | Externalizacao de contratos para YAML (70 arquivos) |
| #257-259 | Fev 2026 | MVP 3-front: rich cards, living wiki, clean jobs |
| #272-273 | Fev 2026 | Wiki como tab do projeto, tabs agrupadas |
| #277 | Fev 2026 | Fix wiki sidebar, entrevista, portugues, validacao AI |
| #278 | Fev 2026 | Fix chains: Qwen3 primeiro para memory/general |

---

## 12. METRICAS ATUAIS DO SISTEMA

### Banco de Dados

| Tabela | Registros |
|--------|-----------|
| rag_documents | 516 |
| ai_executions | 241 |
| prompts | 26 |
| async_jobs | 19 |
| ai_models | 18 |
| ai_flow_chains | 8 |
| projects | 1 |

### Execucoes de IA

| Metrica | Valor |
|---------|-------|
| Total de execucoes | 243 |
| Provider usado | 100% Ollama (local) |
| Tokens de entrada | 149.431 |
| Tokens de saida | 88.837 |
| Tokens totais | 238.268 |
| Custo total | $0.00 (modelos locais) |

---

## 13. ESTRUTURA DE DIRETORIOS

```
orbit/
├── backend/
│   ├── app/
│   │   ├── api/routes/          # 25 routers com 120+ endpoints
│   │   ├── models/              # 24 modelos SQLAlchemy
│   │   ├── schemas/             # Schemas Pydantic
│   │   ├── services/            # 44 servicos
│   │   ├── prompts/             # 64 YAML templates
│   │   │   ├── backlog/         # 7 prompts de geracao hierarquica
│   │   │   ├── interviews/      # 25 prompts de entrevista
│   │   │   ├── context/         # 16 prompts de contexto
│   │   │   ├── memory/          # 3 prompts de memoria
│   │   │   ├── commits/         # 1 prompt de commit
│   │   │   ├── discovery/       # 2 prompts de descoberta
│   │   │   └── components/      # 3 componentes reutilizaveis
│   │   ├── contracts/           # 70 YAML contratos
│   │   │   ├── business/        # 8 contratos de negocio
│   │   │   ├── generation/      # 18 contratos de geracao
│   │   │   ├── interviews/      # 31 contratos de entrevista
│   │   │   ├── memory/          # 7 contratos de memoria
│   │   │   ├── execution/       # 3 contratos de execucao
│   │   │   └── schema/          # 1 schema de contrato
│   │   ├── config.py            # Configuracoes
│   │   └── database.py          # Conexao PostgreSQL
│   ├── alembic/versions/        # 45 migrations
│   └── scripts/                 # Scripts utilitarios
├── frontend/
│   └── src/
│       ├── app/                 # 25+ paginas (Next.js App Router)
│       ├── components/          # 60+ componentes React
│       │   ├── backlog/         # Backlog, ItemDetail, Queue
│       │   ├── kanban/          # KanbanBoard, drag-and-drop
│       │   ├── interview/       # ChatInterface, MessageBubble
│       │   ├── wiki/            # WikiPanel
│       │   ├── rag/             # RAG stats, indexing
│       │   ├── ui/              # Primitives (Button, Card, Dialog, etc.)
│       │   └── icons/           # 30+ SVG icons
│       ├── hooks/               # 5 custom hooks
│       ├── contexts/            # NotificationContext
│       └── lib/
│           ├── api.ts           # 19 grupos de API
│           ├── types.ts         # 100+ TypeScript types
│           └── websocket.ts     # WebSocket client
├── rag/
│   └── internal/                # 250 reports PROMPT_*.md
├── docker-compose.yml           # 7 servicos
├── CLAUDE.md                    # Instrucoes permanentes
└── ORBIT_REPORT.md              # Este relatorio
```

---

## 14. CONCLUSAO

O ORBIT e um sistema maduro com 278 PROMPTs implementados, cobrindo desde analise automatica de codebases ate geracao hierarquica de backlogs com IA. Os principais diferenciais sao:

1. **Multi-provider AI**: 3 providers cloud + Ollama local, com fallback automatico
2. **Custo zero operacional**: Preset "Custo Minimo" usa 100% modelos locais
3. **Prompts externalizados**: 64 YAML templates + 70 contratos de governanca
4. **Hierarquia semantica**: Metodologia de Referencias Semanticas com rastreabilidade
5. **RAG integrado**: Busca semantica com pgvector para enriquecimento de contexto
6. **Wiki automatica**: Documentacao gerada e enriquecida por IA
7. **Cache inteligente**: 3 niveis de cache com economia estimada de 60-90%
8. **Pipeline automatico**: Da selecao de pasta ate epics sugeridos em minutos

O sistema evolui continuamente atraves de PROMPTs documentados, cada um gerando um report de implementacao que alimenta o proprio RAG do ORBIT para auto-analise.

---

*Relatorio gerado em 14/02/2026 por Claude Opus 4.6*
*250 PROMPTs documentados | 69.187 linhas Python | 41.800 linhas TypeScript*
