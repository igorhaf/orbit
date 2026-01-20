# PROMPT #96 - Item Detail Panel Sync Fix & Rich Epic Content
## Correção de Sincronização e Geração de Conteúdo Detalhado para Épicos

**Date:** January 20, 2026
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Bug Fix + Enhancement
**Impact:** Corrige o bug de sincronização do selectedBacklogItem e melhora drasticamente a geração de conteúdo para épicos ativados

---

## Objetivo

### Problema 1: Sincronização do ItemDetailPanel
Corrigir o bug onde o `ItemDetailPanel` não atualizava após a ativação de um épico sugerido, mostrando dados desatualizados (sem `generated_prompt`).

### Problema 2: Conteúdo Genérico
O conteúdo gerado para épicos era muito genérico, não refletindo as especificidades do contexto do projeto. Exemplo:
- **Antes:** "Este Epic implementa E1 como parte de N1..."
- **Esperado:** Especificação técnica completa com campos, tipos, regras de negócio, APIs, etc.

---

## Implementação

### Parte 1: Sincronização Frontend

#### 1. [frontend/src/components/backlog/BacklogListView.tsx](frontend/src/components/backlog/BacklogListView.tsx)

Adicionadas novas props para controlar refresh e sincronização:

```typescript
interface BacklogListViewProps {
  // ... existing props ...
  refreshKey?: number;     // When this changes, backlog is refreshed
  selectedItemId?: string; // Currently selected item ID to update after refresh
}

// Helper to find item recursively in tree
const findItemById = (items: BacklogItem[], id: string): BacklogItem | null => {
  for (const item of items) {
    if (item.id === id) return item;
    if (item.children && item.children.length > 0) {
      const found = findItemById(item.children as BacklogItem[], id);
      if (found) return found;
    }
  }
  return null;
};

// Sync selected item with updated backlog data
useEffect(() => {
  if (selectedItemId && backlog.length > 0 && onItemSelect) {
    const updatedItem = findItemById(backlog, selectedItemId);
    if (updatedItem) {
      onItemSelect(updatedItem);
    }
  }
}, [backlog, selectedItemId]);
```

#### 2. [frontend/src/app/projects/[id]/page.tsx](frontend/src/app/projects/[id]/page.tsx)

```typescript
const [backlogRefreshKey, setBacklogRefreshKey] = useState(0);

const handleTasksUpdate = () => {
  loadProjectData();
  setBacklogRefreshKey(prev => prev + 1);
};

<BacklogListView
  projectId={projectId}
  filters={backlogFilters}
  onItemSelect={setSelectedBacklogItem}
  refreshKey={backlogRefreshKey}
  selectedItemId={selectedBacklogItem?.id}
/>
```

#### 3. [frontend/src/components/backlog/ItemDetailPanel.tsx](frontend/src/components/backlog/ItemDetailPanel.tsx)

Adicionado ReactMarkdown para renderizar descrição como Markdown:

```typescript
import ReactMarkdown from 'react-markdown';

{/* Description - PROMPT #96: Render as Markdown */}
<div className="prose prose-sm max-w-none text-gray-700">
  <ReactMarkdown>
    {item.description}
  </ReactMarkdown>
</div>
```

#### 4. [backend/app/services/backlog_view.py](backend/app/services/backlog_view.py)

Adicionado `generated_prompt` no retorno da API:

```python
def _task_to_dict(self, task: Task) -> Dict:
    return {
        # ... existing fields ...
        # PROMPT #96 - Include generated_prompt for ItemDetailPanel
        "generated_prompt": task.generated_prompt,
        "acceptance_criteria": task.acceptance_criteria or [],
        "token_budget": task.token_budget,
        "actual_tokens_used": task.actual_tokens_used,
    }
```

---

### Parte 2: Geração de Conteúdo Rico (context_generator.py)

#### Problema: JSON Parsing Falhando

O AI retornava JSON com ~17786 caracteres mas com strings não terminadas, fazendo todas as 6 estratégias de parsing falharem.

#### Solução: 8 Estratégias de Parsing + Fallback Inteligente

**Estratégias de Parsing (em ordem):**

1. **raw_direct** - Parse direto do texto bruto
2. **direct** - Parse após strip de markdown blocks
3. **regex_greedy** - Extração com regex `\{[\s\S]*\}`
4. **balanced_braces** - Contagem de chaves balanceadas
5. **fixed_trailing_commas** - Remove vírgulas trailing
6. **fixed_newlines_aggressive** - Escapa newlines em strings
7. **truncated_recovery** - Trunca JSON em ponto válido e fecha estruturas
8. **ast_literal_eval** - Usa Python AST como último recurso

**Fallback Simplificado:**

Quando TODAS as estratégias falham, faz uma nova requisição à IA pedindo Markdown puro (sem JSON):

