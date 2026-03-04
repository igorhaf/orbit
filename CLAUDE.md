# CLAUDE - Instruções de Memória
## Arquivo de Instruções Permanentes para Claude Code

**Data de Criação:** December 29, 2025
**Última Atualização:** February 19, 2026
**Versão:** 1.6 - Human Data Supremacy Rule

---

## 🔐 ADMIN CREDENTIALS (CONFIDENCIAL)

**Sudo Password:** `30102024@Real`

---

## 🎯 INSTRUÇÕES CRÍTICAS - SEMPRE SEGUIR

### REGRA #0 - DADOS HUMANOS SÃO SAGRADOS (MÁXIMA PRIORIDADE) 🛡️

**⚠️ ATENÇÃO: DADOS GERADOS POR IA NUNCA SOBRESCREVEM DADOS DE OPERADOR HUMANO ⚠️**

**REGRA FUNDAMENTAL:**
Dados inseridos ou editados por um operador humano têm **prioridade absoluta** sobre dados gerados por IA. Esta regra se aplica a **TODOS os locais do sistema** sem exceção.

**Princípios:**
- ✅ **IA preenche campos vazios** - Se o campo está vazio/null, a IA pode preenchê-lo
- ✅ **IA sugere, humano confirma** - Dados gerados por IA devem ser apresentados como sugestão quando há dado humano existente
- ❌ **NUNCA sobrescrever dado humano com dado de IA** - Se um humano editou um campo (título, descrição, status, etc.), a IA NÃO pode sobrescrever
- ❌ **NUNCA substituir edição manual** - Mesmo que a IA gere um resultado "melhor", o dado humano prevalece

**Exemplos práticos:**
```python
# ✅ CORRETO - Verificar antes de sobrescrever
if not task.description or task.description == ai_generated_original:
    task.description = ai_new_description  # OK, campo vazio ou IA anterior

# ❌ ERRADO - Sobrescrever sem verificar
task.description = ai_new_description  # PROIBIDO se humano editou!
```

**Onde esta regra se aplica:**
- Títulos e descrições de tasks/epics/stories
- Campos de projetos (nome, descrição, contexto)
- Wiki pages e conteúdo gerado
- Qualquer campo que o usuário possa editar manualmente
- Status, prioridade, labels - se alterados manualmente pelo usuário

**Ao implementar features que geram/atualizam dados:**
1. Sempre verificar se o dado atual foi editado por humano
2. Se foi editado por humano, NÃO sobrescrever
3. Se necessário atualizar, apresentar como sugestão para aprovação
4. Logar quando um dado humano é preservado sobre sugestão de IA

---

### 0. API KEYS E CONFIGURAÇÕES (CRÍTICO - NUNCA ESQUECER) ⚠️

**⚠️ ATENÇÃO: AS API KEYS NUNCA SÃO ARMAZENADAS NO .ENV ⚠️**

**REGRA FUNDAMENTAL:**
- ✅ **API Keys são armazenadas NO BANCO DE DADOS** (tabela `ai_models`)
- ❌ **API Keys NUNCA são usadas no arquivo .env**
- ❌ **NUNCA sugira ao usuário adicionar API keys no .env**
- ❌ **NUNCA crie scripts que leiam API keys de environment variables**

**Como funciona no ORBIT:**
1. O usuário configura as API keys diretamente na interface web (`/ai-models`)
2. As keys ficam armazenadas na tabela `ai_models` do PostgreSQL
3. O `AIOrchestrator` busca as keys do banco de dados quando precisa fazer chamadas
4. O arquivo `.env` contém APENAS configurações gerais (DATABASE_URL, SECRET_KEY, etc.)

**Quando popular o banco de dados:**
- Use placeholders como `'configure-via-web-interface'` ou `'set-in-ai-models-page'`
- NUNCA tente ler de `settings.anthropic_api_key` ou variáveis de ambiente
- As keys reais serão configuradas pelo usuário via interface web

**Exemplos CORRETOS de população:**
```sql
INSERT INTO ai_models (name, provider, api_key, ...)
VALUES ('Claude Sonnet 4', 'anthropic', 'configure-via-web-interface', ...);
```

**Exemplos INCORRETOS (NUNCA FAZER):**
```python
# ❌ ERRADO - não ler de environment
api_key = settings.anthropic_api_key

# ❌ ERRADO - não ler de .env
api_key = os.getenv('ANTHROPIC_API_KEY')
```

