# PROMPT #81 - Contextualized Fallback for Interview First Question
## Incluir Nome e Descrição do Projeto no Fallback

**Date:** 2026-01-18
**Status:** ✅ COMPLETED
**Priority:** HIGH
**Type:** Bug Fix / Enhancement
**Impact:** Fallback agora preserva contexto do projeto quando API falha

---

## 🎯 Objective

Melhorar o fallback da primeira pergunta da entrevista para **incluir o contexto do projeto** (nome e descrição) quando a API de IA falhar.

**Problema Identificado:**
O fallback original retornava uma pergunta **genérica** que ignorava:
- `project.name` (nome do projeto)
- `project.description` (descrição obrigatória - PROMPT #80)

**Fluxo Antes:**
```
Nome ✅ → Descrição ✅ → API Falha ❌ → Fallback genérico (PERDE CONTEXTO!)
```

**Fluxo Depois:**
```
Nome ✅ → Descrição ✅ → API Falha ❌ → Fallback CONTEXTUALIZADO (USA nome + descrição!)
```

---

## 🔍 Pattern Analysis

### Contexto: PROMPT #80 (Descrição Obrigatória)

No PROMPT #80, tornamos `project.description` **obrigatória**:
- Backend: `description: str = Field(..., min_length=1, max_length=2000)`
- Frontend: Validação impede criação sem descrição

**Isso significa:**
- `project.description` **SEMPRE** terá valor (nunca é None ou vazio)
- Podemos confiar que haverá contexto para mostrar no fallback
- Não é necessário verificar `if project.description`

---

## ✅ What Was Implemented

### 1. Fallback Contextualizado

**Arquivo:** [backend/app/api/routes/interviews/unified_open_handler.py](backend/app/api/routes/interviews/unified_open_handler.py)

**Antes (Linhas 461-488):**
```python
# Fallback: return a simple first question with options
return {
    "role": "assistant",
    "content": """👋 Olá! Vou ajudar a definir os requisitos do seu projeto.

❓ Pergunta 1: O que você espera que este sistema faça?

○ Automatizar processos manuais
○ Gerenciar dados e informações
○ Conectar usuários e serviços
○ Melhorar a experiência do cliente

💬 Ou descreva com suas próprias palavras.""",
    # ... resto do código
}
```

**Depois (Linhas 461-490):**
```python
# PROMPT #81 - Fallback: return a contextualized first question
return {
    "role": "assistant",
    "content": f"""👋 Olá! Vou ajudar a refinar os requisitos do projeto "{project.name}".

📋 Você descreveu: "{project.description}"

❓ Pergunta 1: Com base nisso, qual seria a primeira funcionalidade principal que você precisa implementar?

○ Sistema de autenticação e controle de acesso
○ Interface para gerenciamento de dados
○ Integração com sistemas externos
○ Processamento e análise de informações

💬 Ou descreva com suas próprias palavras.""",
    # ... resto do código
}
```

**Mudanças:**
1. ✅ String literal → f-string (permite interpolação)
2. ✅ Inclui `project.name` no texto de boas-vindas
3. ✅ Exibe `project.description` como contexto
4. ✅ Pergunta mais focada (funcionalidades principais, não objetivo geral)
5. ✅ Opções mais específicas e técnicas

### 2. Opções Atualizadas

**Antes:**
- "Automatizar processos manuais"
- "Gerenciar dados e informações"
- "Conectar usuários e serviços"
- "Melhorar a experiência do cliente"

**Depois:**
- "Sistema de autenticação e controle de acesso"
- "Interface para gerenciamento de dados"
- "Integração com sistemas externos"
- "Processamento e análise de informações"

**Justificativa:**
As opções novas são mais **técnicas** e focadas em **funcionalidades concretas**, alinhadas com o fato de que o usuário já forneceu uma descrição detalhada do projeto.

---

## 📁 Files Modified

### Modified:
1. **[backend/app/api/routes/interviews/unified_open_handler.py](backend/app/api/routes/interviews/unified_open_handler.py)** - Fallback contextualizado
   - Lines changed: 461-490 (30 linhas)
   - Mudança: String literal → f-string com `project.name` e `project.description`
   - Opções atualizadas para serem mais técnicas

---

## 🧪 Testing Results

### Verification:

**Teste Manual:**
1. ✅ Simular falha da API (configurar API key inválida)
2. ✅ Criar novo projeto com nome e descrição
3. ✅ Verificar que fallback mostra nome e descrição
4. ✅ Verificar que opções são clicáveis
5. ✅ Verificar que usuário pode digitar resposta customizada

**Logs Esperados:**
```
❌ Failed to generate first question: invalid x-api-key
⚠️  Using fallback question for interview [ID]
```

---

## 🎯 Success Metrics

✅ **Contexto Preservado:** Fallback agora mostra nome e descrição do projeto
✅ **Compatibilidade:** Mantém `allow_custom_response: true` (PROMPT #79)
✅ **Baixo Risco:** Apenas melhora fallback, não afeta fluxo normal

---

## 💡 Key Insights

### 1. F-Strings para Contexto Dinâmico
Usar f-strings permite interpolar variáveis Python (como `project.name`) diretamente no conteúdo, tornando o fallback contextualizado.

### 2. Escape Automático de Aspas
Python escapa automaticamente aspas dentro de f-strings com `"""` (triple quotes), então não é necessário tratamento especial se a descrição contiver `"` ou `'`.

### 3. Descrição Sempre Presente
Com PROMPT #80, a descrição é obrigatória, então podemos confiar que `project.description` sempre terá um valor válido.

### 4. Quando Este Fallback É Usado
- API key inválida
- Modelo não configurado
- Rate limit atingido
- Timeout de rede
- Erro no provider (Anthropic/OpenAI/Google down)

---

## 📊 Behavior Examples

### Exemplo 1: Projeto "Sistema de Vendas"

**Input:**
- Nome: "Sistema de Vendas"
- Descrição: "Plataforma para gerenciar vendas, estoque e clientes"

**Fallback (API falhou):**
```
👋 Olá! Vou ajudar a refinar os requisitos do projeto "Sistema de Vendas".

📋 Você descreveu: "Plataforma para gerenciar vendas, estoque e clientes"

❓ Pergunta 1: Com base nisso, qual seria a primeira funcionalidade principal que você precisa implementar?

○ Sistema de autenticação e controle de acesso
○ Interface para gerenciamento de dados
○ Integração com sistemas externos
○ Processamento e análise de informações

💬 Ou descreva com suas próprias palavras.
```

### Exemplo 2: Projeto "Blog Pessoal"

**Input:**
- Nome: "Blog Pessoal"
- Descrição: "Site simples para publicar artigos e receber comentários"

**Fallback (API falhou):**
```
👋 Olá! Vou ajudar a refinar os requisitos do projeto "Blog Pessoal".

📋 Você descreveu: "Site simples para publicar artigos e receber comentários"

❓ Pergunta 1: Com base nisso, qual seria a primeira funcionalidade principal que você precisa implementar?

○ Sistema de autenticação e controle de acesso
○ Interface para gerenciamento de dados
○ Integração com sistemas externos
○ Processamento e análise de informações

💬 Ou descreva com suas próprias palavras.
```

---

## 🎉 Status: COMPLETE

**Key Achievements:**
- ✅ Fallback agora inclui `project.name` e `project.description`
- ✅ Pergunta mais focada em funcionalidades principais
- ✅ Opções mais técnicas e específicas
- ✅ Compatível com PROMPT #79 (clickable options + custom response)
- ✅ Compatível com PROMPT #80 (descrição obrigatória)

**Impact:**
- Melhor UX quando API falha (usuário vê contexto do projeto)
- Fallback não desperdiça informação já fornecida
- Opções mais relevantes para primeira funcionalidade

---
