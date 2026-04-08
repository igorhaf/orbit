# PROMPT #154 - Interview Question Notification Fix
## Notificação de Perguntas de Entrevista Usando Nome do Projeto

**Date:** February 3, 2026
**Status:** COMPLETED
**Priority:** MEDIUM
**Type:** Bug Fix
**Impact:** Notificações de geração de perguntas agora mostram nome do projeto ao invés de "entrevista"

---

## Problema

Quando o usuário enviava uma mensagem durante a Context Interview (entrevista de contexto para criação de projeto), as notificações apareciam com título genérico:

- **Antes:** "Gerando pergunta para 'entrevista'" → "✅ Pergunta gerada para 'entrevista'"
- **Problema:** O título "entrevista" não é útil - o usuário não sabe qual projeto está sendo processado

---

## Causa Raiz

O código em `endpoints.py` usava o título da task pai (`task_id`) para determinar o título da notificação. Para Context Interviews, não existe `task_id` porque são entrevistas de nível de projeto.

```python
# Código antigo
task_title = "entrevista"
if job and job.task_id:
    related_task = db.query(Task).filter(Task.id == job.task_id).first()
    if related_task:
        task_title = related_task.title[:50]
# Quando task_id é None (Context Interview), task_title ficava "entrevista"
```

---

## Solução Implementada

Adicionada lógica para usar o nome do projeto quando `task_id` é None:

```python
# Código novo
task_title = "entrevista"
if job and job.task_id:
    related_task = db.query(Task).filter(Task.id == job.task_id).first()
    if related_task:
        task_title = related_task.title[:50]
elif job and job.project_id:
    # Context interview - use project name
    related_project = db.query(Project).filter(Project.id == job.project_id).first()
    if related_project:
        task_title = related_project.name[:50] if related_project.name else "projeto"
```

---

## Arquivos Modificados

| Arquivo | Mudança |
|---------|---------|
| `backend/app/api/routes/interviews/endpoints.py` | Linha 2021-2035: Adicionado fallback para nome do projeto quando task_id é None |
| `backend/app/api/routes/interviews/endpoints.py` | Linha 2104-2116: Mesma lógica no background task |

---

## Resultado

- **Depois:** "Gerando pergunta para 'Meu Projeto XYZ'" → "✅ Pergunta gerada para 'Meu Projeto XYZ'"
- Notificações agora são mais úteis e identificáveis
- Funciona tanto no momento de criação do job quanto no momento de completar

---

## Verificação

1. Criar novo projeto via wizard
2. Responder perguntas na Context Interview
3. Verificar notificações no sino (bell icon)
4. As notificações devem mostrar o nome do projeto

---

## Sobre Bloqueio de Navegação

O usuário também reportou que "geração de contexto impede navegação". Após análise:

- **O código já permite navegação livre** durante geração de contexto
- Botão "Skip to Project →" está sempre visível (PROMPT #144)
- Indicador "Generating project context..." é não-bloqueante (PROMPT #150)
- Jobs são adicionados ao sistema de notificações com `watching=true` (PROMPT #140)

Se o usuário está percebendo bloqueio, pode ser:
1. UX não clara - não percebe que pode navegar
2. Expectativa de que deveria esperar o resultado
3. Performance lenta que faz parecer travado

**Recomendação:** Melhorar feedback visual para indicar que navegação é permitida durante processamento.

---

## Status: COMPLETE

**Entregue:**
- Notificações de perguntas de entrevista agora usam nome do projeto
- Fallback para "projeto" se nome não disponível
- Lógica aplicada em ambos os lugares (criação do job e conclusão)

**Impacto:**
- Usuários conseguem identificar qual projeto está sendo processado
- Melhor experiência quando múltiplos projetos estão em andamento
