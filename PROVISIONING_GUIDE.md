# 🚀 Guia de Provisionamento Manual - ORBIT

## ⚠️ IMPORTANTE: Provisionamento NÃO é Automático!

Quando você **cria um projeto** no ORBIT, ele é salvo no **banco de dados PostgreSQL**.
A **pasta física** em `./projects/` só é criada quando você **provisiona** o projeto.

---

## 📋 Passo a Passo Completo

### 1️⃣ Criar Projeto no ORBIT

Via interface web:
```
http://localhost:3000/projects → "New Project"
```

Isso salva no banco de dados:
```sql
INSERT INTO projects (id, name, description, created_at)
VALUES ('uuid', 'Meu Projeto', 'Descrição', NOW());
```

✅ **Projeto criado no banco**
❌ **Pasta NÃO criada ainda**

---

### 2️⃣ Criar Entrevista para o Projeto

Via interface web:
```
http://localhost:3000/interviews → "New Interview" → Selecionar projeto
```

Ou via API:
```bash
curl -X POST http://localhost:8000/api/v1/interviews/ \
  -H "Content-Type: application/json" \
  -d '{
    "project_id": "seu-project-id-aqui",
    "ai_model_used": "system",
    "conversation_data": []
  }'
```

---

### 3️⃣ Responder Perguntas 3-6 (Stack)

Durante a entrevista, responda:

- **Q3:** Backend framework (Laravel, Django, FastAPI, Express)
- **Q4:** Database (PostgreSQL, MySQL, MongoDB, SQLite)
- **Q5:** Frontend framework (Next.js, React, Vue, Angular, None)
- **Q6:** CSS framework (Tailwind CSS, Bootstrap, Material UI, Custom)

Após responder, o frontend chama:
```bash
POST /api/v1/interviews/{interview_id}/save-stack
{
  "backend": "laravel",
  "database": "postgresql",
  "frontend": "none",
  "css": "tailwind"
}
```

Isso salva em `project.stack` no banco de dados.

✅ **Stack configurado no banco**
❌ **Pasta ainda NÃO criada**

---

### 4️⃣ Provisionar o Projeto (CRIAR PASTA)

**Opção A: Via Script de Teste**
```bash
cd backend
./test_provision_manual.sh
```

O script vai:
1. Listar projetos
2. Pedir para você escolher um
3. Verificar se tem stack configurado
4. Chamar endpoint `/provision`
5. Mostrar credenciais e próximos passos

---

**Opção B: Via API Manualmente**

```bash
# 1. Pegar ID da entrevista
curl http://localhost:8000/api/v1/interviews/?project_id=SEU_PROJECT_ID

# 2. Chamar endpoint de provisionamento
curl -X POST http://localhost:8000/api/v1/interviews/SEU_INTERVIEW_ID/provision
```

---

**Opção C: Via Swagger UI**

1. Abrir http://localhost:8000/docs
2. Encontrar `POST /api/v1/interviews/{interview_id}/provision`
3. Clicar "Try it out"
4. Inserir `interview_id`
5. Clicar "Execute"

---

### 5️⃣ Acessar Projeto Provisionado

Após provisionar com sucesso:

```bash
# Ver projeto criado
ls projects/
# meu-projeto/

# Entrar no projeto
cd projects/meu-projeto

# Rodar setup
./setup.sh
```

O `setup.sh` vai:
- Instalar framework (Laravel, Next.js, etc.)
- Configurar banco de dados
- Instalar Tailwind CSS
- Buildar containers Docker
- Subir todos os serviços

---

## 🔍 Verificar se Provisionamento é Necessário

### Projeto JÁ provisionado?
```bash
ls projects/
# Se aparecer seu projeto → JÁ provisionado ✅
# Se vazio ou não aparecer → Precisa provisionar ❌
```

### Projeto tem stack configurado?
```bash
# Via API
curl http://localhost:8000/api/v1/projects/SEU_PROJECT_ID | jq '.stack'

# Se retornar null → Precisa responder perguntas 3-6 primeiro
# Se retornar {"backend": "...", ...} → Stack configurado ✅
```

---

## 🐛 Erros Comuns

### Erro: "Project stack not configured"
**Causa:** Você não respondeu as perguntas 3-6 da entrevista
**Solução:** Responda as 4 perguntas de stack na entrevista

---

