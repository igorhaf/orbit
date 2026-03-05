---
title: "Sistema de Entrevistas"
slug: "sistema-entrevistas"
source: "generated"
order_index: 6
created_at: "2026-03-05T04:46:25.025703"
updated_at: "2026-03-05T04:46:25.025703"
---

# Sistema de Entrevistas Contextuais

## 3 Fases

### Phase 1: Fixed Stack Questions
- Perguntas predefinidas (framework, banco de dados, linguagem, deployment)
- Opções fechadas (múltipla escolha)
- Sem chamada de IA
- Resultado alimenta detecção de stack e seleção de specs

### Phase 2: Dynamic AI Questions
- Claude Haiku gera perguntas baseadas em respostas anteriores
- Formato: closed-ended com 3-5 opções predefinidas
- Validação de não-redundância via RAG (threshold 0.8)
- Categorias: business, technical, design, mobile, security, performance
- Cada resposta indexada no RAG com type=interview_answer

### Phase 3: Task-Focused Questions
- Ativado ao criar card específico (Epic/Story/Task)
- Contexto do card pai injetado nas perguntas
- Foco em requisitos, acceptance criteria, e dependências

## Storage
Cada resposta armazenada no RAG com:
- `type`: interview_answer
- `question_text`: texto da pergunta
- `answer_text`: resposta do usuário
- `question_category`: business/technical/design/etc.
- `session_id`: ID da sessão de entrevista
- Embedding gerado para busca semântica futura

## Fluxo Interview → Backlog
1. Entrevista gera conversation_text
2. BacklogGenerator recebe conversation + RAG context
3. Gera Epics com semantic references (N1, P1, E1)
4. Decompõe Epics em Stories e Tasks

