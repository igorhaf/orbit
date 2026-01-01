# 🚀 Guia de Provisionamento Automático - ORBIT

## ✅ PROVISIONAMENTO AUTOMÁTICO HABILITADO! (PROMPT #60)

Quando você **responde às perguntas de stack** (Q3-Q6) durante a entrevista, o projeto é **automaticamente provisionado** e a pasta é criada em `./backend/projects/`.

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
❌ **Pasta NÃO criada ainda** (aguardando stack)

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

- **Q3:** Backend framework (Laravel, Django, FastAPI, Express, None)
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

🎉 **PROVISIONAMENTO AUTOMÁTICO É EXECUTADO!**

O endpoint `save-stack` automaticamente:
1. Salva o stack no banco de dados
2. Valida a combinação de stack contra specs database
3. Seleciona o script de provisionamento apropriado
4. Executa o script e cria a pasta em `./backend/projects/`
5. Gera credenciais aleatórias do banco de dados
6. Retorna informações de sucesso com credenciais e próximos passos

✅ **Stack configurado no banco**
✅ **Pasta CRIADA AUTOMATICAMENTE**
✅ **Credenciais geradas**
✅ **Projeto provisionado!**

---

## 📁 Estrutura de Pastas Criadas

Todos os projetos são criados em:
```
orbit-2.1/backend/projects/<project-name>/
```

**Exemplo:**
```
backend/projects/
├── meu-projeto-laravel/
│   ├── docker-compose.yml
│   ├── Dockerfile
│   ├── .env
│   ├── setup.sh
│   └── README.md
└── meu-projeto-nextjs/
    ├── docker-compose.yml
    ├── Dockerfile
    ├── .env.local
    ├── setup.sh
    └── README.md
```

**Importante:** A pasta `/backend/projects/` está gitignored e não é rastreada pelo controle de versão.

---

## 🔍 Verificar se Provisionamento foi Bem-Sucedido

### Via Response da API:
```json
{
  "success": true,
  "message": "Stack configuration saved: laravel + postgresql + none + tailwind",
  "provisioning": {
    "attempted": true,
    "success": true,
    "project_path": "/app/projects/meu-projeto-laravel",
    "project_name": "meu-projeto-laravel",
    "credentials": {
      "database": "5433",
      "username": "meu_projeto_laravel_user",
      "password": "Ab12Cd34Ef56==",
      "application_port": "8080",
      "database_port": "5433",
      "adminer_port": "8081"
    },
    "next_steps": [
      "cd backend/projects/meu-projeto-laravel",
      "./setup.sh"
    ],
    "script_used": "laravel_setup.sh"
  }
}
```

### Via Filesystem:
```bash
ls backend/projects/
# Se aparecer seu projeto → Provisionado ✅
```

---

## 🐛 Erros Comuns

### Erro: "Stack combination not supported"
**Causa:** Combinação de stack sem script de provisionamento
**Solução:** Use uma combinação suportada:
- Laravel + PostgreSQL + None + Tailwind
- None + PostgreSQL + Next.js + Tailwind
- FastAPI + PostgreSQL + React + Tailwind

---

### Erro: "Technology 'xxx' not found in yyy specs"
**Causa:** Tecnologia não cadastrada no banco de specs
**Solução:** Verifique se a tecnologia existe em `specs` table

---

### Erro: "Project directory already exists"
**Causa:** Você já provisionou esse projeto antes
**Solução:**
```bash
# Remover projeto antigo
rm -rf backend/projects/meu-projeto

# Salvar stack novamente para reprovisionar
curl -X POST .../save-stack
```

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
→ Localização: `backend/projects/<project-name>/`

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
→ Localização: `backend/projects/<project-name>/`

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
→ Localização: `backend/projects/<project-name>/`

---

## 🎯 Resumo do Fluxo Automático

```
1. Criar Projeto (Web UI ou API)
   ↓ (salva no PostgreSQL)

2. Criar Entrevista (Web UI ou API)
   ↓

3. Responder Q3-Q6 (Stack)
   ↓ (chama /save-stack)

4. 🎉 PROVISIONAMENTO AUTOMÁTICO 🎉
   ├─ Valida stack contra specs database
   ├─ Seleciona script apropriado
   ├─ Executa script de provisionamento
   ├─ Cria pasta em ./backend/projects/
   ├─ Gera credenciais aleatórias
   └─ Retorna sucesso + credenciais

5. Pasta criada automaticamente!
   ↓

6. Rodar ./setup.sh
   ↓

7. Projeto rodando! 🚀
```

