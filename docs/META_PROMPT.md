# META-PROMPT: Sistema de Orquestração de IA com Arquitetura Prompter

## 📋 CONTEXTO DO PROJETO

Você está construindo um sistema SPA completo para criação e orquestração de aplicações usando IA, especificamente focado na API do Claude Code e múltiplos modelos de IA.

## 🛠️ STACK TECNOLÓGICA

### Frontend
- **Framework**: Next.js com TypeScript
- **UI Library**: Tailwind CSS
- **Gerenciamento de Estado**: (A definir durante desenvolvimento)
- **Componentes**: shadcn/ui ou similar para componentes base

### Backend
- **Framework**: FastAPI (Python)
- **Banco de Dados**: PostgreSQL
- **ORM**: SQLAlchemy ou similar
- **Gerenciadores de Pacotes**: Poetry, pip, npm/pnpm/yarn conforme necessário

### DevOps
- **Containerização**: Docker + Docker-compose
- **Estrutura**: Monorepo

## 🏗️ ARQUITETURA
```
/
├── frontend/          # Next.js + TypeScript + Tailwind
├── backend/           # FastAPI + PostgreSQL
├── docker/            # Configurações Docker
├── docs/              # Documentação
└── docker-compose.yml
```

## 🎯 FUNCIONALIDADES CORE (Ordem de Prioridade)

### 1. Sistema de Entrevista (Chat Livre com IA)
- Interface de chat conversacional
- IA interpreta livremente as necessidades do usuário
- Modelo de IA configurável nas settings do sistema
- Coleta informações para gerar contexto completo

### 2. Geração de Prompts (Arquitetura Prompter)
- Geração automática baseada na entrevista
- Seguir padrões de mercado da arquitetura prompter
- Prompts completamente componíveis e reutilizáveis
- Sistema modular para composição de prompts

### 3. Kanban Board
- Interface estilo Trello
- Drag-and-drop funcional
- Edição inline de tarefas
- Tarefas geradas automaticamente dos prompts
- Possibilidade de editar prompts diretamente no kanban
- Colunas: Backlog, To Do, In Progress, Review, Done

### 4. Integração Claude Code API
- **Estratégia**: Chat individual por tarefa do kanban
- Execução manual de cada atividade
- Sistema de validação/review antes da execução
- Opção de voltar para edição após execução
- **Não gera código automaticamente** - apenas orquestra

### 5. Orquestração Multi-Modelos
- Suporte para múltiplos modelos de IA
- Configuração por fase/tipo de tarefa
- Seletor de modelo específico por operação

## 🔄 SISTEMA DE VERSIONAMENTO (Git-Style)

### Commits Automáticos Gerenciados por IA
- **Tipos de Commit**: feat, fix, docs, style, refactor, test, chore, perf
- IA gera mensagens de commit automaticamente
- Modelo de IA configurável para geração de commits
- Histórico completo de versões
- Versionamento de prompts e tarefas

## 💾 ESTRUTURA DE DADOS

### Entidades Principais

1. **Projects**: id, name, description, created_at, updated_at, git_repository_info
2. **Interviews**: id, project_id, conversation_data, ai_model_used, created_at, status
3. **Prompts**: id, content, type, is_reusable, components, project_id, version, parent_id
4. **Tasks**: id, title, description, prompt_id, status, order, column
5. **ChatSessions**: id, task_id, messages, ai_model_used, created_at, status
6. **Commits**: id, type, message, changes, created_by_ai_model, task_id, timestamp
7. **AIModels**: id, name, provider, api_key, usage_type, is_active
8. **SystemSettings**: configurações globais e default_models

## 🌊 FLUXO DE TRABALHO

1. Usuário inicia entrevista
2. IA coleta informações livremente
3. Sistema gera prompts usando arquitetura prompter
4. Prompts são convertidos em tarefas no kanban
5. Usuário pode editar tarefas/prompts no kanban
6. Para cada tarefa: executa via chat individual com Claude Code API
7. IA gera commits automáticos
8. Versionamento e histórico mantidos

## 🎨 REFERÊNCIAS DE ARQUITETURA

### Arquitetura Prompter
- Prompts modulares e componíveis
- Separação de contexto, instruções e exemplos
- Reutilização de componentes de prompt
- Versionamento de templates

### Padrões de Orquestração
- Chain-of-thought prompting
- Multi-step reasoning
- Context preservation across interactions
- Dynamic model selection based on task type

## 📐 PADRÕES DE DESENVOLVIMENTO

### Backend
- Clean Architecture
- Dependency Injection
- Repository Pattern
- Service Layer Pattern

### Frontend
- Component-based architecture
- Custom hooks for logic reuse
- Server Components quando possível
- Client Components apenas quando necessário

## 🔒 SEGURANÇA

- Validação de inputs com Pydantic
- Sanitização de dados
- API Keys em variáveis de ambiente
- CORS configurado adequadamente
- Rate limiting em endpoints sensíveis

## 🧪 QUALIDADE

- Type safety (TypeScript + Pydantic)
- Validação em runtime
- Error handling consistente
- Logging estruturado
- Health checks em todos os serviços

## 📊 PRÓXIMOS PASSOS

Consulte [PROGRESS.md](PROGRESS.md) para o roadmap detalhado e status atual do desenvolvimento.
