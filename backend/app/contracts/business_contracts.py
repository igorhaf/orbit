"""
Business Contracts - Auto-generated from YAML contracts.
Source: backend/app/contracts/business/ (8 files)
"""
from typing import TypedDict, List, Dict, Any, Optional


# --- business/card_hierarchy.yaml ---

BUSINESS_CARD_HIERARCHY_SYSTEM = """"""

BUSINESS_CARD_HIERARCHY_USER = """"""

BUSINESS_CARD_HIERARCHY_SEMANTIC_MAP = {'N1': 'Epic - Top-level feature or initiative', 'N2': 'Story - User-focused deliverable within an Epic', 'N3': 'Task - Technical work item within a Story', 'P1': 'Activation - Transform suggested/draft card to active', 'P2': 'Draft Generation - AI creates child drafts on parent activation', 'P3': 'Content Generation - AI generates full content for card', 'D1': 'CardData - title, description, generated_prompt, semantic_map', 'D2': 'HierarchyLevel - epic (0), story (1), task (2)', 'D3': 'WorkflowState - suggested, draft, open, in_progress, done', 'C1': 'Epic generates 15-20 Story drafts on activation', 'C2': 'Story generates 5-8 Task drafts on activation', 'C3': 'Task is leaf node - generates content only', 'AC1': 'Each card level inherits semantic identifiers from parent', 'AC2': 'Draft cards appear with visual indication (opacity, dashed border)', 'AC3': 'Activating a card triggers draft generation for children', 'AC4': 'Generated content uses Semantic References Methodology'}

BUSINESS_CARD_HIERARCHY_RULES = {'validations': [{'id': 'V1', 'description': 'Epic must have project_id', 'expression': 'N1.project_id != null', 'severity': 'error'}, {'id': 'V2', 'description': 'Story must have parent Epic', 'expression': "N2.parent_id != null AND parent.item_type == 'epic'", 'severity': 'error'}, {'id': 'V3', 'description': 'Task must have parent Story', 'expression': "N3.parent_id != null AND parent.item_type == 'story'", 'severity': 'error'}], 'constraints': [{'id': 'C1', 'description': 'Hierarchy is strictly 3 levels deep', 'applies_to': ['N1', 'N2', 'N3'], 'condition': 'max_depth == 3 (epic -> story -> task)'}, {'id': 'C2', 'description': 'Suggested cards cannot have children', 'applies_to': ['N1', 'N2', 'N3'], 'condition': "IF workflow_state == 'suggested' THEN cannot generate children"}, {'id': 'C3', 'description': 'Children counts on activation', 'applies_to': ['N1', 'N2'], 'condition': 'Epic -> 15-20 Stories, Story -> 5-8 Tasks'}, {'id': 'C4', 'description': 'Semantic identifiers must be inherited', 'applies_to': ['N1', 'N2', 'N3'], 'condition': 'Child.semantic_map includes Parent.semantic_map identifiers'}], 'access_control': [{'id': 'AC1', 'description': 'User can activate suggested cards', 'roles': ['user', 'admin'], 'action': 'execute'}, {'id': 'AC2', 'description': 'User can reject suggested cards', 'roles': ['user', 'admin'], 'action': 'delete'}]}

BUSINESS_CARD_HIERARCHY_GOVERNANCE = {'status': 'active', 'owner': 'ORBIT Core Team', 'effective_date': '2026-02-04', 'change_log': [{'version': 1, 'date': '2026-02-04', 'author': 'Claude', 'changes': 'Initial version documenting card hierarchy rules'}]}


# --- business/generation_counts.yaml ---

BUSINESS_GENERATION_COUNTS_SYSTEM = """"""

BUSINESS_GENERATION_COUNTS_USER = """"""

BUSINESS_GENERATION_COUNTS_DATA = {'default_children_count': {'epic': 15, 'story': 8}, 'children_range': {'epic': {'min': 15, 'max': 20}, 'story': {'min': 5, 'max': 8}}, 'max_cards_per_cycle': 10, 'max_enrich_per_cycle': 2}

BUSINESS_GENERATION_COUNTS_RULES = {'constraints': [{'id': 'C1', 'description': 'Task e no folha - nenhum filho e gerado', 'applies_to': ['task'], 'condition': 'children_count == 0'}]}