---

## 🚀 Próximos Passos Após Provisionamento

### 1. Acessar o Projeto Provisionado

```bash
# Ir para o projeto
cd backend/projects/meu-projeto

# Ver arquivos criados
ls -la

# Ver README com instruções
cat README.md
```

### 2. Executar Setup

```bash
# Rodar script de setup (instala dependências, configura Docker, etc)
./setup.sh
```

O `setup.sh` vai:
- Instalar framework (Laravel, Next.js, etc.)
- Configurar banco de dados
- Instalar Tailwind CSS
- Buildar containers Docker
- Subir todos os serviços

### 3. Acessar Aplicação

```bash
# Laravel
open http://localhost:8080

# Next.js
open http://localhost:3002

# FastAPI + React
open http://localhost:3003  # Frontend
open http://localhost:8001  # Backend API
```

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

# 4. Configurar stack (PROVISIONAMENTO AUTOMÁTICO ACONTECE!)
curl -X POST http://localhost:8000/api/v1/interviews/660f9511-f3ac-52e5-b827-557766551111/save-stack \
  -H "Content-Type: application/json" \
  -d '{
    "backend": "laravel",
    "database": "postgresql",
    "frontend": "none",
    "css": "tailwind"
  }'

# Resposta (PROVISIONAMENTO JÁ EXECUTADO!):
# {
#   "success": true,
#   "provisioning": {
#     "success": true,
#     "project_name": "minha-api-laravel",
#     "project_path": "/app/projects/minha-api-laravel",
#     "credentials": {
#       "database": "5433",
#       "username": "minha_api_laravel_user",
#       "password": "Ab12Cd34Ef56=="
#     },
#     "next_steps": [
#       "cd backend/projects/minha-api-laravel",
#       "./setup.sh"
#     ]
#   }
# }

# 5. Verificar pasta criada
ls backend/projects/
# minha-api-laravel/  ← CRIADO AUTOMATICAMENTE!

# 6. Setup
cd backend/projects/minha-api-laravel
./setup.sh

# 7. Acessar
open http://localhost:8080
```

---

## ⚙️ Como Funciona Internamente

### Endpoint: `POST /api/v1/interviews/{interview_id}/save-stack`

**Fluxo:**
1. Recebe stack configuration (backend, database, frontend, css)
2. Salva no banco de dados (`project.stack_*` fields)
3. **AUTOMATICAMENTE** chama `ProvisioningService`
4. `ProvisioningService.validate_stack()` - Valida contra specs database
5. `ProvisioningService.get_provisioning_script()` - Seleciona script
6. `ProvisioningService.provision_project()` - Executa script
7. Script cria pasta em `./projects/` (Docker: `/app/projects/`)
8. Retorna sucesso + credenciais

**Se houver erro:**
```json
{
  "success": true,
  "message": "Stack configuration saved: ...",
  "provisioning": {
    "attempted": true,
    "success": false,
    "error": "Stack combination not supported for provisioning"
  }
}
```

---

## 🔐 Segurança

### Credenciais do Banco de Dados
- **Database name:** `<project-name>` (underscored)
- **Username:** `<project-name>_user`
- **Password:** Random 16-character base64 string

### Secret Keys
- **Laravel:** Auto-generated via `php artisan key:generate`
- **Next.js:** Not required (SSR)
- **FastAPI:** Random 32-character base64 string (for JWT)

### Sanitização de Nomes
- Nomes de projeto são sanitizados para prevenir directory traversal
- Apenas letras, números e hífens são permitidos
- Espaços e underscores são convertidos para hífens

---

**Última atualização:** December 31, 2025 (PROMPT #60)
**Versão:** 2.0 - Provisionamento Automático
**Relacionado:**
- PROMPT #59 - Automated Project Provisioning (backend service)
- PROMPT #60 - Automatic Provisioning Integration (auto-trigger on stack save)
