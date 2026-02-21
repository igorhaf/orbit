# PROMPT #246 - Domain-Based Hierarchy: Epic = Domínio, Story = Regra
## Simplificar hierarquia para 2 níveis: cada domínio é um Epic, cada regra é uma Story

**Date:** February 19, 2026
**Status:** ✅ COMPLETED
**Priority:** HIGH
**Type:** Enhancement
**Impact:** "Gerar Cards" cria Epics por domínio real do sistema (Aluno, Professor, Provas) com regras como Stories diretas

---

## 🎯 Objective

Ajustar a classificação de regras de negócio para seguir uma estrutura simples e clara:

- **1 Epic = 1 Domínio** do sistema (Aluno, Professor, Provas, Matrículas, Pagamentos, etc.)
- **1 Story = 1 Regra de negócio** como filha direta do Epic do seu domínio
- **Sem níveis adicionais** (Task/Subtask) — apenas Epic > Story

**Motivação:** A hierarquia de 4 níveis (Epic > Story > Task > Subtask) era excessivamente complexa e a IA frequentemente classificava de forma inconsistente. A estrutura de 2 níveis é mais previsível e alinha com a expectativa do usuário.

---

## ✅ What Was Implemented

### 1. Atualização do prompt YAML (business_rules_hierarchy.yaml)

- **System prompt**: Reescrito para instruir hierarquia de 2 níveis apenas
  - Nível 1 (Epic) = Domínio de negócio (ex: "Aluno", "Professor", "Provas")
  - Nível 2 (Story) = Regra de negócio filha direta do Epic
- **Removidas instruções** de 4 níveis (Task/Subtask)
- **Sem limite de Epics**: "NÃO limite o número de Epics - crie QUANTOS domínios existirem"
- **User prompt**: Atualizado para reforçar "apenas 2 níveis"

### 2. Atualização do card creator (context_generator.py)

- `_create_hierarchy_cards`: Limitado a profundidade máxima 1 (Epic → Story)
- `DEPTH_TO_TYPE` simplificado: `{0: Epic, 1: Story}`
- Recursão limitada: `if children and depth < 1` (só entra em filhos do Epic)
- Docstring atualizado refletindo PROMPT #246

---

## 📁 Files Modified

1. **backend/app/contracts/memory/business_rules_hierarchy.yaml** — Prompt reescrito para 2 níveis
2. **backend/app/services/context_generator.py** — Hierarquia limitada a Epic > Story

---

## 🧪 Testing

```
✅ Python syntax OK (ast.parse)
```

---

## 🎯 Resultado Esperado

Antes (PROMPT #193):
```
Epic "Gestão de Usuários"
  └── Story "Autenticação com email"
      └── Task "Validação de formato de email"
          └── Subtask "Máscara de CPF"
```

Depois (PROMPT #246):
```
Epic "Aluno"
  ├── Story "Aluno deve ter matrícula única"
  ├── Story "Aluno pode se inscrever em até 6 disciplinas"
  └── Story "Aluno com nota >= 7 é aprovado"

Epic "Professor"
  ├── Story "Professor pode lecionar em até 3 turmas"
  └── Story "Professor define critérios de avaliação"

Epic "Provas"
  ├── Story "Prova tem peso entre 0 e 10"
  └── Story "Nota final é média ponderada das provas"
```

---

## 🎉 Status: COMPLETE

**Key Achievements:**
- ✅ Prompt YAML reescrito para hierarquia de 2 níveis
- ✅ Card creator limitado a Epic > Story
- ✅ Sem limite de Epics (cria quantos domínios existirem)
- ✅ Títulos dos Epics = nome do domínio (curto e direto)

---