BUSINESS_GENERATION_COUNTS_GOVERNANCE = {'status': 'active', 'owner': 'ORBIT Core Team', 'effective_date': '2026-02-13', 'change_log': [{'version': 1, 'date': '2026-02-13', 'author': 'Claude', 'changes': 'Externalizado do context_generator.py e watchdog.py'}]}


# --- business/job_priorities.yaml ---

BUSINESS_JOB_PRIORITIES_SYSTEM = """"""

BUSINESS_JOB_PRIORITIES_USER = """"""

BUSINESS_JOB_PRIORITIES_DATA = {'priority_levels': {'CRITICAL': 10, 'HIGH': 7, 'NORMAL': 5, 'LOW': 3}, 'priorities': {'interview_question': 10, 'interview_message': 10, 'chat_message': 10, 'context_generation': 7, 'project_title': 7, 'project_pipeline': 7, 'memory_scan': 5, 'commit_generation': 5, 'task_execution': 5, 'suggested_epics': 5, 'cards_from_memory': 5, 'description_generation': 5, 'semantic_prompt': 5, 'children_generation': 3, 'epic_activation': 3, 'story_activation': 3, 'task_activation': 3, 'backlog_generation': 3, 'task_generation': 3, 'batch_execution': 3, 'rag_continuous_scan': 3}}

BUSINESS_JOB_PRIORITIES_RULES = {'constraints': [{'id': 'C1', 'description': 'Jobs interativos (usuário aguardando) devem ser CRITICO ou ALTO', 'applies_to': ['interview_question', 'interview_message', 'context_generation'], 'condition': 'priority >= 7'}, {'id': 'C2', 'description': 'Jobs de segundo plano devem ser BAIXO', 'applies_to': ['rag_continuous_scan', 'backlog_generation'], 'condition': 'priority <= 3'}]}

BUSINESS_JOB_PRIORITIES_GOVERNANCE = {'status': 'active', 'owner': 'ORBIT Core Team', 'effective_date': '2026-02-13', 'change_log': [{'version': 1, 'date': '2026-02-13', 'author': 'Claude', 'changes': 'Externalizado do async_job.py - JOB_TYPE_DEFAULT_PRIORITY hardcoded'}]}


# --- business/memory_scan.yaml ---

BUSINESS_MEMORY_SCAN_SYSTEM = """"""

BUSINESS_MEMORY_SCAN_USER = """"""

BUSINESS_MEMORY_SCAN_SEMANTIC_MAP = {'N1': 'Codebase - Pasta de código-fonte sendo analisada', 'N2': 'CodeSample - Conteúdo de arquivo individual para análise', 'N3': 'StackInfo - Stack tecnologica detectada', 'N4': 'BusinessRule - Regra extraida do código', 'N5': 'SuggestedTitle - Título do projeto gerado por IA', 'P1': 'Detecção de Stack - Identificar frameworks e linguagens', 'P2': 'Extracao de Arquivos - Selecionar arquivos representativos', 'P3': 'Análise Multi-fase - Analisar código em fases focadas', 'P4': 'Consolidacao - Unificar resultados das fases no output final', 'P5': 'Indexação RAG - Armazenar arquivos para recuperação', 'D1': 'ScanDepthConfig - configurações quick/normal/deep', 'D2': 'PhaseResult - titulo_parcial, regras, features, entidades', 'D3': 'ConsolidatedResult - título final, regras, features, contexto', 'C1': 'Modo rápido: 30 arquivos, 2 fases', 'C2': 'Modo normal: 100 arquivos, 4 fases', 'C3': 'Modo profundo: TODOS os arquivos, N fases (15 arquivos cada)', 'C4': 'Cada fase salva prompt no banco de dados para visibilidade', 'AC1': 'Usuário pode selecionar profundidade do scan antes de escanear', 'AC2': 'IA sugere título do projeto baseado no domínio, não na tecnologia', 'AC3': 'Regras de negocio são extraidas e armazenadas no RAG', 'AC4': 'Todos os prompts aparecem na página /prompts'}

