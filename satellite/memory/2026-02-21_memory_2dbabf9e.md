# memory — 2026-02-21

**Model:** claudio/claude-sonnet-4-6
**Status:** success
**Tokens:** 0 in / 0 out | Cost: $0.0000

## System Prompt

Você é um arquiteto de software consolidando múltiplas análises de código.

## SUA TAREFA:

Consolide TODAS as informações das fases de análise (fornecidas no prompt do usuário) em um resultado final.

### 1. TÍTULO DO PROJETO (MUITO IMPORTANTE!)
- PROCURE por tags <title>...</title> nos arquivos HTML/blade - elas contêm o NOME OFICIAL do sistema!
- PROCURE por domínios como ".gov.br", ".com.br" - indicam o contexto organizacional
- Se encontrar domínio governamental (sei.pe.gov.br, etc.), mencione a organização (ex: "Governo de Pernambuco")
- Baseie-se no DOMÍNIO e PROPÓSITO do sistema
- Use 5-8 palavras descritivas
- NÃO use nomes de tecnologia (Laravel, React, etc.)
- NÃO use apenas "Sistema de X" com 3 palavras
- Exemplos BONS:
  * "SEI Contas - Gestão de Usuários LDAP para Governo PE"
  * "Portal de Atendimento ao Cidadão do Governo Federal"
  * "Sistema de Gestão Financeira Municipal de São Paulo"
- Exemplos RUINS:
  * "Laravel Project"
  * "Sistema Contas" (muito curto)
  * "PHP Application"

### 2. REGRAS DE NEGÓCIO
- Combine todas as regras encontradas nas fases
- Remova duplicatas
- Priorize regras mais específicas sobre genéricas
- Mínimo 5 regras, idealmente 10+

### 3. FUNCIONALIDADES PRINCIPAIS
- Liste os módulos/funcionalidades consolidados
- Seja específico: "Cadastro de clientes com histórico de compras" > "CRUD de clientes"
- Mínimo 5 funcionalidades

### 4. CONTEXTO PARA ENTREVISTA
- Escreva um PARÁGRAFO DETALHADO (mínimo 200 palavras)
- Explique:
  * O que o sistema faz
  * Para quem foi feito (público-alvo)
  * Quais problemas resolve
  * Principais entidades do domínio
  * Pontos que precisam de mais esclarecimento

## FORMATO DE RESPOSTA (JSON OBRIGATÓRIO):

{
  "suggested_title": "Nome Descritivo do Sistema Baseado no Domínio",
  "business_rules": [
    "Regra 1: descrição clara",
    "Regra 2: outra regra"
  ],
  "key_features": [
    "Feature 1: descrição detalhada",
    "Feature 2: outra funcionalidade"
  ],
  "entities": [
    "Entidade 1: descrição",
    "Entidade 2: descrição"
  ],
  "interview_context": "Parágrafo detalhado de 200+ palavras explicando o sistema..."
}

IMPORTANTE:
- Este é o resultado FINAL - seja completo e detalhado
- O título DEVE refletir o domínio de negócio
- Responda APENAS em JSON válido

IDIOMA OBRIGATÓRIO: TODO o conteúdo DEVE ser em português brasileiro.
O título (suggested_title) DEVE ser em português. Regras, features, entidades, contexto - TUDO em português.
NUNCA escreva título, regras ou features em ingles. Mesmo que o código-fonte esteja em ingles, traduza para português.

## User Prompt

## INFORMAÇÕES DO PROJETO:

- Nome da pasta: orbit
- Stack detectada: {"detected_stack": "nextjs", "confidence": 70, "indicators_found": ["\u2713 Required file: package.json", "\u2713 Optional: next.config.js", "\u2713 Package indicators in package.json"], "all_scores": {"laravel": 0, "nextjs": 70, "django": 0, "rails": 0, "express": 30, "fastapi": 25, "vue": 30, "react": 45, "angular": 0, "spring_boot": 0}, "description": "Next.js (React Framework)"}
- Total de arquivos analisados: 100

## ANÁLISES DAS FASES ANTERIORES:

{
  "documentation": {
    "partial_title": "",
    "business_rules_found": [],
    "features_found": [],
    "entities_found": [],
    "insights": "No files found for documentation phase"
  },
  "domain": {
    "partial_title": "Plataforma de Orquestração de Projetos com Contratos e Modelos de IA",
    "business_rules_found": [
      "Contratos possuem variáveis obrigatórias e opcionais que devem ser validadas antes da renderização",
      "A validação de variáveis de contrato suporta múltiplos tipos: esquema JSON, regex, verificação semântica, tamanho e campos obrigatórios",
      "Contratos são organizados por domínio, categoria e tipo de uso, permitindo segmentação e governança",
      "Modelos de IA possuem chaves de API que devem ser mascaradas ao serem exibidas (segurança de credenciais)",
      "Modelos de IA podem ser ativados ou desativados individualmente via toggle",
      "Modelos de IA são classificados por tipo de uso (usage_type), permitindo filtragem por finalidade",
      "Jobs assíncronos possuem ciclo de vida com status e prioridades configuráveis, sendo o resultado disponibilizado ao cliente apenas quando status=completed",
      "Tarefas possuem níveis de prioridade, severidade e tipos de resolução, indicando um fluxo de trabalho estruturado de gerenciamento",
      "Transições de status de tarefas são rastreadas, garantindo auditabilidade do ciclo de vida das tarefas",
      "Prompts possuem variáveis obrigatórias que são validadas antes da renderização, impedindo execuções com dados incompletos",
      "O sistema de contratos mantém log de alterações (ChangeLogEntry), garantindo rastreabilidade de mudanças",
      "Regras de acesso (AccessRule) e restrições (Constraint) são definidas por contrato, controlando quem pode executar e sob quais condições",
      "A orquestração de modelos de IA possui um status global consultável, indicando controle centralizado de execução"
    ],
    "features_found": [
      "Gerenciamento de contratos inteligentes com variáveis, validações e regras de acesso",
      "Renderização dinâmica de contratos e prompts com substituição de variáveis",
      "Cadastro e gerenciamento de modelos de IA com suporte a múltiplos provedores",
      "Mascaramento de chaves de API para exibição segura na interface",
      "Filtragem de modelos de IA por tipo de uso",
      "Execução assíncrona de jobs com controle de prioridade e acompanhamento de status",
      "Gerenciamento de tarefas com prioridade, severidade e tipo de resolução",
      "Rastreamento de transições de status de tarefas",
      "Sessões de chat integradas ao sistema",
      "Gestão de entrevistas e projetos",
      "Análise de projetos com execução de IA",
      "Controle de versão via commits rastreados",
      "Sistema de comentários em tarefas",
      "Relacionamentos entre tarefas (dependências)",
      "Configuração de sistema e modelos padrão por tipo de uso",
      "Orquestração centralizada de modelos de IA"
    ],
    "entities_found": [
      "Contrato (Contract) - com variáveis, regras, validadores e log de alterações",
      "VariávelDeContrato (ContractVariable) - obrigatória ou opcional, com restrições",
      "RegraDeValidação (ValidationRule) - associada a contratos",
      "RegrasDeContrato (ContractRules) - agrupamento de validações e restrições",
      "RegraDeAcesso (AccessRule) - controla permissões de execução de contrato",
      "Validador (Validator) - define tipo e critério de validação de saída",
      "ConfiguraçãoDeExecução (ExecutionConfig) - parâmetros de execução do contrato",
      "MetadadosDeContrato (ContractMetadata) - informações descritivas do contrato",
      "EntradaDeLogDeAlteração (ChangeLogEntry) - auditoria de mudanças em contratos",
      "JobAssíncrono (AsyncJob) - com status, prioridade e tipo",
      "Tarefa (Task) - com status, prioridade, severidade e tipo de resolução",
      "ResultadoDeTarefa (TaskResult) - resultado associado a uma tarefa",
      "RelacionamentoDeTarefa (TaskRelationship) - dependências entre tarefas",
      "ComentárioDeTarefa (TaskComment) - comentários associados a tarefas",
      "TransiçãoDeStatus (StatusTransition) - histórico de mudanças de estado",
      "ModeloDeIA (AIModel) - com provedor, tipo de uso, chave de API e configurações",
      "Projeto (Project) - entidade central de agrupamento",
      "Entrevista (Interview) - associada a projetos",
      "Prompt (Prompt) - template com variáveis obrigatórias e opcionais",
      "SessãoDeChat (ChatSession) - interações de chat no sistema",
      "Commit (Commit) - rastreamento de versões",
      "Spec (Spec) - especificação técnica associada a projetos",
      "AnáliseDeProjeto (ProjectAnalysis) - resultado de análise automatizada",
      "ExecuçãoDeIA (AIExecution) - registro de execuções de modelos de IA",
      "ConfiguraçãoDoSistema (SystemSettings) - configurações globais da plataforma"
    ],
    "insights": "O sistema revela uma plataforma sofisticada de orquestração de projetos orientada por IA, com forte separação entre camada de contratos (governança e validação de prompts estruturados) e camada de execução (jobs assíncronos, modelos de IA intercambiáveis). A presença de ChangeLogEntry, StatusTransition e TaskRelationship indica preocupação com auditabilidade e rastreabilidade. O padrão de múltiplos tipos de uso (usage_type) em modelos e contratos sugere um sistema multi-agente onde diferentes modelos de IA são especializados por função. A arquitetura de contratos espelha o padrão de 'prompt engineering governado', onde templates são versionados, validados e controlados por regras de acesso, indo além de simples templates de texto."
  },
  "logic": {
    "partial_title": "Plataforma de Desenvolvimento Assistido por IA com Pipeline de Orquestração e Memória de Código",
    "business_rules_found": [
      "Nós utilitários são executados em ordem de prioridade pré-definida e podem ser habilitados ou desabilitados individualmente por configuração",
      "O guardião de custos (cost_guard) bloqueia execuções de IA automaticamente quando o orçamento do projeto é excedido",
      "O validador de saída de IA dispara reprocessamento automático (retry) quando o resultado não passa na validação",
      "O limitador de taxa (rate_limiter) controla a frequência de chamadas à IA por projeto, com espera assíncrona",
      "O cache semântico reutiliza resultados de IA com limiar de similaridade de 0.95, evitando chamadas redundantes",
      "O serviço RAG só retorna contexto com similaridade acima de 0.70 em relação à consulta",
      "Projetos possuem limite máximo de specs (cap de 50) e de padrões descobertos por projeto",
      "Projetos em status 'draft' não permitem ativação de itens sugeridos — apenas projetos com status 'active' podem ativar épicos",
      "A ativação de um épico sugerido exige que o pipeline RAG tenha processado os arquivos do projeto previamente",
      "Tarefas são executadas com até 3 tentativas automáticas de validação e regeneração de conteúdo de IA",
      "A execução de tarefas controlada por orçamento (budget) calcula o custo real em USD a partir dos tokens consumidos",
      "Padrões estáticos de código só são aceitos quando a confiança de detecção supera o limiar de 0.75",
      "O watchdog limita o número de cards gerados por ciclo (MAX_CARDS_PER_CYCLE) com cooldowns distintos para idle, erro e batch",
      "Entrevistas devem estar no modo correto e possuir mensagens suficientes para permitir geração de contexto de projeto",
      "Entrevistas precisam ter dados de conversa registrados para que épicos de backlog possam ser gerados",
      "Regras de negócio são classificadas em hierarquia (nível épico ou história) antes de gerar cards com critérios de aceitação",
      "A geração de backlog usa no máximo 15 regras de negócio como contexto para limitar o escopo da geração",
      "O pipeline RAG é organizado em fases sequenciais obrigatórias: fase 1 (indexação de arquivos) e fase 2 (extração de regras)",
      "O estado do pipeline RAG é persistido no Redis por projeto, garantindo retomada de fase em caso de falha",
      "Orquestradores de código gerados dinamicamente têm a sintaxe validada antes de serem aceitos pelo sistema",
      "Diretórios satellite são protegidos contra remoção acidental por lista de diretórios protegidos (SATELLITE_PROTECTED_DIRS)",
      "A memória contínua de código detecta mudanças por comparação de hash de arquivo, identificando arquivos novos, modificados e deletados",
      "Prompts são salvos no satellite apenas para tipos de uso específicos (_SAVE_USAGE_TYPES), filtrando execuções internas",
      "Specs são filtradas por relevância usando keywords extraídas da conversa do usuário antes de compor o contexto do prompt"
    ],
    "features_found": [
      "Pipeline de nós utilitários pré e pós processamento de chamadas de IA (rate limiter, cost guard, cache, RAG context, prompt transformer)",
      "Guardião de custos com bloqueio automático de execuções quando orçamento é excedido",
      "Cache semântico multinível de resultados de IA com similaridade configurável e rastreamento de economia",
      "Serviço RAG com geração de embeddings via Ollama (modelo nomic) e busca vetorial por similaridade",
      "Pipeline RAG em fases sequenciais com controle de estado persistido no Redis",
      "Detecção contínua de mudanças na base de código por hash de arquivo com atribuição de camada semântica",
      "Extração estática de padrões de código: imports compartilhados, hierarquia de classes e assinaturas de funções",
      "Descoberta de padrões arquiteturais com pipeline em estágios e limite configurável por projeto",
      "Geração automática de wiki do projeto com páginas de stack, regras, features, scan e padrões arquiteturais",
      "Geração dinâmica de orquestradores de código por stack tecnológico com validação de sintaxe",
      "Execução de tarefas com validação automática, retry e controle de orçamento por execução",
      "Ativação de épicos sugeridos com validação de pré-condições (status do projeto, pipeline RAG processado)",
      "Geração de épicos e histórias a partir de entrevistas com contexto de memória do projeto",
      "Geração hierárquica de cards de regras de negócio com critérios de aceitação automáticos",
      "Watchdog autônomo com ciclos de enriquecimento de wiki e cards com cooldowns configuráveis",
      "Sistema de log estruturado por nível e categoria com streaming em tempo real via padrão subscriber/queue",
      "Exportação de prompts para estrutura de diretórios satellite do projeto",
      "Gerenciamento de jobs assíncronos com resolução automática de modelo de IA por tipo de uso",
      "Geração de contexto de projeto a partir de entrevistas com validação de completude e modo de entrevista",
      "Filtragem de specs relevantes por keywords extraídas dinamicamente de conversas do usuário",
      "Inicialização automatizada de base de conhecimento do projeto com scan de memória assíncrono"
    ],
    "entities_found": [
      "NóUtilitário (UtilityNode) — nó de processamento com tipo, configuração e flag de habilitação",
      "GuardiãoDeCustos (CostGuard) — controla orçamento de execuções e bloqueia quando excedido",
      "LimitadorDeTaxa (RateLimiter) — controla frequência de chamadas à IA com espera assíncrona",
      "TransformadorDePrompt (PromptTransformer) — transforma o prompt antes da execução da IA",
      "PáginaDeWiki (WikiPage) — documentação gerada automaticamente por projeto com slug único",
      "EstadoDeArquivoRAG (RagFileState) — estado de indexação de arquivo com hash e camada semântica",
      "CamadaSemântica (FileSemanticLayer) — classificação semântica de arquivos do projeto (ex: unknown)",
      "PadrãoEstático (StaticPattern) — padrão extraído estaticamente do código com nível de confiança",
      "GeradorDeOrquestrador (OrchestratorGenerator) — gera código de orquestrador por stack com validação de sintaxe",
      "ExecutorDeTarefas (TaskExecutor) — executa tarefas com validação, retry e controle de orçamento",
      "GerenciadorDeBudget (BudgetManager) — controla e calcula custos USD por execução de tarefa",
      "EntradaDeLog (ConsoleLogEntry) — entrada estruturada de log com nível, categoria, título e timestamp",
      "AssinanteDeLogs (LogSubscriber) — fila assíncrona de eventos de log em tempo real",
      "OrquestradorDeIA (AIOrchestrator) — orquestra chamadas a modelos com cache semântico e rate limit",
      "ServiçoDeCache (CacheService) — cache multinível com chave por hash e rastreamento de economia",
      "ServiçoRAG (RAGService) — recuperação aumentada por geração com embeddings e filtros por projeto e tipo",
      "PipelineRAG (RagPipelineService) — pipeline de indexação e extração em fases com estado no Redis",
      "MemóriaDeBase (CodebaseMemoryService) — memória contínua da base de código com detecção de mudanças",
      "GeradorDeBacklog (BacklogGeneratorService) — gera épicos de backlog a partir de dados de entrevistas",
      "GeradorDeContexto (ContextGenerator) — compõe contexto de projeto via mixins especializados (Mixin pattern)",
      "Watchdog — agente autônomo de ciclos periódicos de enriquecimento de wiki e geração de cards",
      "ServiçoDeFolderOrbit (OrbitFolderService) — gerencia estrutura de diretórios satellite com proteção contra remoção",
      "GeradorDePrompt (PromptGenerator) — gera prompts contextualizados com specs filtradas por relevância",
      "CartãoHierárquico (HierarchicalCard) — card de backlog organizado em épicos e histórias por domínio"
    ],
    "insights": "A análise revela uma plataforma de 'meta-desenvolvimento' onde a IA não apenas executa tarefas, mas gera a própria estrutura de governança do projeto. A arquitetura se organiza em quatro camadas ortogonais: (1) Camada de Controle de Execução — nós utilitários (cost_guard, rate_limiter, cache, RAG, prompt_transformer) que interceptam cada chamada de IA em pré/pós processamento; (2) Camada de Memória Contínua — RAG pipeline em fases + detecção de mudanças por hash + memória de codebase, criando uma 'consciência' do código-fonte; (3) Camada de Geração Autônoma — watchdog com ciclos automáticos gerando wiki, cards de regras e épicos sem intervenção humana; (4) Camada de Meta-Código — OrchestratorGenerator que escreve orquestradores de código dinamicamente validados por stack. O padrão Mixin extensivo em ContextGenerator (CardActivatorMixin, BusinessRulesMixin, DraftGeneratorMixin, ContextInterviewMixin) indica composição modular intencional. A presença de BudgetManager, CostGuard e execute_task_with_budget revela forte preocupação econômica com o custo de tokens — o sistema é projetado para operar continuamente com controle financeiro granular. O uso de Redis como estado de pipeline e a estrutura satellite de diretórios protegidos sugerem uma arquitetura resiliente a falhas com recuperação de estado entre reinicializações."
  }
}

