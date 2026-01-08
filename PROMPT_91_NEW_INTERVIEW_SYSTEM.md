# PROMPT #91 - Novo Sistema de Entrevistas Simplificado
## Fluxo de Perguntas Fixas + IA Contextual

**Date:** January 8, 2026
**Status:** 🚧 IN PROGRESS
**Priority:** HIGH
**Type:** Feature Refactor

---

## 🎯 Objective

Criar novo sistema de entrevistas com fluxo simplificado e inteligente:

**Fase 1 - Perguntas Fixas (sem IA):**
1. Título do projeto
2. Descrição do projeto
3. Tipo de sistema (Apenas API / API + Frontend / API + Mobile / API + Frontend + Mobile)
4. Stack conforme o tipo escolhido (opções extraídas dos specs disponíveis)

**Fase 2 - Perguntas com IA:**
- Usar contexto máximo do título + descrição + stack
- Manter sessão aberta e contextualizar perguntas
- Sempre respostas fechadas (radio ou checkbox)
- Permitir interação direta do usuário pelo chat
- **NUNCA repetir uma pergunta**
- Incrementar contexto conforme respostas

---

## 📋 Problema Atual

Sistema tem 3 modos diferentes (requirements, task-focused, meta_prompt) com muitas perguntas fixas.
Usuário quer fluxo mais simples e focado em projeto novo.

---

## ✅ Implementação

### 1. Novas Perguntas Fixas

Q1: Título (text)
Q2: Descrição (text)
Q3: Tipo de Sistema (single_choice):
- apenas_api
- api_frontend
- api_mobile
- api_frontend_mobile

Q4-Q7 (condicionais baseadas em Q3):
- **Apenas API**: Q4=Backend, Q5=Database
- **API + Frontend**: Q4=Backend, Q5=Database, Q6=Frontend, Q7=CSS
- **API + Mobile**: Q4=Backend, Q5=Database, Q6=Mobile
- **API + Frontend + Mobile**: Q4=Backend, Q5=Database, Q6=Frontend, Q7=CSS, Q8=Mobile

### 2. Perguntas IA

Q8+ (ou Q6+/Q7+/Q9+ conforme tipo):
- Contexto: {título, descrição, stack_backend, stack_database, stack_frontend?, stack_css?, stack_mobile?}
- Objetivo: Coletar requisitos funcionais e de negócio
- Formato: Sempre respostas fechadas (radio/checkbox)
- Histórico: Armazenar IDs de perguntas feitas para nunca repetir

---

## 📁 Files to Create/Modify

### Create:
1. `backend/app/api/routes/interviews/simple_questions.py` - Perguntas fixas do novo fluxo

### Modify:
2. `backend/app/api/routes/interviews/endpoints.py` - Adicionar novo modo "simple"
3. `backend/app/api/routes/interviews/context_builders.py` - Contexto para perguntas IA
4. `backend/app/models/interview.py` - Campo para rastrear perguntas já feitas

---

## 🚀 Status

✅ Design completo
🚧 Implementação em andamento...