BUSINESS_MEMORY_SCAN_RULES = {'validations': [{'id': 'V1', 'description': 'code_path deve existir e ser um diretório', 'expression': 'N1.path.exists() AND N1.path.is_dir()', 'severity': 'error'}, {'id': 'V2', 'description': 'Profundidade do scan deve ser válida', 'expression': "scan_depth IN ['quick', 'normal', 'deep']", 'severity': 'error'}, {'id': 'V3', 'description': 'Pelo menos um código deve ser extraido', 'expression': 'code_samples.length > 0', 'severity': 'warning'}], 'constraints': [{'id': 'C1', 'description': 'Configurações de profundidade do scan', 'applies_to': ['D1'], 'condition': 'quick: {max_files: 30, max_content: 5KB, phases: 2}\nnormal: {max_files: 100, max_content: 10KB, phases: 4}\ndeep: {max_files: unlimited, max_content: 20KB, phases: dynamic}\n'}, {'id': 'C2', 'description': 'Ordem das fases no modo normal', 'applies_to': ['P3'], 'condition': 'documentação -> domínio -> lógica -> consolidacao'}, {'id': 'C3', 'description': 'Priorizacao de arquivos', 'applies_to': ['P2'], 'condition': '1. README e documentação\n2. Arquivos de configuração (package.json, etc.)\n3. Migrations (maior prioridade para regras de negocio)\n4. Models/Entidades\n5. Services/UseCases\n6. Controllers/Handlers\n7. Validators/Requests\n'}, {'id': 'C4', 'description': 'project_id deve ser passado para salvar prompts', 'applies_to': ['P3', 'P4'], 'condition': 'orchestrator.execute() deve receber project_id'}], 'access_control': [{'id': 'AC1', 'description': 'Usuário pode disparar scan de memória', 'roles': ['user', 'admin'], 'action': 'execute'}]}

BUSINESS_MEMORY_SCAN_GOVERNANCE = {'status': 'active', 'owner': 'ORBIT Core Team', 'effective_date': '2026-02-04', 'change_log': [{'version': 1, 'date': '2026-02-04', 'author': 'Claude', 'changes': 'Versão inicial documentando regras de scan de memória'}]}


# --- business/project_creation.yaml ---

BUSINESS_PROJECT_CREATION_SYSTEM = """"""

BUSINESS_PROJECT_CREATION_USER = """"""

BUSINESS_PROJECT_CREATION_SEMANTIC_MAP = {'N1': 'Projeto - A entidade principal sendo criada', 'N2': 'Usuário - Pessoa criando o projeto', 'N3': 'CodePath - Caminho para pasta de codebase existente', 'N4': 'Contexto - Contexto do projeto a partir de entrevista', 'N5': 'EpicosSugeridos - Epicos iniciais gerados por IA', 'P1': 'Fluxo do Wizard - Wizard de criação de projeto em 4 passos', 'P2': 'Scan de Memória - Análise do codebase por IA', 'P3': 'Entrevista de Contexto - Coleta de contexto guiada por IA', 'P4': 'Geração de Epicos - Geração automática de epicos sugeridos', 'D1': 'DadosProjeto - nome, code_path, contexto_humano, contexto_semantico', 'D2': 'ResultadoScan - titulo_sugerido, info_stack, regras_negocio, features', 'D3': 'DadosEntrevista - perguntas, respostas, output de contexto', 'C1': 'code_path e OBRIGATÓRIO e IMUTAVEL', 'C2': 'Contexto e TRAVADO apos primeira ativacao de Epico', 'C3': 'Wizards abandonados disparam limpeza automática', 'C4': 'Projeto so existe apos conclusão do wizard', 'AC1': 'Usuário pode selecionar pasta de código existente', 'AC2': 'IA sugere título do projeto a partir da análise do codebase', 'AC3': 'Entrevista de contexto gera saída dupla (humano + semântico)', 'AC4': 'Epicos sugeridos aparecem como rascunhos apos entrevista de contexto'}

BUSINESS_PROJECT_CREATION_RULES = {'validations': [{'id': 'V1', 'description': 'code_path deve apontar para diretório existente', 'expression': 'N3.exists() AND N3.is_directory()', 'severity': 'error'}, {'id': 'V2', 'description': 'Nome do projeto não pode ser vazio', 'expression': 'N1.name.length > 0', 'severity': 'error'}, {'id': 'V3', 'description': 'Contexto deve ser definido antes de criar Epicos', 'expression': 'N4.context_human != null OR N1.context_locked == false', 'severity': 'warning'}], 'constraints': [{'id': 'C1', 'description': 'code_path não pode ser alterado apos criação do projeto', 'applies_to': ['N1', 'N3'], 'condition': 'N3 e imutavel apos N1.created_at'}, {'id': 'C2', 'description': 'Contexto e travado apos primeiro Epico ser ativado', 'applies_to': ['N1', 'N4'], 'condition': 'N1.context_locked == true implica que N4 não pode ser modificado'}, {'id': 'C3', 'description': 'Wizard incompleto dispara limpeza', 'applies_to': ['N1', 'N2'], 'condition': 'Se P1 não foi completado, deletar N1 ao sair da página'}], 'access_control': [{'id': 'AC1', 'description': 'Qualquer usuário pode criar projetos', 'roles': ['user', 'admin'], 'action': 'write'}, {'id': 'AC2', 'description': 'Apenas criador ou admin pode deletar projeto', 'roles': ['creator', 'admin'], 'action': 'delete'}]}