### Erro: "Stack combination not supported"
**Causa:** Combinação de stack sem script de provisionamento
**Solução:** Use uma combinação suportada:
- Laravel + PostgreSQL + Tailwind
- Next.js + PostgreSQL + Tailwind
- FastAPI + React + PostgreSQL + Tailwind

---

### Erro: "Project directory already exists"
**Causa:** Você já provisionou esse projeto antes
**Solução:**
```bash
# Remover projeto antigo
rm -rf projects/meu-projeto

# Provisionar novamente
curl -X POST .../provision
```

---

### Erro: "Interview not found"
**Causa:** Projeto não tem entrevista associada
**Solução:** Criar entrevista primeiro (passo 2️⃣)

---

## 📊 Stacks Suportados

### ✅ Laravel + PostgreSQL
```json
{
  "backend": "laravel",
  "database": "postgresql",
  "frontend": "none",
  "css": "tailwind"
}
```
→ Script: `laravel_setup.sh`
→ Portas: 8080 (app), 5433 (db), 8081 (adminer)

---

### ✅ Next.js + PostgreSQL
```json
{
  "backend": "none",
  "database": "postgresql",
  "frontend": "nextjs",
  "css": "tailwind"
}
```
→ Script: `nextjs_setup.sh`
→ Portas: 3002 (app), 5434 (db), 8082 (adminer)

---

### ✅ FastAPI + React + PostgreSQL
```json
{
  "backend": "fastapi",
  "database": "postgresql",
  "frontend": "react",
  "css": "tailwind"
}
```
→ Script: `fastapi_react_setup.sh`
→ Portas: 3003 (frontend), 8001 (backend), 5435 (db), 8083 (adminer)

---

## 🎯 Resumo do Fluxo

```
1. Criar Projeto (Web UI)
   ↓ (salva no PostgreSQL)

2. Criar Entrevista (Web UI)
   ↓

3. Responder Q3-Q6 (Web UI)
   ↓ (salva stack em project.stack)

4. Provisionar (Script ou API)
   ↓ (executa laravel_setup.sh ou nextjs_setup.sh)

5. Pasta criada em ./projects/
   ↓

6. Rodar ./setup.sh
   ↓

7. Projeto rodando! 🚀
```

---

## 🔜 Próxima Implementação

**UI Integration (PROMPT #60):**

Adicionar botão "🚀 Provisionar Projeto" na interface da entrevista que aparece automaticamente após responder as 6 perguntas.

Quando implementado, você poderá provisionar com **um clique** ao invés de chamar API manualmente.

---

## 📝 Exemplo Completo

```bash
# 1. Backend rodando
docker-compose up -d

# 2. Criar projeto via UI
# http://localhost:3000/projects → "New Project"
# Nome: "Minha API Laravel"
# ID retornado: 550e8400-e29b-41d4-a716-446655440000

# 3. Criar entrevista via API
curl -X POST http://localhost:8000/api/v1/interviews/ \
  -H "Content-Type: application/json" \
  -d '{
    "project_id": "550e8400-e29b-41d4-a716-446655440000",
    "ai_model_used": "system"
  }'
# ID retornado: 660f9511-f3ac-52e5-b827-557766551111

# 4. Configurar stack via API
curl -X POST http://localhost:8000/api/v1/interviews/660f9511-f3ac-52e5-b827-557766551111/save-stack \
  -H "Content-Type: application/json" \
  -d '{
    "backend": "laravel",
    "database": "postgresql",
    "frontend": "none",
    "css": "tailwind"
  }'

# 5. Provisionar projeto
curl -X POST http://localhost:8000/api/v1/interviews/660f9511-f3ac-52e5-b827-557766551111/provision

# Resposta:
# {
#   "success": true,
#   "project_name": "minha-api-laravel",
#   "project_path": "./projects/minha-api-laravel",
#   "credentials": {
#     "database": "minha_api_laravel",
#     "username": "minha_api_laravel_user",
#     "password": "Ab12Cd34Ef56=="
#   },
#   "next_steps": [
#     "cd projects/minha-api-laravel",
#     "./setup.sh"
#   ]
# }

# 6. Setup
cd projects/minha-api-laravel
./setup.sh

# 7. Acessar
open http://localhost:8080
```

---

**Última atualização:** December 31, 2025
**Versão:** 1.0
**Relacionado:** PROMPT #59 - Automated Project Provisioning
