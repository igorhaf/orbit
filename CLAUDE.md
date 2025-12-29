# CLAUDE - Instruções de Memória
## Arquivo de Instruções Permanentes para Claude Code

**Data de Criação:** December 29, 2025
**Última Atualização:** December 29, 2025
**Versão:** 1.0

---

## 🎯 INSTRUÇÕES CRÍTICAS - SEMPRE SEGUIR

### 1. DOCUMENTAÇÃO DE PROMPTS (OBRIGATÓRIO)

**Para CADA prompt/tarefa implementada, você DEVE criar um arquivo MD de documentação seguindo este padrão:**

#### Estrutura do Arquivo:
```
PROMPT_[NÚMERO]_[TIPO]_REPORT.md
```

**Tipos comuns:**
- `IMPLEMENTATION_REPORT` - Para implementações de features
- `FIX_REPORT` - Para correções de bugs
- `PHASE_N_REPORT` - Para fases de projetos grandes
- `DIAGNOSTIC_REPORT` - Para diagnósticos e análises

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

**Último prompt:** PROMPT #50 (AI Models Management Page)
**Próximo prompt:** PROMPT #51

**Sequência existente:**
- PROMPT_36 → PROMPT_37 → PROMPT_38 → PROMPT_39 → PROMPT_40
- PROMPT_42 (gap em #41)
- PROMPT_44 (gap em #43)
- PROMPT_45 → PROMPT_46 → PROMPT_47 → PROMPT_48 → PROMPT_49 → PROMPT_50

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
