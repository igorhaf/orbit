# memory — 2026-02-21

**Model:** claudio/claude-opus-4-6
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
    "partial_title": "Sistema de Gestão de Projetos com Orquestração de IA e Contratos Inteligentes",
    "business_rules_found": [
      "Contratos possuem variáveis obrigatórias e opcionais que devem ser validadas antes da renderização",
      "Regras de validação de contratos suportam múltiplos tipos: JSON schema, regex, verificação semântica, comprimento e campos obrigatórios",
      "Contratos possuem governança e controle de alterações via changelog",
      "Contratos definem regras de acesso (AccessRule) e restrições (Constraint)",
      "Chaves de API dos modelos de IA são mascaradas antes de serem exibidas",
      "Modelos de IA podem ser ativados/desativados individualmente (toggle)",
      "Modelos de IA são classificados por tipo de uso (usage_type) e podem ser filtrados por esse critério",
      "Jobs assíncronos possuem sistema de prioridades configurável carregado externamente",
      "Jobs assíncronos seguem ciclo de vida com status que termina em 'completed' quando o cliente recebe o resultado",
      "Tarefas possuem níveis de prioridade, severidade e tipo de resolução definidos",
      "Tarefas suportam transições de status controladas (status_transition)",
      "Prompts possuem variáveis que devem ser validadas antes da renderização, com erro específico para variáveis inválidas",
      "Apenas modelos de IA ativos são retornados por padrão ao filtrar por tipo de uso"
    ],
    "features_found": [
      "Gestão de contratos inteligentes com renderização, validação e governança",
      "Cadastro e gerenciamento de modelos de IA com múltiplos provedores",
      "Sistema de orquestração de IA com verificação de status",
      "Execução de jobs assíncronos com fila priorizada",
      "Gestão de tarefas com relacionamentos, comentários e resultados",
      "Sistema de templates de prompts com variáveis e validação",
      "Gestão de projetos com análise automatizada por IA",
      "Sessões de chat integradas ao sistema",
      "Rastreamento de commits vinculados a projetos",
      "Sistema de entrevistas associado a projetos",
      "Gestão de especificações (specs) de projeto",
      "Configurações globais do sistema",
      "Interface visual com badges informativos para modelos de IA (custo, tokens, latência)"
    ],
    "entities_found": [
      "Contrato (Contract) - com metadados, variáveis, regras, validadores e governança",
      "Job Assíncrono (AsyncJob) - com status, prioridade e tipo",
      "Tarefa (Task) - com status, tipo de item, prioridade, severidade e resolução",
      "Projeto (Project)",
      "Entrevista (Interview)",
      "Prompt/Template de Prompt",
      "Resultado de Tarefa (TaskResult)",
      "Relacionamento entre Tarefas (TaskRelationship)",
      "Comentário de Tarefa (TaskComment)",
      "Transição de Status (StatusTransition)",
      "Sessão de Chat (ChatSession)",
      "Commit",
      "Modelo de IA (AIModel) - com provedor, tipo de uso e configurações",
      "Configurações do Sistema (SystemSettings)",
      "Especificação (Spec)",
      "Análise de Projeto (ProjectAnalysis)",
      "Execução de IA (AIExecution)",
      "Regra de Validação (ValidationRule)",
      "Validador (Validator)",
      "Registro de Alteração (ChangeLogEntry)"
    ],
    "insights": "O sistema Orbit é uma plataforma de gestão de projetos de software potencializada por IA. A arquitetura revela três pilares principais: (1) Gestão de projetos com tarefas hierárquicas que possuem relacionamentos entre si, transições de status controladas e rastreamento de commits; (2) Orquestração de múltiplos modelos de IA com suporte a diferentes provedores e tipos de uso, execução assíncrona via fila priorizada, e controle de custos/tokens/latência; (3) Sistema de contratos e prompts inteligentes com governança, validação multi-camada e renderização dinâmica. O modelo de domínio sugere um fluxo onde projetos passam por análise automatizada por IA, gerando tarefas que são executadas e rastreadas. A entidade TaskRelationship indica dependências entre tarefas, enquanto StatusTransition sugere um workflow controlado por máquina de estados. A separação entre Contract e Prompt indica dois níveis de abstração para interação com IA — contratos com regras de negócio rígidas e prompts mais flexíveis para geração de conteúdo."
  },
  "logic": {
    "partial_title": "Sistema de Gestão de Projetos com Orquestração de IA e Contratos Inteligentes",
    "business_rules_found": [
      "Nós utilitários possuem ordem de pré-processamento definida (rate_limiter, cost_guard, cache, rag_context, prompt_transformer) e só executam se estiverem habilitados",
      "Cost Guard bloqueia execuções quando o orçamento é excedido, atuando como barreira financeira antes de chamadas à IA",
      "Rate Limiter controla a taxa de requisições por modelo de IA via semáforo de concorrência",
      "Validação de saída da IA é automática com até 3 tentativas de regeneração em caso de falha",
      "Cache semântico utiliza limiar de similaridade de 0.95 para reutilizar respostas anteriores da IA",
      "RAG (Retrieval Augmented Generation) utiliza limiar de similaridade de 0.7 para recuperação de contexto relevante",
      "Projetos possuem limite máximo de 50 especificações (MAX_SPECS_PER_PROJECT), e o número efetivo de padrões é calculado considerando esse teto",
      "Projetos em status 'draft' possuem tratamento diferenciado no fluxo de processamento de memória",
      "Ativação de épicos sugeridos exige que o projeto tenha status 'active' e que o pipeline RAG tenha processado arquivos",
      "Entrevistas no modo contexto devem ter mensagens suficientes antes de gerar contexto, com validações múltiplas em cascata",
      "Geração de backlog a partir de entrevistas exige que a entrevista possua dados de conversa válidos",
      "Épicos e cards passam por validação obrigatória antes de serem persistidos no pipeline de geração",
      "Código de orquestradores gerados passa por validação sintática via AST antes de ser aceito",
      "Execução de tarefas com orçamento (budget) controla custos calculando custo total em USD por tokens consumidos",
      "Serviço RAG contínuo detecta mudanças no filesystem via hash de arquivos, identificando novos, modificados e deletados",
      "Diretórios satélite (.orbit) são protegidos e não podem ser removidos acidentalmente",
      "Slugs de páginas wiki são únicos por projeto, com mecanismo de deduplicação automática",
      "Regras de negócio extraídas da base de código são limitadas a 15 por contexto na geração de backlog",
      "Logs de prompt só são salvos para tipos de uso específicos (_SAVE_USAGE_TYPES)"
    ],
    "features_found": [
      "Pipeline de nós utilitários com pré e pós-processamento configurável (rate limiter, cost guard, cache, RAG, transformador de prompt, validador)",
      "Geração automática de wiki do projeto com páginas de stack, regras de negócio, funcionalidades, scan e padrões arquiteturais",
      "Entrevistas unificadas com construção de prompt contextual e deduplicação de perguntas",
      "Sistema de logs em console com níveis, categorias, persistência em arquivo e assinatura pub/sub em tempo real",
      "Serviço de memória de codebase com indexação, detecção de stack e integração RAG",
      "Orquestrador de IA com cache semântico, rate limiting e broadcast via WebSocket",
      "Pipeline RAG com fases controladas por estado (indexação de arquivos com camadas semânticas)",
      "Cache multinível com rastreamento de economia e estatísticas de hit/miss",
      "Geração de épicos e cards sugeridos a partir de contexto de entrevista",
      "Ativação de itens sugeridos com validação e reestruturação de conteúdo",
      "Geração de backlog a partir de entrevistas com contexto de regras de negócio",
      "Serviço RAG contínuo com varredura de mudanças no filesystem e extração incremental",
      "Descoberta de padrões estáticos na base de código (imports, hierarquia de classes, assinaturas de funções)",
      "Pipeline de cards hierárquicos com épicos de domínio e validação automática",
      "Execução de tarefas com controle de orçamento e tentativas automáticas de revalidação",
      "Geração de orquestradores customizados com validação sintática e convenções de stack",
      "Estrutura de pastas satélite (.orbit) com exportação de prompts e resultados",
      "Watchdog com ciclos de processamento e cooldowns configuráveis (ciclo, idle, erro, batch)",
      "Geração de regras de negócio com classificação hierárquica e critérios de aceitação"
    ],
    "entities_found": [
      "Nó Utilitário (UtilityNode) - com tipo, configuração e estado habilitado/desabilitado",
      "Página Wiki - com slug único, título e conteúdo gerado automaticamente",
      "Entrada de Log (ConsoleLogEntry) - com nível, categoria e dados estruturados",
      "Estado de Arquivo RAG (RagFileState) - com hash, camada semântica e status de mudança",
      "Entrada de Cache (CacheEntry) - com nível de cache e dados serializados",
      "Padrão Estático (StaticPattern) - com confiança, categoria e grupo",
      "Card Hierárquico - com domínio, épico pai e validação",
      "Orquestrador Gerado - com template, variáveis de stack e validação sintática",
      "Pasta Satélite (.orbit) - com diretórios protegidos e versionamento de schema",
      "Contexto de Entrevista - com resumo de conversa e contexto de memória",
      "Regra de Negócio (BusinessRule) - com classificação hierárquica e critérios de aceitação",
      "Serviço de Descoberta de Padrões - com pipeline em estágios e extração estática/IA",
      "Resultado de Execução de Tarefa - com custo, tokens, tentativas e validação",
      "Ciclo de Watchdog - com prioridades, cooldowns e enriquecimento wiki"
    ],
    "insights": "Esta camada de serviços revela um sistema sofisticado de governança de custos e qualidade na orquestração de IA. O pipeline de nós utilitários implementa um padrão Chain of Responsibility com pré/pós-processamento, onde Cost Guard e Rate Limiter atuam como guardiões financeiros e de capacidade. O cache semântico com limiar de 0.95 evita chamadas redundantes à IA, enquanto o RAG com limiar de 0.7 enriquece contexto de forma mais flexível. A arquitetura de memória de codebase é particularmente notável: combina varredura contínua de filesystem (via hash), extração de padrões estáticos (imports, hierarquias, assinaturas) e descoberta assistida por IA, alimentando um pipeline RAG em fases. O fluxo de geração de cards hierárquicos conecta entrevistas → contexto → épicos sugeridos → ativação, com validações em cada etapa. O watchdog com múltiplos cooldowns (ciclo, idle, erro, batch) sugere um processamento assíncrono resiliente que equilibra throughput e proteção contra falhas. A separação entre execução simples e execução com orçamento (execute_task vs execute_task_with_budget) indica controle granular de custos por tarefa."
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
  "suggested_title": "Orbit - Plataforma de Gestão de Projetos com Orquestração de IA e Governança de Contratos",
  "business_rules": [
    "Contratos possuem variáveis obrigatórias e opcionais que devem ser validadas antes da renderização, com suporte a múltiplos tipos de validação (JSON schema, regex, verificação semântica, comprimento e campos obrigatórios)",
    "Contratos possuem governança e controle de alterações via changelog, com regras de acesso (AccessRule) e restrições (Constraint) definidas",
    "Chaves de API dos modelos de IA são mascaradas antes de serem exibidas ao usuário, garantindo segurança de credenciais",
    "Modelos de IA podem ser ativados/desativados individualmente e apenas modelos ativos são retornados por padrão ao filtrar por tipo de uso",
    "Jobs assíncronos seguem ciclo de vida com status que termina em 'completed' quando o cliente recebe o resultado, com sistema de prioridades configurável carregado externamente",
    "Tarefas possuem níveis de prioridade, severidade e tipo de resolução definidos, com transições de status controladas por máquina de estados",
    "Prompts possuem variáveis que devem ser validadas antes da renderização, com erro específico para variáveis inválidas",
    "Cost Guard bloqueia execuções quando o orçamento é excedido, atuando como barreira financeira antes de chamadas à IA",
    "Rate Limiter controla a taxa de requisições por modelo de IA via semáforo de concorrência, evitando sobrecarga dos provedores",
    "Validação de saída da IA é automática com até 3 tentativas de regeneração em caso de falha de validação",
    "Cache semântico utiliza limiar de similaridade de 0.95 para reutilizar respostas anteriores da IA, evitando chamadas redundantes",
    "RAG (Retrieval Augmented Generation) utiliza limiar de similaridade de 0.7 para recuperação de contexto relevante a partir da base de código",
    "Projetos possuem limite máximo de 50 especificações (MAX_SPECS_PER_PROJECT) e o número efetivo de padrões é calculado considerando esse teto",
    "Ativação de épicos sugeridos exige que o projeto tenha status 'active' e que o pipeline RAG tenha processado arquivos previamente",
    "Entrevistas no modo contexto devem ter mensagens suficientes antes de gerar contexto, com validações múltiplas em cascata",
    "Geração de backlog a partir de entrevistas exige que a entrevista possua dados de conversa válidos e regras de negócio são limitadas a 15 por contexto",
    "Épicos e cards passam por validação obrigatória antes de serem persistidos, e código de orquestradores gerados passa por validação sintática via AST",
    "Execução de tarefas com orçamento controla custos calculando custo total em USD por tokens consumidos",
    "Serviço RAG contínuo detecta mudanças no filesystem via hash de arquivos, identificando novos, modificados e deletados incrementalmente",
    "Diretórios satélite (.orbit) são protegidos e não podem ser removidos acidentalmente, garantindo integridade dos dados do projeto",
    "Slugs de páginas wiki são únicos por projeto, com mecanismo de deduplicação automática para evitar conflitos",
    "Nós utilitários possuem ordem de pré-processamento definida (rate_limiter → cost_guard → cache → rag_context → prompt_transformer) e só executam se estiverem habilitados",
    "Logs de prompt só são salvos para tipos de uso específicos, controlando o volume de dados persistidos"
  ],
  "key_features": [
    "Gestão de contratos inteligentes com renderização dinâmica, validação multi-camada, governança de alterações e controle de acesso",
    "Cadastro e gerenciamento de modelos de IA com suporte a múltiplos provedores, tipos de uso, toggle de ativação e badges informativos (custo, tokens, latência)",
    "Orquestrador de IA com pipeline de nós utilitários configurável incluindo cache semântico, rate limiting, controle de custos e broadcast via WebSocket",
    "Execução de jobs assíncronos com fila priorizada e ciclo de vida controlado por status",
    "Gestão de tarefas hierárquicas com relacionamentos entre tarefas, comentários, resultados, transições de status controladas por máquina de estados e controle de orçamento por tarefa",
    "Sistema de templates de prompts com variáveis dinâmicas e validação antes da renderização",
    "Gestão de projetos com análise automatizada por IA, rastreamento de commits e especificações técnicas",
    "Entrevistas unificadas com construção de prompt contextual, deduplicação de perguntas e geração de backlog a partir de conversa",
    "Geração automática de wiki do projeto com páginas de stack, regras de negócio, funcionalidades, scan e padrões arquiteturais",
    "Pipeline RAG com fases controladas por estado, indexação incremental de arquivos e extração de camadas semânticas",
    "Cache multinível com rastreamento de economia e estatísticas detalhadas de hit/miss",
    "Geração de épicos e cards sugeridos a partir de contexto de entrevista com ativação, validação e reestruturação de conteúdo",
    "Serviço de memória de codebase com indexação contínua, detecção automática de stack e integração RAG",
    "Descoberta de padrões estáticos na base de código (imports, hierarquia de classes, assinaturas de funções) combinada com descoberta assistida por IA",
    "Sistema de logs em console com níveis, categorias, persistência em arquivo e assinatura pub/sub em tempo real",
    "Watchdog com ciclos de processamento e cooldowns configuráveis (ciclo, idle, erro, batch) para processamento assíncrono resiliente",
    "Estrutura de pastas satélite (.orbit) com exportação de prompts e resultados, versionamento de schema e proteção de diretórios",
    "Sessões de chat integradas ao sistema para interação em tempo real",
    "Geração de orquestradores customizados com validação sintática e convenções específicas por stack tecnológica",
    "Geração de regras de negócio com classificação hierárquica e critérios de aceitação automatizados"
  ],
  "entities": [
    "Projeto (Project) - entidade central que agrupa tarefas, entrevistas, especificações, commits e análises de IA",
    "Tarefa (Task) - unidade de trabalho com status, tipo de item, prioridade, severidade, resolução e transições controladas",
    "Contrato (Contract) - modelo inteligente com metadados, variáveis, regras de validação, validadores e governança de alterações",
    "Modelo de IA (AIModel) - representação de um modelo de inteligência artificial com provedor, tipo de uso, configurações e estado ativo/inativo",
    "Job Assíncrono (AsyncJob) - unidade de execução assíncrona com status, prioridade e tipo",
    "Entrevista (Interview) - sessão de entrevista associada a projetos com contexto de conversa e geração de backlog",
    "Prompt/Template de Prompt - modelo de texto com variáveis dinâmicas e validação para interação com IA",
    "Épico (Epic) - agrupador de cards/tarefas com domínio e validação, podendo ser sugerido ou ativado",
    "Card Hierárquico - item de backlog vinculado a um épico pai com domínio e validação automática",
    "Resultado de Tarefa (TaskResult) - saída de execução com custo, tokens consumidos, tentativas e status de validação",
    "Relacionamento entre Tarefas (TaskRelationship) - dependência ou vínculo entre tarefas do projeto",
    "Comentário de Tarefa (TaskComment) - anotação associada a uma tarefa específica",
    "Transição de Status (StatusTransition) - registro de mudança de estado controlada por máquina de estados",
    "Sessão de Chat (ChatSession) - sessão de comunicação em tempo real integrada ao sistema",
    "Commit - registro de alteração de código vinculado a um projeto",
    "Especificação (Spec) - documento técnico do projeto com limite máximo por projeto",
    "Página Wiki - documento gerado automaticamente com slug único por projeto",
    "Nó Utilitário (UtilityNode) - componente do pipeline de orquestração com tipo, configuração e estado habilitado/desabilitado",
    "Entrada de Cache (CacheEntry) - registro de resposta cacheada com nível e dados serializados",
    "Estado de Arquivo RAG (RagFileState) - registro de arquivo indexado com hash, camada semântica e status de mudança",
    "Padrão Estático (StaticPattern) - padrão descoberto na base de código com confiança, categoria e grupo",
    "Execução de IA (AIExecution) - registro de chamada ao modelo de IA com métricas de custo e desempenho",
    "Análise de Projeto (ProjectAnalysis) - resultado de análise automatizada por IA sobre o projeto",
    "Regra de Negócio (BusinessRule) - regra extraída com classificação hierárquica e critérios de aceitação",
    "Regra de Validação (ValidationRule) - regra aplicada a contratos com tipo e configuração específica",
    "Registro de Alteração (ChangeLogEntry) - entrada de histórico de modificações em contratos",
    "Configurações do Sistema (SystemSettings) - parâmetros globais de configuração da plataforma",
    "Orquestrador Gerado - template de orquestração customizado com variáveis de stack e validação sintática",
    "Ciclo de Watchdog - unidade de processamento assíncrono com prioridades e cooldowns configuráveis"
  ],
  "interview_context": "O Orbit é uma plataforma sofisticada de gestão de projetos de software potencializada por inteligência artificial, projetada para equipes de desenvolvimento que desejam automatizar e otimizar seus fluxos de trabalho. O sistema opera sobre três pilares fundamentais: gestão de projetos, orquestração de IA e governança de contratos inteligentes.\n\nNo pilar de gestão de projetos, o Orbit permite criar e gerenciar projetos completos com tarefas hierárquicas que possuem relacionamentos de dependência entre si, transições de status controladas por máquina de estados, rastreamento de commits vinculados e especificações técnicas detalhadas. As tarefas possuem atributos ricos como prioridade, severidade e tipo de resolução, permitindo um controle granular do trabalho.\n\nO pilar de orquestração de IA é particularmente notável. O sistema suporta múltiplos provedores e modelos de IA, gerenciados através de um pipeline de nós utilitários configurável. Este pipeline implementa controles críticos: Rate Limiter para evitar sobrecarga, Cost Guard como barreira financeira que bloqueia execuções quando o orçamento é excedido, cache semântico com limiar de 0.95 para reutilizar respostas similares, e RAG (Retrieval Augmented Generation) com limiar de 0.7 para enriquecer prompts com contexto relevante da base de código. A validação de saída é automática com até 3 tentativas de regeneração.\n\nO terceiro pilar envolve contratos inteligentes com governança de alterações, validação multi-camada (JSON schema, regex, verificação semântica) e controle de acesso. Diferente dos prompts que são mais flexíveis, os contratos representam regras de negócio rígidas para interação com IA.\n\nO sistema inclui funcionalidades avançadas como entrevistas automatizadas que geram backlog de épicos e cards, wiki auto-gerada por projeto, serviço RAG contínuo que monitora mudanças no filesystem via hash, descoberta de padrões na base de código (imports, hierarquias, assinaturas) e um watchdog resiliente com múltiplos cooldowns. A estrutura de pastas satélite (.orbit) armazena dados do projeto de forma protegida.\n\nO público-alvo são equipes de desenvolvimento e gestores de projetos de software que buscam uma ferramenta que integre gestão ágil com capacidades avançadas de IA para análise de código, geração de documentação e automação de tarefas. Pontos que necessitam maior esclarecimento incluem: o modelo de permissões e papéis de usuários, integrações externas com ferramentas de terceiros (Jira, GitHub, etc.), o fluxo completo de onboarding de um novo projeto, como funciona a precificação e controle de custos por equipe/organização, e se existe suporte a múltiplos repositórios por projeto."
}
```
