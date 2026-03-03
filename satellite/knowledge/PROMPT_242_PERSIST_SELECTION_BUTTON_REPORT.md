# PROMPT #242 - Botão Persistência (Experimental)

## Status: COMPLETED

## Date: 2026-03-02

---

## Objective

Feature experimental: quando o usuário seleciona um trecho de texto na descrição do projeto, um botão adicional "Persistência" (ícone bookmark, cor roxa) aparece ao lado dos botões Detalhar/Resumir.

Nesta fase, o botão é apenas visual — sem funcionalidade real implementada. A ideia é que futuramente esse trecho selecionado possa ser persistido como conhecimento permanente (regra de negócio, requisito, decisão arquitetural, etc.).

---

## What Was Implemented

### OverviewTab.tsx

1. **Detecção de seleção de texto** via `document.addEventListener('selectionchange', ...)`
2. **`descriptionDisplayRef`** — ref na div de exibição da descrição para verificar se a seleção está dentro dela
3. **Estado `selectedText`** — armazena o texto atualmente selecionado
4. **Botão "Persistência"** (roxo, ícone bookmark) — visível somente quando:
   - Há descrição no projeto
   - Há texto selecionado dentro da descrição
   - Não está em modo de edição
5. **Prop `onPersistSelection`** — callback que recebe o texto selecionado

### page.tsx

6. **Handler placeholder** — `onPersistSelection={(text) => console.log(...)}` — apenas loga o texto selecionado no console

---

## Files Modified

| File | Changes |
|------|---------|
| `frontend/src/app/projects/[id]/OverviewTab.tsx` | Detecção de seleção, botão Persistência, prop nova |
| `frontend/src/app/projects/[id]/page.tsx` | Handler placeholder para onPersistSelection |

---

## UX Design

### Botões por estado:

| Estado | Botões exibidos | Cores |
|--------|-----------------|-------|
| Sem descrição | Gerar (raio) | Azul |
| Com descrição | Detalhar + Resumir | Verde + Laranja |
| Com descrição + seleção | Detalhar + Resumir + **Persistência** | Verde + Laranja + **Roxo** |
| Editando | Nenhum (ocultos) | — |

### Comportamento:
- O botão aparece/desaparece em tempo real conforme o usuário seleciona/deseleciona texto
- Tooltip mostra a quantidade de caracteres selecionados
- Ícone: bookmark (marcador)
- Cor: roxo (purple-600) para diferenciar das demais operações

---

## Possível Propósito Futuro

O botão "Persistência" provavelmente servirá para:
- **Salvar trecho como regra de negócio** na wiki do projeto
- **Criar card/task** a partir de um trecho específico da descrição
- **Fixar informação como contexto permanente** que a IA deve sempre considerar
- **Destacar requisito** que não deve ser perdido em futuras expansões/resumos

---

## Testing Results

- TypeScript: zero erros nos arquivos modificados
- Botão aparece somente com seleção dentro da descrição
- Seleção fora da descrição não ativa o botão

---

## REGRA #0 Compliance

- Botão requer clique manual do usuário
- Nenhuma ação automática é executada
- Texto humano é preservado (apenas leitura da seleção)
