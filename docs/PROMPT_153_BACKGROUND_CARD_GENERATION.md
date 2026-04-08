# PROMPT #153 - Background Card Generation from Memory Scan
## Geração Automática de Cards em Background

**Date:** February 3, 2026
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Feature Implementation
**Impact:** Cards de regras de negócio e épicos sugeridos são gerados automaticamente em background, mesmo que o usuário abandone o wizard

---

## Objetivo

Implementar geração automática de cards (épicos sugeridos e regras de negócio) em background, logo após o memory scan, independentemente do wizard ser completado.

**Problema Resolvido:**
- Usuário saia do wizard antes de completar a Context Interview
- Nenhum card era gerado (nem regras de negócio, nem épicos sugeridos)
- Usuário precisava completar todo o fluxo para ter cards iniciais
- Não havia forma de gerar cards apenas com os dados do memory scan

---

## O Que Foi Implementado

### 1. Novo JobType: CARDS_FROM_MEMORY

**Arquivo:** `backend/app/models/async_job.py`

Adicionado novo tipo de job para rastrear a geração de cards em background:
```python
CARDS_FROM_MEMORY = "cards_from_memory"  # Geração de cards a partir do memory scan
```

### 2. Método generate_cards_from_memory()

**Arquivo:** `backend/app/services/context_generator.py`

Novo método que gera cards usando apenas os dados do memory scan:

```python
async def generate_cards_from_memory(self, project_id: UUID) -> Dict:
    """
    Gera cards usando APENAS os dados do memory scan:
    1. Business Rule Cards (closed) - regras verificadas no código
    2. Suggested Epics (drafts) - novas funcionalidades a desenvolver
    """
```

**Funcionalidades:**
- Verifica se projeto já tem cards (evita duplicação)
- Auto-gera contexto básico se não existir
- Gera cards de regras de negócio (fechados/verificados)
- Gera épicos sugeridos (drafts) usando IA
- Retorna resultado com contagem de cards gerados

### 3. Background Task _process_cards_from_memory_async()

**Arquivo:** `backend/app/api/routes/projects.py`

Task assíncrona que executa a geração de cards em background:

```python
async def _process_cards_from_memory_async(job_id, project_id):
    # 1. Start job
    # 2. Update progress (10%, 30%, 90%)
    # 3. Call generate_cards_from_memory()
    # 4. Update notification with results
    # 5. Complete job
```

### 4. Integração com Memory Scan

**Arquivo:** `backend/app/api/routes/projects.py`

Modificado `_process_quick_create_scan` para disparar geração de cards após o scan:

```python
# Após memory scan completar com sucesso
cards_job = job_manager.create_job(
    job_type=JobType.CARDS_FROM_MEMORY,
    ...
)
asyncio.create_task(_process_cards_from_memory_async(cards_job.id, project_id))
```

### 5. Endpoint Manual para Geração de Cards

**Arquivo:** `backend/app/api/routes/projects.py`

Novo endpoint para disparar geração de cards manualmente:

```
POST /api/v1/projects/{project_id}/generate-cards
```

Útil quando:
- Usuário abandonou wizard antes de cards serem gerados
- Cards precisam ser regenerados após novo scan
- Testing/debugging

---

## Arquivos Modificados

| Arquivo | Mudança |
|---------|---------|
| `backend/app/models/async_job.py` | Novo JobType CARDS_FROM_MEMORY |
| `backend/app/services/context_generator.py` | Métodos generate_cards_from_memory(), _generate_auto_context_from_memory(), _generate_suggested_epics_from_memory() |
| `backend/app/api/routes/projects.py` | Task _process_cards_from_memory_async(), endpoint generate-cards, integração em _process_quick_create_scan |

---

## Fluxo de Execução

```
1. Usuário seleciona pasta no wizard
   ↓
2. POST /quick-create → Cria projeto
   ↓
3. Memory scan job inicia em background
   ↓
4. Memory scan completa → Salva initial_memory_context
   ↓
5. 🆕 Card generation job inicia automaticamente
   ↓
6. Gera cards de regras de negócio (fechados)
   ↓
7. Gera épicos sugeridos (drafts) via IA
   ↓
8. Notificação: "✅ X regras + Y épicos gerados"
   ↓
9. Usuário pode ver cards no backlog mesmo sem completar wizard
```

---

## Verificação

1. Criar projeto selecionando pasta com código
2. Abandonar wizard (fechar tab/navegar para outra página)
3. Verificar notificações: deve aparecer "✅ X regras + Y épicos gerados"
4. Acessar /projects/{id}/backlog
5. Cards devem aparecer: regras de negócio fechadas + épicos sugeridos

**Teste manual:**
```bash
# Disparar geração manualmente
curl -X POST http://localhost:8000/api/v1/projects/{id}/generate-cards
```

---

## Benefícios

| Benefício | Impacto |
|-----------|---------|
| Geração automática | Cards gerados mesmo se wizard for abandonado |
| Background processing | Usuário pode navegar livremente durante geração |
| Notificações | Feedback visual quando cards são gerados |
| Endpoint manual | Flexibilidade para regenerar cards quando necessário |
| Sem duplicação | Verifica se cards já existem antes de gerar |

---

## Detalhes Técnicos

### Auto-Contexto
Quando projeto não tem contexto (context_semantic), um contexto básico é auto-gerado a partir do memory scan:
- Stack tecnológica
- Funcionalidades principais (F1, F2, ...)
- Regras de negócio (RN1, RN2, ...)
- Análise do codebase

### Épicos Sugeridos
A IA analisa o memory context e sugere 5-15 épicos para **novas funcionalidades**:
- Features existentes são excluídas (já estão nos cards de regras)
- Foco em: integrações, automações, melhorias de UX, relatórios
- Priorizados por valor de negócio

### Cards de Regras de Negócio
Criados como cards **fechados** (DONE):
- 1 Épico pai: "Regras de Negócio Documentadas"
- N Stories filhas: uma por regra extraída do código
- Labels: ["business_rule", "verified", "from_code"]
- workflow_state: "closed"

---

## Status: COMPLETE

**Entregue:**
- JobType CARDS_FROM_MEMORY para rastrear geração
- Método generate_cards_from_memory() no ContextGeneratorService
- Background task com progress tracking e notificações
- Integração automática após memory scan
- Endpoint manual POST /projects/{id}/generate-cards

**Impacto:**
- Cards são gerados mesmo se usuário abandonar wizard
- Trabalho pode começar imediatamente após scan
- Experiência mais fluida e resiliente
- Notificações informam quando cards estão prontos
