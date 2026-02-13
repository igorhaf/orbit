# Setup Guide - AI Orchestrator

Este guia fornece instruções passo a passo para configurar e executar o AI Orchestrator.

## Pré-requisitos

Certifique-se de ter os seguintes softwares instalados:

- **Docker**: versão 20.10 ou superior
- **Docker Compose**: versão 2.0 ou superior

### Verificar instalação

```bash
docker --version
docker-compose --version
```

## Configuração Inicial

### 1. Clone o repositório (se ainda não fez)

```bash
git clone <repository-url>
cd orbit-2.1
```

### 2. Configure as variáveis de ambiente

Copie o arquivo de exemplo e edite conforme necessário:

```bash
cp .env.example .env
```

Edite o arquivo `.env` e configure:
- `ANTHROPIC_API_KEY`: Sua chave da API do Claude (opcional para setup inicial)
- `SECRET_KEY`: Altere para uma chave segura em produção
- `POSTGRES_PASSWORD`: Altere para uma senha segura em produção

Os arquivos de ambiente já estão configurados para backend e frontend, mas você pode personalizá-los:

```bash
# Backend
backend/.env

# Frontend
frontend/.env.local
```

## Executando o Projeto

### Opção 1: Usando Docker (Recomendado)

Esta é a maneira mais simples de executar o projeto completo.

#### Iniciar todos os serviços

```bash
docker-compose up --build
```

O comando acima irá:
1. Construir as imagens Docker do backend e frontend
2. Iniciar o PostgreSQL
3. Executar as migrações do banco de dados
4. Iniciar o backend FastAPI
5. Iniciar o frontend Next.js

#### Executar em segundo plano

```bash
docker-compose up -d
```

#### Ver logs

```bash
# Todos os serviços
docker-compose logs -f

# Apenas backend
docker-compose logs -f backend

# Apenas frontend
docker-compose logs -f frontend
```

#### Parar os serviços

```bash
docker-compose down
```

#### Parar e remover volumes (limpar banco de dados)

```bash
docker-compose down -v
```

### Opção 2: Desenvolvimento Local (Sem Docker)

Para desenvolvimento local sem Docker, você precisará ter Python 3.11+ e Node.js 18+ instalados.

#### Backend

1. Entre no diretório do backend:
```bash
cd backend
```

2. Instale o Poetry (se ainda não tiver):
```bash
curl -sSL https://install.python-poetry.org | python3 -
```

3. Instale as dependências:
```bash
poetry install
```

4. Certifique-se de que o PostgreSQL está rodando e configure a `DATABASE_URL` no `.env`

5. Execute as migrações:
```bash
poetry run alembic upgrade head
```

6. Inicie o servidor:
```bash
poetry run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

#### Frontend

1. Entre no diretório do frontend:
```bash
cd frontend
```

2. Instale as dependências:
```bash
npm install
```

3. Inicie o servidor de desenvolvimento:
```bash
npm run dev
```

## Verificando a Instalação

Após iniciar os serviços, verifique se tudo está funcionando:

### 1. Backend API

- **Health Check**: http://localhost:8000/health
- **API Docs (Swagger)**: http://localhost:8000/docs
- **API Docs (ReDoc)**: http://localhost:8000/redoc

Você deve ver uma resposta JSON como:
```json
{
  "status": "ok",
  "version": "0.1.0",
  "environment": "development",
  "app_name": "AI Orchestrator API"
}
```

### 2. Frontend

- **Aplicação**: http://localhost:3000

Você deve ver a página inicial com:
- Status da API (deve aparecer "API Conectada" em verde)
- Cards com as funcionalidades principais
- Links para documentação

### 3. Banco de Dados

O PostgreSQL estará disponível em:
- **Host**: localhost
- **Porta**: 5432
- **Database**: ai_orchestrator
- **Usuário**: aiorch
- **Senha**: aiorch_dev_password (ou o que você configurou)

Você pode conectar usando qualquer cliente PostgreSQL (DBeaver, pgAdmin, etc.)

## Comandos Úteis

### Docker

```bash
# Reconstruir apenas um serviço
docker-compose up --build backend

# Executar comando dentro do container
docker-compose exec backend poetry run alembic upgrade head
docker-compose exec frontend npm run build

# Ver status dos containers
docker-compose ps

# Limpar tudo (containers, volumes, images)
docker-compose down -v --rmi all
```

### Backend

```bash
# Criar nova migração
cd backend
poetry run alembic revision --autogenerate -m "description"

# Executar testes (quando implementados)
poetry run pytest

# Formatar código
poetry run black app/
poetry run isort app/

# Verificar tipos
poetry run mypy app/
```

### Frontend

```bash
# Build de produção
cd frontend
npm run build

# Verificar tipos
npm run type-check

# Formatar código
npm run format

# Lint
npm run lint
```

## Solução de Problemas

### Porta já em uso

Se você receber erro de porta já em uso, pode:

1. Parar o processo que está usando a porta
2. Ou alterar a porta no `docker-compose.yml` e nos arquivos `.env`

### Erro de permissão no Docker

Se tiver problemas de permissão:

```bash
sudo usermod -aG docker $USER
newgrp docker
```

### Backend não conecta ao banco

1. Verifique se o PostgreSQL iniciou corretamente:
```bash
docker-compose logs postgres
```

2. Verifique se a `DATABASE_URL` está correta no `.env`

3. Aguarde alguns segundos - o backend espera 5 segundos para o banco estar pronto

### Frontend não conecta ao backend

1. Verifique se o backend está rodando
2. Verifique se a `NEXT_PUBLIC_API_URL` está correta no `.env.local`
3. Limpe o cache do navegador

## Próximos Passos

Após o setup estar funcionando:

1. Consulte o [PROGRESS.md](PROGRESS.md) para ver o roadmap de desenvolvimento
2. Leia o [META_PROMPT.md](META_PROMPT.md) para entender a arquitetura completa
3. Explore a documentação da API em http://localhost:8000/docs
4. Comece a desenvolver as funcionalidades conforme o plano

## Estrutura de Desenvolvimento

```
orbit-2.1/
├── backend/          # FastAPI + PostgreSQL
│   ├── app/          # Código da aplicação
│   ├── alembic/      # Migrações do banco
│   └── tests/        # Testes (a implementar)
├── frontend/         # Next.js + TypeScript
│   ├── src/          # Código da aplicação
│   │   ├── app/      # Pages (App Router)
│   │   ├── components/ # Componentes React
│   │   ├── lib/      # Utilitários
│   │   └── types/    # Tipos TypeScript
│   └── public/       # Arquivos estáticos
└── docker/           # Dockerfiles
```

## Suporte

Se encontrar problemas:

1. Verifique os logs: `docker-compose logs -f`
2. Consulte a documentação em [README.md](README.md)
3. Verifique se todas as variáveis de ambiente estão configuradas
4. Tente reconstruir tudo: `docker-compose down -v && docker-compose up --build`
