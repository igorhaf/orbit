# PROMPT #239 - Criação de Projeto: Título Dinâmico + Geração de Descrição

## Status: COMPLETED

## Date: 2026-03-02

---

## Objective

Melhorar o formulário de criação de projeto com:
1. Campo de título pré-preenchido pelo nome da pasta, atualizável automaticamente conforme a descrição é digitada
2. Campo de descrição com botão para gerar conteúdo via IA a partir do título
3. Atividade simples — não mexe no contexto do projeto

---

## What Was Implemented

### Frontend (`/projects/new/page.tsx`)

1. **Campo Título** — Input pré-preenchido com nome derivado da pasta (`code_path`). Atualiza automaticamente quando:
   - `code_path` muda → nome da pasta vira título
   - Descrição é digitada → primeira frase significativa (até 60 chars) vira título sugerido (debounce 500ms)
   - REGRA #0 respeitada: se o usuário editou o título manualmente, auto-sugestão é desativada

2. **Campo Descrição** — Textarea opcional com placeholder explicativo

3. **Botão "Gerar Descrição"** — Aparece quando descrição está vazia e título existe. Chama `POST /api/v1/projects/generate-description` via AI

4. **Envio de name/description** — `handleGenerate` agora envia `name` e `description` como query params no `create-and-process`

### Backend (`projects.py`)

5. **Endpoint `POST /api/v1/projects/generate-description`** — Gera descrição curta (2-3 frases) via AIOrchestrator com prompt YAML externalizado

6. **Params em `create-and-process`** — Novos params opcionais `name` e `description`. Se fornecidos, usados em vez do padrão (nome da pasta / null)

### Prompt YAML (`projects/generate_description.yaml`)

7. **Prompt externalizado** — System + user prompt para geração simples de descrição de projeto

---

## Files Modified/Created

| File | Action | Changes |
|------|--------|---------|
| `frontend/src/app/projects/new/page.tsx` | Editado | Campos título + descrição, auto-título via debounce, botão gerar, envio de params |
| `backend/app/api/routes/projects.py` | Editado | Endpoint `generate-description` + params `name`/`description` em `create-and-process` |
| `backend/app/prompts/projects/generate_description.yaml` | Criado | Prompt YAML para geração de descrição |

---

## Auto-Title Logic

```
1. Selecionar pasta → título = nome da pasta
2. Digitar descrição → título = primeira frase significativa (debounce 500ms)
3. Editar título manualmente → titleManuallyEdited = true → auto-sugestão desativada
4. Limpar descrição → título volta ao nome da pasta (se não editado manualmente)
```

---

## Testing Results

- TypeScript: zero erros no arquivo alterado
- Backend reiniciado com sucesso
