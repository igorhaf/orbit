# CLAUDE - Instruções de Memória
## Arquivo de Instruções Permanentes para Claude Code

**Data de Criação:** December 29, 2025
**Última Atualização:** January 7, 2026
**Versão:** 1.3 - Redis Cache Integration (PROMPT #74)

---

## 🎯 INSTRUÇÕES CRÍTICAS - SEMPRE SEGUIR

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

### 1. DOCUMENTAÇÃO DE PROMPTS (OBRIGATÓRIO)

**Para CADA prompt/tarefa implementada, você DEVE criar um arquivo MD de documentação seguindo este padrão:**

#### Estrutura do Arquivo:
```
PROMPT_[NÚMERO]_[DESCRIÇÃO].md
```

**Exemplos de nomenclatura real do projeto:**
- `PROMPT_50_IMPLEMENTATION_REPORT.md` - Implementação de feature completa
- `PROMPT_42_FIX_UNICODE_PARSER.md` - Correção específica (nome descritivo)
- `PROMPT_42_IMPLEMENTATION_SUMMARY.md` - Resumo de implementação
- `PROMPT_46_PHASE1_IMPLEMENTATION_REPORT.md` - Fase de projeto
- `PROMPT_47_PHASE_2_REPORT.md` - Fase de projeto (formato alternativo)
- `PROMPT_45_DIAGNOSTIC_REPORT.md` - Diagnóstico de problema
- `PROMPT_37_FIX_REPORT.md` - Correção de bug (genérico)
- `PROMPT_36_COMPLETION_REPORT.md` - Conclusão de tarefa

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
Consulte os arquivos existentes na raiz do projeto:
- `PROMPT_50_IMPLEMENTATION_REPORT.md` - Implementação de feature completa
- `PROMPT_49_PHASE_4_REPORT.md` - Fase de projeto
- `PROMPT_46_PHASE1_IMPLEMENTATION_REPORT.md` - Implementação de fase
- `PROMPT_42_FIX_UNICODE_PARSER.md` - Correção de bug

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
git add frontend/src/app/ai-models/page.tsx PROMPT_50_IMPLEMENTATION_REPORT.md

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
- [ ] **Criar arquivo PROMPT_[N]_[TIPO]_REPORT.md**
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
1. ✅ Criar arquivo PROMPT_[N]_REPORT.md após cada implementação
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

**Último prompt:** PROMPT #76 (Meta Prompt Fixed Questions)
**Próximo prompt:** PROMPT #77

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

**Principais Marcos:**
- **PROMPT #50**: AI Models Management Page
- **PROMPT #68**: Dual-Mode Interview System - Auto-detecção de estado do projeto (novo vs existente), entrevistas focadas em tasks, AI subtask suggestions, task exploration
- **PROMPT #69**: Refactor interviews.py - Modularização COMPLETA (2464 → 2366 linhas distribuídas em 6 módulos focados)
- **PROMPT #70**: Refactor task_executor.py - Modularização COMPLETA (1179 → 1380 linhas distribuídas em 5 módulos focados: spec_fetcher, context_builder, budget_manager, batch_executor, executor)
- **PROMPT #71**: Refactor tasks.py - Package Structure Created (Abordagem pragmática: estrutura criada, modularização completa adiada. 28 endpoints bem organizados em 1107 linhas)
- **PROMPT #72**: Refactor ChatInterface.tsx - Package Structure Created (Abordagem pragmática: estrutura criada, modularização completa adiada. 16+ states, 3 job polling hooks, componente estável em 1101 linhas)
- **PROMPT #76**: Meta Prompt Fixed Questions - PRIMEIRA entrevista sempre coleta informações completas (8 perguntas fixas Q1-Q8 + perguntas contextuais da IA Q9+), fundação para geração automática de hierarquia completa (Epics → Stories → Tasks → Subtasks com prompts atômicos)

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
2. 📋 Documentar tudo em arquivos PROMPT_N.md
3. 💾 Commitar e fazer push de TODAS as mudanças
4. 🎯 Manter qualidade e consistência do código
5. 🚀 Entregar valor ao usuário

**Cada prompt é uma oportunidade de melhorar o sistema e documentar o conhecimento adquirido!**

---

**FIM DAS INSTRUÇÕES**

_Este arquivo é a memória do projeto. Consulte-o sempre que iniciar uma nova tarefa._
