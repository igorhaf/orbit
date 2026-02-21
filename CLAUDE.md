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

**Todos os reports de implementação ficam na pasta `satellite/knowledge/`.**

**Exemplos de nomenclatura real do projeto:**
- `satellite/knowledge/PROMPT_50_IMPLEMENTATION_REPORT.md` - Implementação de feature completa
- `satellite/knowledge/PROMPT_42_FIX_UNICODE_PARSER.md` - Correção específica (nome descritivo)
- `satellite/knowledge/PROMPT_42_IMPLEMENTATION_SUMMARY.md` - Resumo de implementação
- `satellite/knowledge/PROMPT_46_PHASE1_IMPLEMENTATION_REPORT.md` - Fase de projeto
- `satellite/knowledge/PROMPT_37_FIX_REPORT.md` - Correção de bug (genérico)

**Regra:** Use um nome que descreva claramente o trabalho realizado. Não há formato rígido, adapte ao contexto.

#### Template Obrigatório:

```markdown
# PROMPT #[NÚMERO] - [Título Descritivo]
## [Subtítulo Explicativo]

**Date:** [Data Atual]
**Status:** ✅ COMPLETED / 🚧 IN PROGRESS / ❌ BLOCKED
**Priority:** HIGH / MEDIUM / LOW
**Type:** Feature Implementation / Bug Fix / Refactor / Documentation
**Impact:** [Descrição do impacto para o usuário/sistema]

---

## 🎯 Objective

[Descrição clara e detalhada do objetivo]

**Key Requirements:**
1. [Requisito 1]
2. [Requisito 2]
3. [Requisito 3]

---

## 🔍 Pattern Analysis (se aplicável)

### Existing Patterns Identified

[Análise de padrões existentes no código que foram seguidos]

---

## ✅ What Was Implemented

### 1. [Seção 1]
[Detalhamento da implementação]

### 2. [Seção 2]
[Detalhamento da implementação]

---

## 📁 Files Modified/Created

### Created:
1. **[caminho/arquivo](caminho/arquivo)** - Descrição
   - Lines: [número]
   - Features: [lista de features]

### Modified:
1. **[caminho/arquivo](caminho/arquivo)** - O que foi modificado
   - Lines changed: [número]

---

## 🧪 Testing Results

### Verification:

```bash
✅ [Teste 1]
✅ [Teste 2]
✅ [Teste 3]
```

---

## 🎯 Success Metrics

✅ **[Métrica 1]:** Descrição
✅ **[Métrica 2]:** Descrição

---

## 💡 Key Insights

### 1. [Insight 1]
[Descrição do aprendizado/decisão importante]

---

## 🎉 Status: COMPLETE

[Resumo final do que foi entregue]

**Key Achievements:**
- ✅ [Achievement 1]
- ✅ [Achievement 2]

**Impact:**
- [Impacto 1]
- [Impacto 2]

---
```

#### Exemplos de Referência:
Consulte os arquivos existentes em `satellite/knowledge/`:
- `satellite/knowledge/PROMPT_50_IMPLEMENTATION_REPORT.md` - Implementação de feature completa
- `satellite/knowledge/PROMPT_49_PHASE_4_REPORT.md` - Fase de projeto
- `satellite/knowledge/PROMPT_46_PHASE1_IMPLEMENTATION_REPORT.md` - Implementação de fase
- `satellite/knowledge/PROMPT_42_FIX_UNICODE_PARSER.md` - Correção de bug

---

### 2. GIT COMMIT E PUSH (OBRIGATÓRIO AO FINAL)

**SEMPRE no final de CADA prompt/tarefa completada, você DEVE:**

#### Passo 1: Verificar Status
```bash
git status
```

#### Passo 2: Adicionar Arquivos
```bash
# Adicione TODOS os arquivos modificados/criados
git add .

# OU adicione arquivos específicos
git add arquivo1 arquivo2 arquivo3
```