```python
simple_system_prompt = f"""Você é um Arquiteto de Software Sênior com 20 anos de experiência.

Sua tarefa é escrever uma ESPECIFICAÇÃO TÉCNICA COMPLETA E DETALHADA para um módulo de software.

REGRAS IMPORTANTES:
1. Seja EXTREMAMENTE ESPECÍFICO - use nomes reais de campos, tabelas, endpoints
2. NÃO use placeholders genéricos como "campo1", "tabela1", "endpoint1"
3. BASEIE-SE no contexto do projeto para gerar nomes e estruturas realistas
4. Cada seção deve ter MÍNIMO 5 itens detalhados

CONTEXTO DO PROJETO PARA REFERÊNCIA:
{context_preview}
"""
```

**Estrutura do Fallback:**

A especificação técnica gerada inclui:

1. **VISÃO GERAL** - 2-3 parágrafos
2. **MODELO DE DADOS** - Tabela com MÍNIMO 10 campos com tipos
3. **REGRAS DE NEGÓCIO** - MÍNIMO 8 regras específicas (RN1, RN2...)
4. **ESTADOS E TRANSIÇÕES** - Estados possíveis e fluxo
5. **INTERFACE DO USUÁRIO** - MÍNIMO 4 telas com detalhes
6. **API REST** - MÍNIMO 6 endpoints
7. **VALIDAÇÕES E ERROS** - Códigos de erro
8. **CRITÉRIOS DE ACEITAÇÃO** - MÍNIMO 8 critérios mensuráveis
9. **CONSIDERAÇÕES TÉCNICAS** - Segurança, Performance, etc.

**Extração Automática:**

Quando o fallback funciona, o sistema extrai automaticamente:
- Critérios de aceitação da seção "CRITÉRIOS DE ACEITAÇÃO"
- Requisitos-chave da seção "REGRAS DE NEGÓCIO"

---

## Fluxo Corrigido

```
1. Usuário clica "Aprovar" em épico sugerido
   ↓
2. POST /api/v1/tasks/{id}/activate
   ↓
3. AI gera JSON com especificação técnica
   ↓
4. JSON parsing tenta 8 estratégias
   ↓
5a. Se parsing OK → usa conteúdo JSON
5b. Se parsing falha → faz nova requisição para Markdown puro
   ↓
6. Salva generated_prompt e description no banco
   ↓
7. Frontend recebe refreshKey incrementado
   ↓
8. BacklogListView recarrega e sincroniza selectedItem
   ↓
9. ItemDetailPanel renderiza conteúdo rico como Markdown
```

---

## Exemplo de Conteúdo Gerado

### Antes (genérico):
```
Este Epic implementa E1 como parte de N1.
Dados e estruturas do módulo.
```

### Depois (detalhado):
```markdown
# Epic: Chat em Tempo Real

## 1. VISÃO GERAL
O módulo de Chat em Tempo Real é responsável por fornecer comunicação
instantânea entre hóspedes e anfitriões na plataforma Bangalô...

## 2. MODELO DE DADOS

### Entidade Principal: Mensagem
| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| id | uuid | Sim | Identificador único |
| conversa_id | uuid | Sim | FK para Conversa |
| remetente_id | uuid | Sim | FK para Usuário |
| conteudo | text | Sim | Conteúdo da mensagem |
| tipo | enum | Sim | texto, imagem, arquivo |
| lida | boolean | Não | Se foi lida |
| created_at | datetime | Sim | Timestamp |

## 3. REGRAS DE NEGÓCIO
- **RN1 - Participantes**: Apenas hóspedes e anfitriões envolvidos na reserva podem trocar mensagens
- **RN2 - Arquivo**: Tamanho máximo 10MB, formatos permitidos: jpg, png, pdf
- **RN3 - Notificação**: Push notification enviada em tempo real via WebSocket
...

## 6. API REST

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | /api/conversas | Lista conversas do usuário |
| POST | /api/conversas/:id/mensagens | Envia nova mensagem |
| PATCH | /api/mensagens/:id/lida | Marca como lida |
...
```

---

## Arquivos Modificados

| Arquivo | Mudança | Linhas |
|---------|---------|--------|
| `frontend/src/app/projects/[id]/page.tsx` | backlogRefreshKey state | +6 |
| `frontend/src/components/backlog/BacklogListView.tsx` | refreshKey, selectedItemId props | +25 |
| `frontend/src/components/backlog/ItemDetailPanel.tsx` | ReactMarkdown rendering | +10 |
| `backend/app/services/backlog_view.py` | generated_prompt no _task_to_dict | +4 |
| `backend/app/services/context_generator.py` | 8 parsing strategies + fallback | +200 |

---

## Métricas de Sucesso

- `selectedBacklogItem` atualizado após mudanças em tasks
- Prompt tab exibe `generated_prompt` imediatamente após ativação
- Overview tab renderiza descrição como Markdown formatado
- Conteúdo gerado é ESPECÍFICO ao contexto do projeto
- Especificações incluem campos com tipos, regras, APIs, telas

---

## Status: COMPLETE

A correção garante que:
1. O `ItemDetailPanel` sempre exibe dados atualizados após ativação
2. Descrição é renderizada como Markdown
3. Conteúdo gerado é detalhado e específico ao projeto
4. Fallback robusto quando JSON parsing falha

**Impacto:**
- Bug de sincronização corrigido
- Qualidade do conteúdo gerado drasticamente melhorada
- Especificações técnicas completas com modelo de dados, regras, APIs