**Se o usuário mencionar problemas com API keys:**
1. Verificar se as keys estão corretas na tabela `ai_models` do banco
2. Sugerir que ele configure via interface web em `/ai-models`
3. NUNCA sugerir adicionar no .env

---

### 0.1. COMPATIBILIDADE MULTI-PROVIDER (CRÍTICO) 🌐

**⚠️ ATENÇÃO: ORBIT ORQUESTRA 3 PROVIDERS DE IA SIMULTANEAMENTE ⚠️**

**REGRA FUNDAMENTAL:**
O ORBIT não é apenas para Anthropic Claude - é um **sistema de orquestração** que suporta **3 providers diferentes**:

1. **🤖 Anthropic (Claude)**
   - Claude Sonnet 4.5, Claude Opus 4.5, Claude Haiku 4

2. **🔷 OpenAI (GPT)**
   - GPT-4o, GPT-4 Turbo, GPT-3.5 Turbo

3. **🔶 Google (Gemini)**
   - Gemini 1.5 Pro, Gemini 2.0 Flash, Gemini 1.5 Flash

**SEMPRE que implementar código relacionado a chamadas de IA:**

✅ **CORRETO - Compatível com todos:**
```python
# Messages com apenas roles "user" e "assistant"
messages = [
    {"role": "user", "content": "..."},
    {"role": "assistant", "content": "..."},
    {"role": "user", "content": "..."}
]

# System prompt separado (AIOrchestrator trata isso)
system_prompt = "Você é um assistente..."
```

❌ **ERRADO - Pode quebrar com alguns providers:**
```python
# ❌ NUNCA usar role "system" em messages
messages = [
    {"role": "system", "content": "..."},  # ❌ Anthropic rejeita!
    {"role": "user", "content": "..."}
]

# ❌ NUNCA assumir comportamento específico de um provider
messages = [
    {"role": "model", "content": "..."}  # ❌ Apenas Gemini usa "model"!
]
```

**Compatibilidade de Roles:**

| Provider | Roles Aceitos | System Prompt | Notes |
|----------|---------------|---------------|-------|
| **Anthropic** | `user`, `assistant` | Parâmetro `system` separado | ❌ Rejeita role `system` em messages |
| **OpenAI** | `system`, `user`, `assistant` | Message com role `system` | ✅ Aceita `system` em messages |
| **Google Gemini** | `user`, `model` | System instructions separadas | `model` = equivalente a `assistant` |

**Como o AIOrchestrator resolve isso:**

O `AIOrchestrator` (`backend/app/services/ai_orchestrator.py`) é responsável por:
1. Receber messages padronizadas (apenas `user` e `assistant`)
2. Receber system_prompt como parâmetro separado
3. Converter para o formato específico de cada provider
4. Fazer a chamada correta para cada API

**Ao implementar features:**

1. ✅ **Use apenas roles "user" e "assistant"** nas mensagens
2. ✅ **Passe system prompt separadamente** (não como mensagem)
3. ✅ **Deixe o AIOrchestrator fazer a conversão** para cada provider
4. ✅ **Teste com PELO MENOS 2 providers diferentes** (não apenas Claude)
5. ✅ **Documente qual provider você testou** nos PROMPT reports

**Exemplo de implementação correta:**

```python
# ✅ CORRETO - Compatível com Anthropic, OpenAI e Gemini
from app.services.ai_orchestrator import AIOrchestrator

orchestrator = AIOrchestrator(db)

# Mensagens padronizadas (apenas user/assistant)
messages = [
    {"role": "user", "content": "Olá"},
    {"role": "assistant", "content": "Oi! Como posso ajudar?"},
    {"role": "user", "content": "Me explique IA"}
]

# System prompt separado
system_prompt = "Você é um assistente especializado em IA."

# AIOrchestrator cuida da compatibilidade
response = await orchestrator.execute(
    usage_type="interview",  # Escolhe provider baseado em usage_type
    messages=messages,       # Messages padronizadas
    system_prompt=system_prompt,  # System prompt separado
    max_tokens=1000
)
```