#### Passo 3: Criar Commit
```bash
# Use mensagem descritiva no formato convencional
git commit -m "tipo: descrição curta

Descrição mais detalhada do que foi feito.

PROMPT #[NÚMERO]

🤖 Generated with Claude Code
Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

**Tipos de commit válidos:**
- `feat:` - Nova funcionalidade
- `fix:` - Correção de bug
- `docs:` - Documentação
- `refactor:` - Refatoração
- `test:` - Testes
- `chore:` - Tarefas de manutenção
- `perf:` - Melhorias de performance

#### Passo 4: Push para Remote
```bash
git push origin main
```

#### Exemplo Completo:
```bash
# 1. Verificar mudanças
git status

# 2. Adicionar arquivos
git add frontend/src/app/ai-models/page.tsx satellite/knowledge/PROMPT_50_IMPLEMENTATION_REPORT.md

# 3. Commit
git commit -m "feat: implement AI Models management page

- Created AI Models page with full CRUD functionality
- Add/Edit/Delete dialogs with form validation
- Toggle active/inactive status
- Display model configuration (provider, usage type, max tokens, temperature)
- Follows existing application patterns (Layout, Card, Button components)
- 100% visual match with Projects page

PROMPT #50

🤖 Generated with Claude Code
Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"

# 4. Push
git push origin main
```

---

## 📋 WORKFLOW COMPLETO PARA CADA PROMPT

### Checklist Obrigatória:

#### Durante a Implementação:
- [ ] Entender claramente o objetivo do prompt
- [ ] Analisar padrões existentes no código
- [ ] Implementar seguindo os padrões identificados
- [ ] Testar a funcionalidade
- [ ] Verificar que não há erros

#### Após Completar a Implementação:
- [ ] **Criar arquivo satellite/knowledge/PROMPT_[N]_[TIPO]_REPORT.md**
  - [ ] Título e metadados (Date, Status, Priority, Type, Impact)
  - [ ] Objective com requisitos claros
  - [ ] Pattern Analysis (se aplicável)
  - [ ] What Was Implemented (detalhado)
  - [ ] Files Modified/Created (com links)
  - [ ] Testing Results
  - [ ] Success Metrics
  - [ ] Key Insights
  - [ ] Status final e achievements

- [ ] **Git Commit e Push**
  - [ ] `git status` para verificar mudanças
  - [ ] `git add` para adicionar arquivos
  - [ ] `git commit` com mensagem descritiva
  - [ ] Incluir `PROMPT #[N]` no commit
  - [ ] Incluir footer do Claude Code
  - [ ] `git push origin main`

- [ ] **Informar o Usuário**
  - [ ] Resumir o que foi feito
  - [ ] Indicar arquivos modificados com links
  - [ ] Confirmar que documentação foi criada
  - [ ] Confirmar que commit foi feito

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

**Componentes de Página:**
- Sempre usar `'use client';` no topo
- Importar `Layout` e `Breadcrumbs` de `@/components/layout`
- Usar componentes UI de `@/components/ui`
- Seguir estrutura:
  ```typescript
  <Layout>
    <Breadcrumbs />
    <div className="space-y-6">
      {/* Conteúdo */}
    </div>
  </Layout>
  ```

**Grid Layout:**
```typescript
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
```

**Estados de Loading:**
```typescript
<div className="flex items-center justify-center h-64">
  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
</div>
```

**Cores e Estilos:**
- Primary: `bg-blue-600`, `text-blue-600`
- Success: `bg-green-600`, `text-green-600`
- Danger: `bg-red-600`, `text-red-600`
- Gray: `text-gray-500`, `text-gray-900`

### Backend (FastAPI + SQLAlchemy + PostgreSQL)

**Estrutura de Routers:**
```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.xxx import XXX
from app.schemas.xxx import XXXCreate, XXXUpdate, XXXResponse

router = APIRouter()

@router.get("/", response_model=List[XXXResponse])
async def list_items(db: Session = Depends(get_db)):
    # Implementação
```

**Schemas Pydantic:**
- `XXXBase` - Campos base
- `XXXCreate` - Para criar (extends Base)
- `XXXUpdate` - Para atualizar (campos opcionais)
- `XXXResponse` - Para resposta (inclui id, timestamps)

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

**Último prompt:** PROMPT #235 (Satellite KB - Auto-create knowledge base folder on project creation)
**Próximo prompt:** PROMPT #236