BUSINESS_PROJECT_CREATION_GOVERNANCE = {'status': 'active', 'owner': 'ORBIT Core Team', 'effective_date': '2026-02-04', 'change_log': [{'version': 1, 'date': '2026-02-04', 'author': 'Claude', 'changes': 'Versão inicial documentando regras de criação de projeto'}]}


# --- business/queue_scoring.yaml ---

BUSINESS_QUEUE_SCORING_SYSTEM = """"""

BUSINESS_QUEUE_SCORING_USER = """"""

BUSINESS_QUEUE_SCORING_DATA = {'hierarchy_scores': {'epic': 100, 'story': 75, 'task': 50, 'bug': 60}, 'priority_scores': {'critical': 100, 'high': 80, 'medium': 50, 'low': 25, 'trivial': 10}, 'strategy_weights': {'balanced': {'hierarchy': 0.35, 'priority': 0.3, 'age': 0.1, 'dependency': 0.25}, 'hierarchy_first': {'hierarchy': 0.6, 'priority': 0.2, 'age': 0.05, 'dependency': 0.15}, 'priority_first': {'hierarchy': 0.15, 'priority': 0.6, 'age': 0.1, 'dependency': 0.15}, 'age_first': {'hierarchy': 0.2, 'priority': 0.2, 'age': 0.45, 'dependency': 0.15}, 'dependency_first': {'hierarchy': 0.15, 'priority': 0.2, 'age': 0.05, 'dependency': 0.6}}, 'max_age_days': 100, 'dependency_penalty_per_dep': 20}

BUSINESS_QUEUE_SCORING_RULES = {'constraints': [{'id': 'C1', 'description': 'Todos os pesos de cada estratégia devem somar aproximadamente 1.0', 'applies_to': ['balanced', 'hierarchy_first', 'priority_first', 'age_first', 'dependency_first'], 'condition': 'sum(weights) ~= 1.0'}]}

BUSINESS_QUEUE_SCORING_GOVERNANCE = {'status': 'active', 'owner': 'ORBIT Core Team', 'effective_date': '2026-02-13', 'change_log': [{'version': 1, 'date': '2026-02-13', 'author': 'Claude', 'changes': 'Externalizado do prompt_queue.py - dicts de pontuação hardcoded'}]}


# --- business/semantic_references.yaml ---

BUSINESS_SEMANTIC_REFERENCES_SYSTEM = """## METODOLOGIA DE REFERÊNCIAS SEMÂNTICAS

Esta metodologia permite criar conteúdo estruturado e rastreável usando
identificadores semânticos únicos.

### CATEGORIAS DE IDENTIFICADORES

| Prefixo | Categoria | Descrição | Exemplo |
|---------|-----------|-----------|---------|
| N | Nouns | Entidades, objetos, atores | N1: "Usuário", N2: "Produto" |
| P | Processes | Ações, fluxos, operações | P1: "Autenticação", P2: "Compra" |
| E | Endpoints | APIs, rotas | E1: "/api/users", E2: "/api/products" |
| D | Data | Estruturas de dados | D1: "UserSchema", D2: "OrderData" |
| S | Services | Serviços externos | S1: "Stripe", S2: "SendGrid" |
| C | Constraints | Regras de negócio | C1: "Email único", C2: "Limite 10 itens" |
| AC | Acceptance Criteria | Critérios de aceitação | AC1: "Usuário pode logar" |
| R | Requirements | Requisitos funcionais | R1: "Sistema deve validar CPF" |
| F | Features | Funcionalidades | F1: "Carrinho de compras" |
| M | Modules | Módulos do sistema | M1: "Autenticação", M2: "Pagamentos" |

### REGRAS DE USO

1. **Unicidade**: Cada identificador tem significado único no contexto
2. **Imutabilidade**: Uma vez definido, o significado não muda
3. **Herança**: Cards filhos herdam identificadores do pai
4. **Incremento**: Novos identificadores incrementam do maior existente
5. **Rastreabilidade**: Identificadores permitem rastrear requisitos

### EXEMPLO DE MAPA SEMÂNTICO

```yaml
semantic_map:
  N1: "Usuário do sistema"
  N2: "Produto no catálogo"
  N3: "Carrinho de compras"
  P1: "Processo de checkout"
  P2: "Validação de pagamento"
  D1: "Dados do pedido"
  C1: "Máximo 10 itens por carrinho"
  AC1: "Usuário consegue finalizar compra"
```

### DUAL OUTPUT

O sistema gera dois outputs:
1. **generated_prompt**: Texto com identificadores (N1, P1, etc.)
2. **description**: Texto convertido com significados humanos"""