---

TAREFA: Consolide TODAS as análises acima e gere o resultado final.

IMPORTANTE:
1. Leia TODAS as análises das fases anteriores
2. Combine e deduplicar regras de negócio
3. Gere um título que reflita o DOMÍNIO do negócio (não a tecnologia)
4. Escreva um contexto de entrevista com 200+ palavras
5. Liste funcionalidades específicas e detalhadas

Responda em JSON válido.
IDIOMA OBRIGATÓRIO: TODO o conteúdo DEVE ser em português brasileiro. Título, regras, features, entidades - TUDO em português. NUNCA escreva em ingles.

## Response

```json
{
  "suggested_title": "Orbit - Plataforma de Meta-Desenvolvimento Assistido por IA com Orquestração, Governança de Contratos e Memória Contínua de Código",
  "business_rules": [
    "Regra 1: Contratos possuem variáveis obrigatórias e opcionais que devem ser validadas antes da renderização — execuções com dados incompletos são bloqueadas",
    "Regra 2: A validação de variáveis de contrato suporta múltiplos tipos: esquema JSON, regex, verificação semântica, tamanho e campos obrigatórios",
    "Regra 3: Contratos são organizados por domínio, categoria e tipo de uso, permitindo segmentação, governança e filtragem por finalidade",
    "Regra 4: Modelos de IA possuem chaves de API que devem ser mascaradas ao serem exibidas na interface, garantindo segurança de credenciais",
    "Regra 5: Modelos de IA podem ser ativados ou desativados individualmente via toggle e são classificados por tipo de uso (usage_type) para roteamento especializado",
    "Regra 6: O guardião de custos (cost_guard) bloqueia execuções de IA automaticamente quando o orçamento do projeto é excedido, com cálculo de custo real em USD a partir dos tokens consumidos",
    "Regra 7: O cache semântico reutiliza resultados de IA com limiar de similaridade de 0.95, evitando chamadas redundantes e rastreando economia gerada",
    "Regra 8: O serviço RAG só retorna contexto com similaridade acima de 0.70 em relação à consulta, garantindo relevância mínima do contexto recuperado",
    "Regra 9: Jobs assíncronos possuem ciclo de vida com status e prioridades configuráveis — o resultado só é disponibilizado ao cliente quando status=completed",
    "Regra 10: Tarefas são executadas com até 3 tentativas automáticas de validação e regeneração de conteúdo de IA antes de serem consideradas falhas",
    "Regra 11: Projetos em status 'draft' não permitem ativação de épicos sugeridos — somente projetos com status 'active' podem ativar épicos",
    "Regra 12: A ativação de um épico sugerido exige que o pipeline RAG tenha processado os arquivos do projeto previamente (pré-condição obrigatória)",
    "Regra 13: O pipeline RAG é organizado em fases sequenciais obrigatórias: fase 1 (indexação de arquivos) e fase 2 (extração de regras) — o estado é persistido no Redis para retomada em caso de falha",
    "Regra 14: Projetos possuem limite máximo de specs (cap de 50) e de padrões arquiteturais descobertos por projeto",
    "Regra 15: Padrões estáticos de código só são aceitos quando a confiança de detecção supera o limiar de 0.75",
    "Regra 16: O watchdog limita o número de cards gerados por ciclo (MAX_CARDS_PER_CYCLE) com cooldowns distintos para estados idle, erro e batch",
    "Regra 17: Entrevistas devem estar no modo correto e possuir mensagens suficientes para permitir geração de contexto de projeto e épicos de backlog",
    "Regra 18: A geração de backlog usa no máximo 15 regras de negócio como contexto para limitar o escopo e custo de geração",
    "Regra 19: Regras de negócio são classificadas em hierarquia (nível épico ou história) antes de gerar cards com critérios de aceitação automáticos",
    "Regra 20: Orquestradores de código gerados dinamicamente têm a sintaxe validada antes de serem aceitos pelo sistema",
    "Regra 21: Diretórios satellite são protegidos contra remoção acidental por lista explícita de diretórios protegidos (SATELLITE_PROTECTED_DIRS)",
    "Regra 22: A memória contínua de código detecta mudanças por comparação de hash de arquivo, identificando arquivos novos, modificados e deletados para reindexação seletiva",
    "Regra 23: Prompts são salvos no satellite apenas para tipos de uso específicos (_SAVE_USAGE_TYPES), filtrando execuções internas do pipeline",
    "Regra 24: Specs são filtradas por relevância usando keywords extraídas dinamicamente da conversa do usuário antes de compor o contexto do prompt",
    "Regra 25: O limitador de taxa (rate_limiter) controla a frequência de chamadas à IA por projeto, com espera assíncrona para não bloquear o processo",
    "Regra 26: O sistema de contratos mantém log de alterações (ChangeLogEntry), garantindo auditabilidade e rastreabilidade de todas as mudanças",
    "Regra 27: Tarefas possuem transições de status rastreadas (StatusTransition), garantindo auditabilidade completa do ciclo de vida",
    "Regra 28: Nós utilitários do pipeline são executados em ordem de prioridade pré-definida e podem ser habilitados ou desabilitados individualmente por configuração"
  ],
  "key_features": [
    "Feature 1: Governança de Contratos Inteligentes — cadastro e gerenciamento de contratos com variáveis tipadas, regras de validação múltiplas (JSON schema, regex, semântica), regras de acesso, log de auditoria e versionamento com ChangeLogEntry",
    "Feature 2: Orquestração de Modelos de IA Multi-Provedor — gerenciamento de modelos de IA de múltiplos provedores com ativação/desativação por toggle, mascaramento de chaves de API, classificação por tipo de uso e roteamento automático por finalidade",
    "Feature 3: Pipeline RAG em Fases com Estado Persistido — pipeline de indexação e extração de conhecimento em fases sequenciais (indexação de arquivos → extração de regras), com estado persistido no Redis para retomada resiliente e busca vetorial por similaridade via embeddings Ollama",
    "Feature 4: Memória Contínua de Código com Detecção de Mudanças — monitoramento contínuo da base de código por comparação de hash de arquivo, identificando novos arquivos, modificações e deleções para reindexação seletiva e atribuição de camada semântica",
    "Feature 5: Cache Semântico Multinível com Rastreamento de Economia — cache de resultados de IA com limiar de similaridade configurável (padrão 0.95) para reutilização de chamadas redundantes, com rastreamento de tokens economizados por projeto",
    "Feature 6: Guardião de Custos e Controle de Orçamento por Execução — bloqueio automático de execuções quando orçamento é excedido, cálculo de custo real em USD por tokens consumidos e relatório de economia por projeto",
    "Feature 7: Watchdog Autônomo de Enriquecimento Contínuo — agente com ciclos periódicos que gera automaticamente páginas de wiki, cards de regras de negócio e épicos de backlog sem intervenção humana, com cooldowns distintos por estado (idle, erro, batch)",
    "Feature 8: Geração Automática de Wiki de Projeto — criação de documentação estruturada por projeto com páginas de stack tecnológica, regras de negócio, features identificadas, scan de código e padrões arquiteturais descobertos",
    "Feature 9: Geração Hierárquica de Backlog a partir de Entrevistas — geração de épicos e histórias de usuário a partir de transcrições de entrevistas, com classificação hierárquica de regras de negócio e critérios de aceitação automáticos",
    "Feature 10: Geração Dinâmica de Orquestradores de Código por Stack — criação de código de orquestrador adaptado à stack tecnológica do projeto com validação de sintaxe antes da aceitação pelo sistema",
    "Feature 11: Execução de Tarefas com Validação Automática e Retry — execução de tarefas de IA com até 3 tentativas de validação, regeneração automática de conteúdo em caso de falha e controle granular de orçamento por execução",
    "Feature 12: Descoberta de Padrões Arquiteturais Estáticos — extração automatizada de padrões de código (imports compartilhados, hierarquia de classes, assinaturas de funções) com nível de confiança e limite configurável por projeto",
    "Feature 13: Gestão de Tarefas com Auditoria Completa — gerenciamento de tarefas com prioridade, severidade, tipo de resolução, relacionamentos entre tarefas, comentários, transições de status rastreadas e histórico de auditoria",
    "Feature 14: Pipeline de Pré/Pós Processamento de Chamadas de IA — nós utilitários configuráveis e ordenados por prioridade (rate limiter, cost guard, cache semântico, contexto RAG, transformador de prompt) que interceptam cada chamada de IA",
    "Feature 15: Gerenciamento de Entrevistas e Extração de Contexto — condução de entrevistas estruturadas com validação de completude, extração de contexto de projeto e geração de épicos de backlog a partir do conteúdo da conversa",
    "Feature 16: Exportação de Prompts para Estrutura Satellite — persistência de prompts executados em estrutura de diretórios satellite protegida do projeto, com filtragem por tipo de uso e proteção contra remoção acidental",
    "Feature 17: Log Estruturado em Tempo Real com Streaming — sistema de log por nível e categoria com streaming em tempo real via padrão subscriber/fila assíncrona para monitoramento de execuções",
    "Feature 18: Filtragem de Specs por Relevância Contextual — seleção dinâmica de especificações técnicas relevantes com base em keywords extraídas da conversa do usuário antes de compor o contexto do prompt de IA"
  ],
  "entities": [
    "Projeto (Project): entidade central de agrupamento que contém tarefas, entrevistas, specs, análises, modelos de IA, budget e pipeline RAG associados",
    "Contrato (Contract): template governado de prompt com variáveis, regras de validação, regras de acesso, metadados, configuração de execução e log de auditoria de alterações",
    "VariávelDeContrato (ContractVariable): variável obrigatória ou opcional de um contrato com tipo, restrições e critérios de validação",
    "RegraDeAcesso (AccessRule): define permissões de execução de contrato por usuário, papel ou condição",
    "EntradaDeLogDeAlteração (ChangeLogEntry): registro de auditoria de cada mudança realizada em contratos",
    "ModeloDeIA (AIModel): modelo de inteligência artificial com provedor, tipo de uso, chave de API mascarada, configurações e flag de ativação",
    "JobAssíncrono (AsyncJob): unidade de trabalho assíncrono com status, prioridade, tipo e resultado disponibilizado apenas ao completar",
    "Tarefa (Task): item de trabalho com status, prioridade, severidade, tipo de resolução, comentários, relacionamentos e transições de status rastreadas",
    "TransiçãoDeStatus (StatusTransition): registro histórico de cada mudança de estado de uma tarefa para auditabilidade",
    "RelacionamentoDeTarefa (TaskRelationship): dependência ou associação entre tarefas do mesmo projeto",
    "Entrevista (Interview): sessão estruturada de perguntas e respostas associada a um projeto para extração de contexto e geração de backlog",
    "Prompt (Prompt): template de prompt com variáveis obrigatórias/opcionais e lógica de renderização dinâmica",
    "PáginaDeWiki (WikiPage): página de documentação gerada automaticamente por projeto com slug único e conteúdo estruturado",
    "EstadoDeArquivoRAG (RagFileState): estado de indexação de arquivo com hash, camada semântica e metadados de última indexação",
    "PadrãoEstático (StaticPattern): padrão arquitetural extraído do código com tipo, descrição e nível de confiança",
    "GeradorDeOrquestrador (OrchestratorGenerator): gerador de código de orquestrador adaptado por stack com validação de sintaxe",
    "GuardiãoDeCustos (CostGuard): controla orçamento de execuções e bloqueia chamadas de IA quando o limite financeiro é excedido",
    "CacheSemantico (SemanticCache): cache multinível de resultados de IA indexado por similaridade semântica com rastreamento de economia",
    "PipelineRAG (RagPipelineService): pipeline de indexação e extração de conhecimento em fases sequenciais com estado persistido no Redis",
    "MemóriaDeCódigo (CodebaseMemoryService): serviço de memória contínua da base de código com detecção de mudanças por hash",
    "Watchdog: agente autônomo de enriquecimento contínuo com ciclos periódicos e cooldowns configuráveis por estado",
    "AnáliseDeProjeto (ProjectAnalysis): resultado de análise automatizada do projeto gerado por execução de IA",
    "Spec (Spec): especificação técnica associada ao projeto, usada como contexto em prompts após filtragem por relevância",
    "Commit (Commit): registro de versão rastreado associado ao projeto",
    "SessãoDeChat (ChatSession): sessão de interação conversacional integrada ao sistema",
    "ConfiguraçãoDoSistema (SystemSettings): configurações globais da plataforma incluindo modelos padrão por tipo de uso",
    "CartãoHierárquico (HierarchicalCard): card de backlog organizado em épicos e histórias com critérios de aceitação automáticos"
  ],
  "interview_context": "O Orbit é uma plataforma sofisticada de meta-desenvolvimento assistido por inteligência artificial, projetada para equipes de engenharia de software que desejam automatizar e governar o ciclo completo de desenvolvimento — desde a elicitação de requisitos até a execução de tarefas técnicas com controle financeiro granular. O sistema vai muito além de um simples gerenciador de projetos: ele atua como uma camada de orquestração inteligente que intercede em cada chamada de IA, aplica governança de prompts via contratos versionados, mantém memória contínua da base de código e gera autonomamente documentação, backlog e padrões arquiteturais sem intervenção humana.\n\nA plataforma é estruturada em quatro camadas ortogonais que operam de forma integrada. A primeira é a Camada de Governança de Contratos, onde prompts são tratados como contratos versionados com variáveis tipadas, validadores múltiplos (JSON Schema, regex, semântica), regras de acesso e log de auditoria — garantindo que nenhuma execução de IA ocorra com dados inválidos ou sem autorização. A segunda é a Camada de Controle de Execução, composta por nós utilitários configuráveis que processam cada chamada de IA: um guardião de custos que bloqueia execuções ao exceder orçamento, um cache semântico com limiar de 0.95 de similaridade que evita chamadas redundantes, um limitador de taxa assíncrono e um transformador de prompt. A terceira é a Camada de Memória e Conhecimento, composta pelo pipeline RAG em fases sequenciais (indexação e extração) com estado persistido no Redis, pela memória contínua de código baseada em hash de arquivos e pela descoberta automática de padrões arquiteturais com limiar de confiança. A quarta é a Camada de Geração Autônoma, onde o watchdog executa ciclos periódicos gerando wikis, cards hierárquicos de regras de negócio e épicos de backlog a partir de entrevistas estruturadas — com controle de cooldown e limite de cards por ciclo para não sobrecarregar os modelos de IA.\n\nO público-alvo primário são equipes de desenvolvimento que trabalham em projetos complexos e desejam reduzir o custo cognitivo de documentação, rastreabilidade e geração de backlog, mantendo controle financeiro sobre o uso de modelos de linguagem. O sistema resolve problemas como falta de governança em prompts de IA, custo imprevisível de tokens, ausência de memória contextual do projeto entre sessões e a dificuldade de transformar entrevistas brutas em backlog estruturado com critérios de aceitação.\n\nPontos que precisam de mais esclarecimento incluem: (1) o modelo de multitenancy — se projetos são isolados por organização ou usuário; (2) quais provedores de IA são suportados além do modelo inferido pelo contexto; (3) como funciona o fluxo de aprovação humana dos épicos gerados pelo watchdog; (4) se há interface de usuário completa no frontend Next.js ou se o sistema é predominantemente orientado a API; (5) qual é o ciclo de vida completo de uma entrevista e como ela se conecta ao roadmap do produto."
}
```