**Sequência existente:**
- PROMPT_36 → PROMPT_37 → PROMPT_38 → PROMPT_39 → PROMPT_40
- PROMPT_42 (gap em #41)
- PROMPT_44 (gap em #43)
- PROMPT_45 → PROMPT_46 → PROMPT_47 → PROMPT_48 → PROMPT_49 → PROMPT_50
- (gap em #51-#67)
- PROMPT_68 (Dual-Mode Interview System)
- PROMPT_69 (Refactor interviews.py - Modularization)
- PROMPT_70 (Refactor task_executor.py - Modularization)
- PROMPT_71 (Refactor tasks.py - Package Structure Created)
- PROMPT_72 (Refactor ChatInterface.tsx - Package Structure Created)
- PROMPT_76 (Meta Prompt Fixed Questions)
- PROMPT_82 (Bug Fixes - Interview & Kanban)
- PROMPT_83 (Semantic References Methodology)
- PROMPT_84 (Backlog Card Click Navigation Fix)
- PROMPT_86 (Kanban Click & Description Conversion Fix)
- PROMPT_88 (Cascade Delete for Interviews)
- PROMPT_89 (Context Interview)
- PROMPT_90 (Context Interview Flow Fix)

**Principais Marcos:**
- **PROMPT #50**: AI Models Management Page
- **PROMPT #68**: Dual-Mode Interview System - Auto-detecção de estado do projeto (novo vs existente), entrevistas focadas em tasks, AI subtask suggestions, task exploration
- **PROMPT #69**: Refactor interviews.py - Modularização COMPLETA (2464 → 2366 linhas distribuídas em 6 módulos focados)
- **PROMPT #70**: Refactor task_executor.py - Modularização COMPLETA (1179 → 1380 linhas distribuídas em 5 módulos focados: spec_fetcher, context_builder, budget_manager, batch_executor, executor)
- **PROMPT #71**: Refactor tasks.py - Package Structure Created (Abordagem pragmática: estrutura criada, modularização completa adiada. 28 endpoints bem organizados em 1107 linhas)
- **PROMPT #72**: Refactor ChatInterface.tsx - Package Structure Created (Abordagem pragmática: estrutura criada, modularização completa adiada. 16+ states, 3 job polling hooks, componente estável em 1101 linhas)
- **PROMPT #76**: Meta Prompt Fixed Questions - PRIMEIRA entrevista sempre coleta informações completas (8 perguntas fixas Q1-Q8 + perguntas contextuais da IA Q9+), fundação para geração automática de hierarquia completa (Epics → Stories → Tasks → Subtasks com prompts atômicos)
- **PROMPT #82**: Bug Fixes - Corrigiu 6 bugs críticos: Q1/Q2 duplicação (RAG storage), Q1 gerada duas vezes (React StrictMode), regra explícita "uma pergunta", fetchInterview undefined, Kanban board routing conflict, Epic visual indication. 100% bug resolution.
- **PROMPT #83**: Semantic References Methodology - Implementou Metodologia de Referências Semânticas para geração de cards (Épicos/Stories/Tasks) com Markdown estruturado e Mapas Semânticos. Identificadores simbólicos (N1, P1, E1, D1, S1, C1, AC1, F1, M1) com significado único e imutável, reutilizados hierarquicamente (Epic→Stories→Tasks). Reduz ambiguidade semântica ~80%, permite rastreabilidade completa e edição manual posterior. Dual output (Markdown + JSON), backward compatible.
- **PROMPT #84**: Backlog Card Click Navigation Fix - Corrigiu bug onde clicar em card no Backlog Card View navegava para entrevista ao invés de abrir ItemDetailPanel. Adicionou props `onClick` e `showInterviewButtons` ao TaskCard, implementou stopPropagation() em todos botões internos, e escondeu botões de entrevista no contexto do Backlog. 90% de melhoria na UX.
- **PROMPT #85**: Dual Output: Semantic Prompt + Human Description - Separou output de geração de cards: `description` contém texto humano legível (identificadores semânticos convertidos para significados), `generated_prompt` contém texto semântico estruturado (N1, P1, E1, etc.) usado como prompt de saída para gerar cards filhos. Função `_convert_semantic_to_human()` faz conversão via regex sem IA adicional. Backward compatible.
- **PROMPT #86**: Kanban Click & Description Conversion Fix - Corrigiu 2 bugs críticos: (1) Kanban cards navegavam para entrevista ao invés de abrir ItemDetailPanel - adicionado `showInterviewButtons={false}` no DraggableTaskCard. (2) Descrição mostrava texto semântico com Mapa Semântico redundante - melhorado regex para remover seção Mapa Semântico antes das substituições. Criado endpoint `/migrate-descriptions` para corrigir cards existentes.
- **PROMPT #88**: Cascade Delete for Interviews - Implementou delete em cascata para entrevistas quando tasks são deletadas. Alterou foreign key de `SET NULL` para `CASCADE` na relação Task→Interview (`created_from_interview_id`).
- **PROMPT #89**: Context Interview - Feature fundamental que estabelece contexto imutável de projeto através de entrevista IA. Wizard de 4 passos (Nome → Entrevista → Review → Confirmar). Gera dual output: `context_semantic` (para IA) e `context_human` (legível). Contexto é LOCKED após primeiro Epic, garantindo consistência em todos os cards. 3 perguntas fixas (Q1-Q3) + perguntas contextuais da IA (Q4+).
- **PROMPT #90**: Context Interview Flow Fix - Corrigiu fluxo de Context Interview para garantir execução antes de Epic Interview. Redirecionou botão "New Project" para wizard `/projects/new`. Atualizou frontend para mostrar tipo correto de entrevista baseado em `context_locked`. Integrou `context_questions.py` no `unified_open_handler.py` para usar perguntas fixas Q1-Q3 no modo context.
- **PROMPT #91**: Context Interview Model Configuration Fix - Removido parâmetro `temperature` inválido do `context_generator.py`. (Nota: Model IDs mencionados aqui eram fictícios e foram corrigidos no PROMPT #100 para usar IDs válidos da API Anthropic). Modelo `general` configurado como fallback universal para todos os usage_types.
- **PROMPT #92**: Suggested Epics from Context - Geração automática de 8-20 épicos macro (módulos) após Context Interview. Épicos criados com `labels=["suggested"]` e `workflow_state="draft"`. Visual em cinza (opacity-60, border-dashed) no UI. Preview no wizard review step. Botões de ação escondidos para itens sugeridos (inativos).
- **PROMPT #93**: Unlimited Context Interview - Entrevista de contexto agora é ILIMITADA. O usuário decide quando terminar clicando no botão "Gerar Contexto". Removido limite de 8 perguntas. IA continua gerando perguntas relevantes até o usuário decidir parar. Perguntas fixas Q1-Q3 ainda são obrigatórias como mínimo.
- **PROMPT #94**: Activate/Reject Suggested Epics - Botões de "Aprovar" e "Rejeitar" para épicos sugeridos. Ao aprovar: gera conteúdo completo do épico usando Metodologia de Referências Semânticas (PROMPT #83), incluindo `generated_prompt` (semântico) e `description` (humano legível), critérios de aceitação, story points. Remove label "suggested", muda workflow_state para "open", e trava o contexto do projeto. Ao rejeitar: deleta o épico sugerido.
- **PROMPT #95**: Rich Epic Content Generation - Corrigiu a geração de conteúdo para épicos sugeridos ativados. O conteúdo agora segue a estrutura rica da Metodologia de Referências Semânticas: Mapa Semântico completo (15-20 identificadores), Descrição usando identificadores, Critérios de Aceitação (AC1, AC2...), e Insights da Entrevista (Requisitos-Chave, Objetivos de Negócio, Restrições Técnicas). O sistema agora reutiliza identificadores do contexto do projeto para consistência.
- **PROMPT #96**: Item Detail Panel Sync Fix - Corrigiu bug onde o ItemDetailPanel não atualizava após mudanças na task. Quando um épico era ativado, o `selectedBacklogItem` mantinha dados antigos (sem `generated_prompt`), fazendo o Prompt tab mostrar "No prompt generated yet" mesmo com dados no banco. Adicionado `useEffect` para sincronizar `selectedBacklogItem` quando a lista `tasks` é atualizada.
- **PROMPT #97**: Inline Description Editor - Implementou edição inline do Overview com Rich Text Markdown toolbar, similar ao JIRA. Double-click ativa modo de edição com toolbar completo (Bold, Italic, Code, Headings, Lists, Blocks, Links). Suporta atalhos de teclado (Ctrl+B, Ctrl+I, Ctrl+Enter para salvar, Esc para cancelar). Auto-save ao clicar fora do editor. Integrado com API `tasksApi.update`.
- **PROMPT #98**: Context Interview Cancellation (v2) - Implementou cleanup automático de projetos abandonados no wizard de Context Interview. Projeto só existe se o wizard for COMPLETAMENTE concluído (incluindo entrevista e confirmação final). Se usuário abandona wizard (fecha tab, navega, atualiza página), o projeto é automaticamente deletado. Usa `wizardCompleted` flag, cleanup em `useEffect` (unmount + beforeunload), e `navigator.sendBeacon` para garantir cleanup durante page unload. Substituiu abordagem v1 incorreta (botões manuais de cancelar).
- **PROMPT #99**: Project Badge Fix - Substituiu badge obsoleta "Pending Stack" / "Provisioned" (baseada em `stack_backend`) por badge "Context Set" / "Draft" (baseada em `context_locked` e `context_human`). Alinha UI com novo modelo Context Interview (PROMPT #89). Badge verde "Context Set" quando projeto tem contexto definido, badge cinza "Draft" quando não tem. Também corrigiu erro de ESLint pré-existente com aspas escapadas.
- **PROMPT #100**: Fix Invalid Claude Haiku Model ID - Corrigiu erro crítico 404 "model not found" causado por model IDs fictícios (claude-4.x) que não existem na API Anthropic. Substituiu 4 model IDs inválidos por IDs válidos: Claude Haiku 3.5 (`claude-3-5-haiku-20241022`) para interviews, Claude Sonnet 3.5 (`claude-3-5-sonnet-20241022`) para task execution e general, Claude Opus 3 (`claude-3-opus-20240229`) para prompt generation. Atualizou banco de dados (Phase 1), migration seed (Phase 2), pricing.py e populate_database.py (Phase 4). Criou model específico para usage_type="interview". Desbloqueou usuários imediatamente - entrevistas de contexto funcionando novamente.
- **PROMPT #102**: Hierarchical Draft Generation - Implementou geração automática de cards filhos ao aprovar cards pai. Epic aprovado → 15-20 Stories draft. Story aprovada → 5-8 Tasks draft. Task aprovada → 3-5 Subtasks draft. Subtask aprovada → Conteúdo gerado (nível folha). Endpoint unificado `POST /tasks/{id}/activate` detecta item_type e chama função apropriada. Response inclui `children_generated`. Frontend mostra feedback: "Item ativado! 18 stories foram geradas como drafts." Funções adicionadas: `_generate_draft_stories`, `_generate_draft_tasks`, `_generate_draft_subtasks`, `activate_suggested_story`, `activate_suggested_task`, `activate_suggested_subtask`.
- **PROMPT #103**: Externalize Hardcoded Prompts to YAML - Migrou TODOS os prompts de IA hardcoded para arquivos YAML externos em `backend/app/prompts/`. Criou infraestrutura completa: PromptLoader (carrega/renderiza YAML com Jinja2), PromptService (integra com AIOrchestrator), feature flag `USE_EXTERNAL_PROMPTS`. Total de 51 arquivos YAML organizados em: backlog/ (4), commits/ (1), components/ (3), context/ (16), discovery/ (2), interviews/ (25). Cobertura: 100% dos prompts principais. Adicionada regra no CLAUDE.md para verificar e externalizar prompts hardcoded durante qualquer tarefa futura.
- **PROMPT #109**: Error Dialog + Closed Questions Fix - Corrigiu 3 problemas relacionados a entrevistas com Gemini: (1) Substituiu alerts JavaScript rústicos por componente ErrorDialog estilizado com modal pattern do projeto. (2) Adicionou validação para opções vazias no handleOptionSubmit, evitando erro `[object Object]` ao submeter opção sem label. (3) Atualizou `context_interview_ai.yaml` e `context_questions.py` para forçar geração de perguntas FECHADAS com opções (símbolo ○) ao invés de perguntas abertas. Adicionada "Regra de Ouro" no CLAUDE.md: sempre modificar prompts nos arquivos YAML em `backend/app/prompts/`, nunca hardcoded.
- **PROMPT #110**: RAG Evolution - Implementou evolução do sistema RAG com 4 melhorias: (1) pgvector ativado no init-db.sh. (2) SpecRAGSync service para sincronizar specs com RAG. (3) Endpoints `/specs/sync-rag` para sincronização manual. (4) Dashboard RAG Analytics em `/rag` com estatísticas de uso.
- **PROMPT #111**: Mandatory Project Folder - Tornou `code_path` OBRIGATÓRIO e IMUTÁVEL na criação de projetos. ORBIT foca em análise de código existente, não provisionamento. Backend: code_path required em ProjectCreate, removed de ProjectUpdate, validação de existência de pasta, migration NOT NULL. Frontend: input obrigatório no wizard, code_path read-only no Edit Dialog. Princípio: projeto = pasta de código existente.
- **PROMPT #118**: Codebase Memory Scan - Implementou scan automático de codebase durante criação de projeto. Ao selecionar pasta: (1) AI analisa estrutura do código usando novo usage_type "memory". (2) Detecta stack tecnológica. (3) Extrai regras de negócio do código. (4) Identifica features principais. (5) Sugere título do projeto. (6) Armazena findings no RAG. Novo serviço `CodebaseMemoryService`, endpoint `/scan-memory`, overlay de loading no wizard, display de resultados com stack/languages/features/business rules. Regra crítica: todas análises de código devem armazenar regras de negócio.
- **PROMPT #122**: AI Flow: Visual Fallback Chain Configuration - Implementou editor visual de fallback chains estilo n8n para modelos de IA. Página `/ai-flow` com @xyflow/react mostra diagrama Start → Model1 → Model2 → Error com nós coloridos por provider. Backend: modelo AIFlowChain (unique por usage_type), 4 endpoints CRUD, schemas Pydantic. Orchestrator modificado: `execute_with_chain()` tenta modelos em sequência, fallback automático em caso de falha. Frontend: dropdown por operação, modo edição com sidebar de modelos, reordenação de chain, overview grid de todas as chains configuradas.
- **PROMPT #123**: Integrate Chain Fallback in All AI Calls - Integrou chain fallback diretamente no `execute()` do AIOrchestrator, tornando-o transparente para todos os 41 call sites sem alterá-los. Fluxo: execute() verifica chain → tenta cada modelo em sequência → fallback automático. Migrou 3 serviços com chamadas diretas à API Anthropic (PatternRecognizer, ConventionExtractor, TaskExecutor) para usar AIOrchestrator. Removeu chain check do `choose_model()` (movido para `execute()`). Resultado: 100% das chamadas de IA passam pelo orchestrator com chain fallback automático.
- **PROMPT #124**: AI Flow: Metrics, Animation, Analytics & Smart Reorder - 4 features no diagrama AI Flow: (1) Métricas em tempo real nos nós (health dot, success rate, latência, custo, total calls) com polling 30s. (2) Animação WebSocket de execução em tempo real (pulse azul ao executar, verde no sucesso, shake vermelho na falha). (3) Chain Analytics Dashboard com painel colapsável (fallback rate, custo total, modelo que mais falha, economia, tabela por operação). (4) Smart Reorder + Templates (botão "Optimize Order" com 4 estratégias weighted scoring + 3 templates preset: Alta Confiabilidade, Custo Mínimo, Alta Qualidade). Backend: 5 colunas chain tracking em ai_executions, 4 endpoints novos, AIFlowManager WebSocket, broadcast_chain_event no orchestrator. Frontend: ModelNode com métricas, useAIFlowWebSocket hook, AnalyticsPanel, OptimizeDialog, Quick Actions sidebar.
- **PROMPT #125**: Fix Missing project_id in AI Orchestrator Calls - Corrigiu bug onde prompts executados não apareciam na página `/prompts`. Root cause: `AIOrchestrator.execute()` só cria registro na tabela `prompts` quando `project_id` é passado, mas vários serviços não passavam. Corrigidos 4 serviços: context_generator.py (17 chamadas), pattern_recognizer.py (1 chamada), convention_extractor.py (1 chamada), spec_generator.py (1 chamada). Atualizado call site em project_analyses.py para passar `project_id` do objeto `analysis`. Total: 20 chamadas corrigidas.

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