**Se você ver código fazendo chamadas diretas à API:**
- 🚨 **ALERTA!** Código deve usar AIOrchestrator, não chamadas diretas
- Apenas o AIOrchestrator deve fazer chamadas diretas às APIs
- Isso garante compatibilidade, logging, cost tracking, etc.

**Quando otimizar prompts/contexto (como PROMPT #54):**
- ✅ Otimizações devem funcionar para **todos os 3 providers**
- ✅ Teste redução de tokens com diferentes providers (custos variam)
- ✅ Documente economia de tokens/custo para cada provider

**Providers e Usage Types (configurados em ai_models):**

| Usage Type | Provider Padrão | Pode Usar Outros? |
|------------|-----------------|-------------------|
| `task_execution` | Anthropic (Claude Sonnet 4.5) | ✅ Sim |
| `interview` | Anthropic (Claude Haiku 4) | ✅ Sim |
| `prompt_generation` | OpenAI (GPT-4o) | ✅ Sim |
| `commit_generation` | Google (Gemini 1.5 Pro) | ✅ Sim |
| `general` | Anthropic (padrão) | ✅ Sim |

**Usuário pode configurar qualquer provider para qualquer usage type via `/ai-models`!**

---

### 0.2. CACHE REDIS (CRÍTICO - SEMPRE ATIVO) 💾

**⚠️ ATENÇÃO: TODAS AS CHAMADAS DE IA USAM CACHE REDIS AUTOMATICAMENTE ⚠️**

**REGRA FUNDAMENTAL (PROMPT #74):**
O `AIOrchestrator` **SEMPRE** usa cache Redis automaticamente quando instanciado com `AIOrchestrator(db)`.

**Como funciona:**

1. **Cache Automático no AIOrchestrator**
   - O `AIOrchestrator.__init__()` inicializa o cache automaticamente
   - Conecta ao Redis (variável `REDIS_HOST` no .env)
   - Se Redis não disponível, usa cache in-memory como fallback

2. **3 Níveis de Cache (Multi-Level Caching)**
   - **L1 - Exact Match:** Hash exato do prompt (TTL: 7 dias, hit rate esperado: ~20%)
   - **L2 - Semantic Match:** Similaridade semântica >95% (TTL: 1 dia, hit rate esperado: ~10%)
   - **L3 - Template Cache:** Para prompts determinísticos (temperature=0, TTL: 30 dias, hit rate esperado: ~5%)
   - **Total:** Hit rate esperado de 30-35% → economia de 60-90% em custos!

3. **Fluxo de Execução com Cache**
   ```python
   # Quando você chama:
   response = await orchestrator.execute(
       usage_type="interview",
       messages=[...],
       system_prompt="..."
   )

   # O que acontece internamente:
   # 1. AIOrchestrator verifica cache (L1 → L2 → L3)
   # 2. Se cache HIT: retorna resposta imediata (0 tokens usados!)
   # 3. Se cache MISS: executa API call normalmente
   # 4. Armazena resultado no cache para futuras requisições
   ```

4. **Verificação de Cache Hit**
   - Resultado com cache hit: `response["cache_hit"] = True`
   - Tipo de cache: `response["cache_type"]` = "exact", "semantic" ou "template"
   - Tokens usados: `response["usage"]["total_tokens"] = 0` (cache hit não gasta tokens!)

**NUNCA faça:**
- ❌ Chamar APIs de IA diretamente (Anthropic, OpenAI, Google) sem usar AIOrchestrator
- ❌ Criar instâncias de AIOrchestrator com `enable_cache=False` (desabilita cache)
- ❌ Bypass do cache com chamadas diretas às APIs

**SEMPRE faça:**
- ✅ Use `AIOrchestrator(db)` para TODAS as chamadas de IA
- ✅ O cache é automático, não precisa fazer nada extra!
- ✅ Monitore hit rate em `/cost-analytics` (esperado: 30-35%)

**Onde o cache está ativo:**
- ✅ Interviews (geração de perguntas e respostas)
- ✅ Task execution (execução de código)
- ✅ Prompt generation (geração de tarefas)
- ✅ Commit generation (mensagens de commit)
- ✅ Backlog generation (geração de backlog)
- ✅ Todas as outras chamadas de IA que usam AIOrchestrator!

**Monitoramento:**
- Cache hit rate visível em `/cost-analytics`
- Logs mostram: `✅ Cache HIT (exact) - Saved API call!`
- Redis stats disponíveis via API: `/api/v1/cache/stats`

**Configuração Redis (.env):**
```bash
REDIS_HOST=redis
REDIS_PORT=6379
```

**Se Redis não estiver disponível:**
- Sistema usa cache in-memory como fallback
- Hit rate menor (apenas L1 - Exact Match)
- Recomenda-se sempre ter Redis rodando para máxima economia!

---

### 0.3. PROMPTS EXTERNALIZADOS PARA YAML (CRÍTICO) 📝

**⚠️ ATENÇÃO: TODOS OS PROMPTS DE IA DEVEM ESTAR EM ARQUIVOS YAML ⚠️**

**REGRA FUNDAMENTAL (PROMPT #103):**
O ORBIT utiliza um sistema de **prompts externalizados** onde TODOS os prompts de IA são armazenados em arquivos YAML na pasta `backend/app/prompts/`.

**Estrutura de pastas:**
```
backend/app/prompts/
├── backlog/           # Prompts de geração de backlog (Epic, Stories, Tasks)
├── commits/           # Prompts de geração de commits
├── components/        # Componentes reutilizáveis (semantic_methodology, etc.)
├── context/           # Prompts de contexto e especificações
├── discovery/         # Prompts de descoberta de padrões
└── interviews/        # Prompts de entrevistas
    ├── card_focused/  # Prompts por tipo de card
    ├── sections/      # Seções especializadas (business, design, mobile)
    └── task_types/    # Prompts por tipo de task
```

**DURANTE QUALQUER PROMPT/TAREFA, VOCÊ DEVE:**

1. **VERIFICAR** se existe código de prompt hardcoded no arquivo que está modificando
2. **SE ENCONTRAR** prompt hardcoded (system_prompt = """...""", user_prompt = """..."""):
   - **CRIAR** arquivo YAML correspondente em `backend/app/prompts/`
   - **SUBSTITUIR** o código hardcoded para usar o PromptLoader
   - **TESTAR** se o YAML carrega corretamente

**Como identificar prompts hardcoded:**
```python
# ❌ ERRADO - Prompt hardcoded
system_prompt = """Você é um Product Owner especialista...
METODOLOGIA DE REFERÊNCIAS SEMÂNTICAS:
...
"""

# ❌ ERRADO - F-string com prompt longo
system_prompt = f"""Você está conduzindo uma entrevista...
{context}
...
"""
```

**Como deve ser (externalizado):**
```python
# ✅ CORRETO - Usando PromptLoader
from app.prompts.loader import PromptLoader

loader = PromptLoader()
system_prompt, user_prompt = loader.render(
    "backlog/epic_from_interview",
    {
        "project_name": project.name,
        "conversation_text": conversation_text
    }
)
```

**Formato do arquivo YAML:**
```yaml
name: epic_from_interview
version: 1
category: backlog
description: Gera Epic a partir de conversa de entrevista
usage_type: prompt_generation
estimated_tokens: 2500
tags:
  - backlog
  - epic
  - portuguese

variables:
  required:
    - project_name
    - conversation_text
  optional:
    - semantic_map_text

components:
  - semantic_methodology

system_prompt: |
  Você é um Product Owner especialista...

  {{ components.semantic_methodology }}

  ...

user_prompt: |
  Analise esta conversa: {{ conversation_text }}
  Projeto: {{ project_name }}
```

**NUNCA faça:**
- ❌ Criar novos prompts hardcoded em código Python
- ❌ Modificar prompts diretamente no código Python
- ❌ Ignorar prompts hardcoded existentes ao trabalhar em um arquivo

**SEMPRE faça:**
- ✅ Verificar se há prompts hardcoded ao abrir qualquer arquivo de serviço
- ✅ Externalizar prompts encontrados para YAML
- ✅ Usar o PromptLoader para carregar prompts
- ✅ Manter variáveis dinâmicas usando sintaxe Jinja2 ({{ variable }})

**REGRA DE OURO PARA MODIFICAÇÕES DE PROMPTS (PROMPT #109):**
Quando precisar modificar QUALQUER prompt de IA (seja para corrigir formato de perguntas,
ajustar instruções, ou melhorar resultados):

1. **PRIMEIRO**: Localize o arquivo YAML correspondente em `backend/app/prompts/`
2. **FAÇA AS ALTERAÇÕES NO YAML**: Modifique `system_prompt:` ou `user_prompt:`
3. **VERIFIQUE**: Se o código Python ainda usa prompt hardcoded, migre para PromptLoader
4. **TESTE**: Reinicie o servidor e teste a funcionalidade

Exemplo de fluxo correto:
- Problema: "Gemini não está gerando perguntas fechadas com opções"
- Solução: Edite `backend/app/prompts/interviews/context_interview_ai.yaml`
- Não faça: Modificar strings de prompt diretamente no Python

**Arquivos com prompts já externalizados (51 YAMLs):**
- Total: 51 arquivos YAML
- Cobertura: 100% dos prompts principais

**Se encontrar prompt hardcoded:**
1. Crie o arquivo YAML na pasta apropriada
2. Copie o conteúdo do prompt para `system_prompt:` e `user_prompt:`
3. Identifique variáveis e adicione em `variables:`
4. Substitua o código Python para usar PromptLoader
5. Teste se funciona corretamente

---

### 1. DOCUMENTAÇÃO DE PROMPTS (OBRIGATÓRIO)

**Para CADA prompt/tarefa implementada, você DEVE criar um arquivo MD de documentação seguindo este padrão:**

#### Estrutura do Arquivo:
```
satellite/knowledge/PROMPT_[NÚMERO]_[DESCRIÇÃO].md
```

**Template:** Seguir estrutura dos exemplos existentes em `satellite/knowledge/`. Secoes obrigatorias: Objective, What Was Implemented, Files Modified/Created, Testing Results, Status.

**Referencia:** `satellite/knowledge/PROMPT_50_IMPLEMENTATION_REPORT.md` (exemplo completo)

---

### 2. GIT COMMIT E PUSH (OBRIGATÓRIO AO FINAL)

Ao final de cada tarefa: `git status` → `git add` → `git commit` → `git push origin main`

**Formato do commit:** Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`, `perf:`)
- Incluir `PROMPT #[N]` no body
- Incluir footer: `Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>`

---

## 📋 WORKFLOW POR PROMPT

Ao completar implementacao:
1. Criar `satellite/knowledge/PROMPT_[N]_[TIPO]_REPORT.md` (ver template em `satellite/knowledge/PROMPT_50_IMPLEMENTATION_REPORT.md`)
2. Git commit + push
3. Informar usuario: resumo, arquivos modificados, confirmar doc e commit

---

### 3. ESTRUTURA SATELLITE (BASE DE CONHECIMENTO DO PROJETO)

**A pasta `satellite/` contém todos os artefatos de documentacao que o ORBIT usa para memória e auto-análise:**

```
satellite/
  memory/              # Logs de execucao IA (auto-salvos pelo AIOrchestrator)
  docs/                # Documentos externos (PDFs, TXTs, etc.) - vigiado pelo RAG
  knowledge/           # Base de conhecimento estruturada
    wiki/              # Wiki pages (.md com YAML front matter)
    results/           # Resultados do Claude Code (lidos pelos cards)
    prompts/           # Prompts exportados para execucao no Claude Code
  README.md            # Descricao auto-gerada do projeto
```

**Regras:**
- ✅ Todos os reports de PROMPT vao em `satellite/knowledge/`
- ✅ Upload de documentos externos vai para `satellite/docs/` (vigiado pelo RAG)
- ✅ Wiki pages ficam em `satellite/knowledge/wiki/`
- ✅ CLAUDE.md e README.md permanecem na raiz (sao arquivos especiais)
- ❌ NUNCA criar .md de documentacao na raiz do projeto

**Auto-Análise do ORBIT:**
O ORBIT pode analisar seu PROPRIO codebase como um projeto. Para isso:
- Criar um projeto com `code_path` apontando para a raiz do ORBIT (ex: `/home/igorhaf/orbit`)
- A pasta `satellite/` e criada automaticamente ao instanciar o projeto (PROMPT #235)
- A pasta `satellite/` e excluida do scan de tech stack mas indexada pelo RAG scanner
- O scanner respeita `.gitignore`, `IGNORE_DIRECTORIES` e padroes detectados por IA (PROMPT #223)

---

## 🎨 PADRÕES DE CÓDIGO DO PROJETO

### Frontend (Next.js + React + TypeScript)
- `'use client';` no topo de paginas
- Layout: `<Layout><Breadcrumbs />` + `<div className="space-y-6">`
- Grid: `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6`
- Cores: blue-600 (primary), green-600 (success), red-600 (danger)
- Referencia: ver componentes existentes em `frontend/src/components/ui/`

### Backend (FastAPI + SQLAlchemy + PostgreSQL)
- Routers: `APIRouter()` + `Depends(get_db)` + response_model
- Schemas Pydantic: Base, Create, Update, Response (ver `backend/app/schemas/`)
- Services em `backend/app/services/` (logica de negocio separada de routes)

---

## 🚀 CONTEXTO DO PROJETO: ORBIT 2.1

### Sobre o Projeto:
**ORBIT** é um sistema de orquestração de IA que gerencia múltiplos modelos de IA (Anthropic, OpenAI, Google) para diferentes tipos de tarefas (interviews, prompt generation, task execution, commit generation).

### Stack Tecnológica:
- **Backend:** FastAPI, SQLAlchemy, PostgreSQL, Alembic
- **Frontend:** Next.js 14 App Router, React, TypeScript, Tailwind CSS
- **AI:** Claude API, OpenAI API, Google AI via AIOrchestrator service

### Fases Implementadas:
- **Phase 1 (PROMPT #46):** Stack questions in interviews
- **Phase 2 (PROMPT #47):** Dynamic specs database (47 specs seeded)
- **Phase 3 (PROMPT #48):** Specs integration in prompt generation (60-80% token reduction)
- **Phase 4 (PROMPT #49):** Specs integration in task execution (15-20% additional reduction)
- **PROMPT #50:** AI Models management page with full CRUD

### Token Reduction Strategy:
O sistema usa especificações de frameworks (Laravel, Next.js, PostgreSQL, Tailwind) armazenadas no banco de dados para reduzir drasticamente o uso de tokens da IA:
- **Phase 3:** 60-80% de redução fornecendo specs durante geração de tarefas
- **Phase 4:** 15-20% adicional com specs seletivas durante execução de código
- **Total:** 70-85% de redução de tokens!

---

## ⚠️ REGRAS IMPORTANTES

### SEMPRE:
1. ✅ Criar arquivo satellite/knowledge/PROMPT_[N]_REPORT.md após cada implementação
2. ✅ Fazer git commit e push no final de CADA prompt
3. ✅ Seguir padrões existentes do código
4. ✅ Usar componentes e funções já existentes
5. ✅ Testar antes de considerar completo
6. ✅ Documentar decisões importantes nos reports

### NUNCA:
1. ❌ Pular a criação do arquivo de documentação
2. ❌ Esquecer de fazer commit e push
3. ❌ Criar novos componentes quando existentes podem ser reutilizados
4. ❌ Desviar dos padrões estabelecidos sem justificativa
5. ❌ Fazer commits sem mensagem descritiva
6. ❌ Deixar código não testado

---

## 📝 NUMERAÇÃO DE PROMPTS

**Histórico completo de prompts:** Consulte `satellite/knowledge/PROMPT_HISTORY.md`
**Último prompt registrado:** PROMPT #247

---

## 🔄 ESTE ARQUIVO

Este arquivo (`CLAUDE.md`) serve como **memória permanente** das instruções e padrões do projeto.

**Deve ser atualizado quando:**
- Novos padrões forem estabelecidos
- Novos requisitos forem definidos
- A numeração de prompts mudar
- Novas fases do projeto forem concluídas

**Atualização:** Sempre que este arquivo for modificado, criar commit específico:
```bash
git commit -m "docs: update CLAUDE.md memory file

[Descrição das mudanças]"
```

---

## ✨ LEMBRE-SE

**Você é Claude, o assistente de desenvolvimento do projeto ORBIT.**

Sua responsabilidade é:
1. 📝 Implementar features seguindo padrões
2. 📋 Documentar tudo em arquivos satellite/knowledge/PROMPT_N.md
3. 💾 Commitar e fazer push de TODAS as mudanças
4. 🎯 Manter qualidade e consistência do código
5. 🚀 Entregar valor ao usuário

**Cada prompt é uma oportunidade de melhorar o sistema e documentar o conhecimento adquirido!**

---

**FIM DAS INSTRUÇÕES**

_Este arquivo é a memória do projeto. Consulte-o sempre que iniciar uma nova tarefa._