BUSINESS_SEMANTIC_REFERENCES_USER = """"""

BUSINESS_SEMANTIC_REFERENCES_SEMANTIC_MAP = {'N1': 'Identificador Substantivo - Representa entidades, objetos, atores', 'P1': 'Identificador de Processo - Representa ações, fluxos, operações', 'E1': 'Identificador de Endpoint - Representa endpoints de API', 'D1': 'Identificador de Dados - Representa estruturas de dados, schemas', 'S1': 'Identificador de Serviço - Representa serviços externos, integracoes', 'C1': 'Identificador de Restrição - Representa regras de negocio, validacoes', 'AC1': 'Identificador de Critério de Aceitação - Representa condições de verificação', 'R1': 'Identificador de Requisito - Representa requisitos funcionais', 'F1': 'Identificador de Feature - Representa funcionalidades do produto', 'M1': 'Identificador de Módulo - Representa modulos do sistema', 'N2': 'Mapa Semântico - Dicionario de identificador -> significado', 'N3': 'Prompt Gerado - Saída da IA com identificadores semânticos', 'N4': 'Descrição Humana - Texto convertido com significados', 'P2': 'Atribuicao de Identificadores - IA atribui identificadores unicos', 'P3': 'Conversao Semântica - Converter identificadores para texto humano', 'P4': 'Heranca - Cards filhos herdam identificadores do pai'}

BUSINESS_SEMANTIC_REFERENCES_RULES = {'validations': [{'id': 'V1', 'description': 'Identificadores devem seguir padrão: Letra + Número', 'expression': 'identifier matches /^[A-Z]+[0-9]+$/', 'severity': 'error'}, {'id': 'V2', 'description': 'Cada identificador deve ter significado único no mapa semântico', 'expression': 'semantic_map.values().are_unique()', 'severity': 'error'}, {'id': 'V3', 'description': 'Identificadores devem ser definidos antes do uso', 'expression': 'used_identifiers.subset_of(semantic_map.keys())', 'severity': 'warning'}], 'constraints': [{'id': 'C1', 'description': 'Categorias de identificadores são predefinidas', 'applies_to': ['N1', 'P1', 'E1', 'D1', 'S1', 'C1', 'AC1', 'R1', 'F1', 'M1'], 'condition': 'Letras de categoria: N, P, E, D, S, C, AC, R, F, M'}, {'id': 'C2', 'description': 'Identificadores são imutaveis uma vez atribuidos', 'applies_to': ['N2'], 'condition': "Uma vez que N1='Usuário' e definido, N1 sempre significa 'Usuário' naquele contexto"}, {'id': 'C3', 'description': 'Cards filhos reutilizam identificadores do pai', 'applies_to': ['N2', 'P4'], 'condition': 'Story usa N1, P1, etc. do Epic com mesmos significados'}, {'id': 'C4', 'description': 'Novos identificadores incrementam a partir do maior do pai', 'applies_to': ['N2', 'P2'], 'condition': 'Se pai tem N1-N5, filho adiciona N6, N7...'}], 'access_control': []}

BUSINESS_SEMANTIC_REFERENCES_GOVERNANCE = {'status': 'active', 'owner': 'ORBIT Core Team', 'effective_date': '2026-02-04', 'change_log': [{'version': 1, 'date': '2026-02-04', 'author': 'Claude', 'changes': 'Versão inicial documentando metodologia de referências semanticas'}]}


# --- business/workflow_states.yaml ---

BUSINESS_WORKFLOW_STATES_SYSTEM = """"""

BUSINESS_WORKFLOW_STATES_USER = """"""

BUSINESS_WORKFLOW_STATES_DATA = {'workflows': {'epic': ['backlog', 'planning', 'in_progress', 'review', 'done'], 'story': ['backlog', 'ready', 'in_progress', 'review', 'validation', 'done'], 'task': ['backlog', 'todo', 'in_progress', 'code_review', 'testing', 'done'], 'bug': ['new', 'confirmed', 'in_progress', 'fixed', 'verified', 'closed']}, 'transitions': {'epic': {'backlog': ['planning'], 'planning': ['backlog', 'in_progress'], 'in_progress': ['planning', 'review', 'done'], 'review': ['in_progress', 'done'], 'done': []}, 'story': {'backlog': ['ready'], 'ready': ['backlog', 'in_progress'], 'in_progress': ['ready', 'review'], 'review': ['in_progress', 'validation', 'done'], 'validation': ['review', 'done'], 'done': []}, 'task': {'backlog': ['todo'], 'todo': ['backlog', 'in_progress'], 'in_progress': ['todo', 'code_review'], 'code_review': ['in_progress', 'testing', 'done'], 'testing': ['code_review', 'in_progress', 'done'], 'done': []}, 'bug': {'new': ['confirmed', 'closed'], 'confirmed': ['new', 'in_progress', 'closed'], 'in_progress': ['confirmed', 'fixed'], 'fixed': ['in_progress', 'verified', 'closed'], 'verified': ['fixed', 'closed'], 'closed': []}}}

BUSINESS_WORKFLOW_STATES_RULES = {'constraints': [{'id': 'C1', 'description': 'Estados terminais não possuem transições de saída', 'applies_to': ['done', 'closed'], 'condition': 'transitions[state] == []'}, {'id': 'C2', 'description': 'Todos os tipos de item devem ter pelo menos um estado terminal', 'applies_to': ['epic', 'story', 'task', 'bug'], 'condition': 'exists state where transitions[state] == []'}]}

BUSINESS_WORKFLOW_STATES_GOVERNANCE = {'status': 'active', 'owner': 'ORBIT Core Team', 'effective_date': '2026-02-13', 'change_log': [{'version': 1, 'date': '2026-02-13', 'author': 'Claude', 'changes': 'Externalizado do workflow_validator.py - dicts hardcoded de estados e transições'}]}


CONTRACTS = {
    "business/card_hierarchy": {"system": BUSINESS_CARD_HIERARCHY_SYSTEM, "user": BUSINESS_CARD_HIERARCHY_USER, "usage_type": "_config"},
    "business/generation_counts": {"system": BUSINESS_GENERATION_COUNTS_SYSTEM, "user": BUSINESS_GENERATION_COUNTS_USER, "usage_type": "_config", "data": BUSINESS_GENERATION_COUNTS_DATA},
    "business/job_priorities": {"system": BUSINESS_JOB_PRIORITIES_SYSTEM, "user": BUSINESS_JOB_PRIORITIES_USER, "usage_type": "_config", "data": BUSINESS_JOB_PRIORITIES_DATA},
    "business/memory_scan": {"system": BUSINESS_MEMORY_SCAN_SYSTEM, "user": BUSINESS_MEMORY_SCAN_USER, "usage_type": "_config"},
    "business/project_creation": {"system": BUSINESS_PROJECT_CREATION_SYSTEM, "user": BUSINESS_PROJECT_CREATION_USER, "usage_type": "_config"},
    "business/queue_scoring": {"system": BUSINESS_QUEUE_SCORING_SYSTEM, "user": BUSINESS_QUEUE_SCORING_USER, "usage_type": "_config", "data": BUSINESS_QUEUE_SCORING_DATA},
    "business/semantic_references": {"system": BUSINESS_SEMANTIC_REFERENCES_SYSTEM, "user": BUSINESS_SEMANTIC_REFERENCES_USER, "usage_type": "_config"},
    "business/workflow_states": {"system": BUSINESS_WORKFLOW_STATES_SYSTEM, "user": BUSINESS_WORKFLOW_STATES_USER, "usage_type": "_config", "data": BUSINESS_WORKFLOW_STATES_DATA},
}
