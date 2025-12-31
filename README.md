# Orbit - Sistema de Orquestração de IA

Sistema SPA completo para criação e orquestração de aplicações usando IA, focado na API do Claude Code e múltiplos modelos de IA.

## Descrição do Projeto

O Orbit é uma plataforma que permite:
- Realizar entrevistas conversacionais com IA para capturar requisitos
- Gerar prompts componíveis usando arquitetura Prompter
- Gerenciar tarefas em um Kanban Board interativo
- Integrar com Claude Code API para execução de tarefas
- Suportar múltiplos modelos de IA configuráveis
- Versionamento automático com commits gerados por IA

## Stack Tecnológica

### Frontend
- **Next.js** 14+ com App Router
- **TypeScript** para type safety
- **Tailwind CSS** para estilização
- **React** 18+

### Backend
- **FastAPI** (Python 3.11+)
- **PostgreSQL** para persistência de dados
- **SQLAlchemy** como ORM
- **Alembic** para migrações
- **Poetry** para gerenciamento de dependências

### DevOps
- **Docker** e **Docker Compose** para containerização
- Arquitetura em **Monorepo**

## Pré-requisitos

Antes de começar, certifique-se de ter instalado:

- [Docker](https://www.docker.com/get-started) (versão 20.10+)
- [Docker Compose](https://docs.docker.com/compose/install/) (versão 2.0+)
- [Node.js](https://nodejs.org/) (versão 18+ - apenas para desenvolvimento local)
- [Python](https://www.python.org/) (versão 3.11+ - apenas para desenvolvimento local)

## Como Rodar o Projeto

### Usando Docker (Recomendado)

1. Clone o repositório:
```bash
git clone <repository-url>
cd orbit-2.1
```

2. Configure as variáveis de ambiente:
```bash
# Backend
cp backend/.env.example backend/.env

# Frontend
cp frontend/.env.example frontend/.env
```

3. Inicie todos os serviços:
```bash
docker-compose up --build
```

4. Acesse as aplicações:
- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:8000
- **API Docs**: http://localhost:8000/docs
- **Health Check**: http://localhost:8000/health

### Desenvolvimento Local (Sem Docker)

#### Backend

```bash
cd backend
poetry install
poetry run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

#### Frontend

```bash
cd frontend
npm install
npm run dev
```

## Estrutura do Projeto

```
orbit-2.1/
├── README.md                 # Este arquivo
├── META_PROMPT.md           # Especificação completa do projeto
├── PROGRESS.md              # Acompanhamento do desenvolvimento
├── docker-compose.yml       # Orquestração dos containers
├── docker/
│   ├── backend.Dockerfile   # Imagem Docker do backend
│   └── frontend.Dockerfile  # Imagem Docker do frontend
├── backend/                 # API FastAPI
│   ├── app/
│   │   ├── main.py         # Entry point da aplicação
│   │   ├── config.py       # Configurações e variáveis de ambiente
│   │   ├── database.py     # Setup do banco de dados
│   │   ├── models/         # Modelos SQLAlchemy
│   │   ├── schemas/        # Schemas Pydantic
│   │   ├── api/            # Rotas da API
│   │   └── services/       # Lógica de negócio
│   └── alembic/            # Migrações do banco
└── frontend/               # Aplicação Next.js
    ├── src/
    │   ├── app/           # App Router do Next.js
    │   ├── components/    # Componentes React
    │   ├── lib/          # Utilitários e helpers
    │   └── types/        # Tipos TypeScript
    └── public/           # Arquivos estáticos
```

## Funcionalidades Principais

1. **Sistema de Entrevista**: Chat conversacional com IA para captura de requisitos
2. **Geração de Prompts**: Criação automática usando arquitetura Prompter
3. **Kanban Board**: Gerenciamento visual de tarefas com drag-and-drop
4. **Integração Claude Code**: Execução de tarefas via API
5. **Multi-Modelos**: Suporte para diversos modelos de IA
6. **Versionamento Inteligente**: Commits automáticos gerados por IA

## Scripts Disponíveis

### Backend
- `poetry run uvicorn app.main:app --reload` - Inicia o servidor de desenvolvimento
- `poetry run alembic upgrade head` - Aplica migrações do banco
- `poetry run alembic revision --autogenerate -m "message"` - Cria nova migração
- `poetry run pytest` - Executa os testes

### Frontend
- `npm run dev` - Inicia o servidor de desenvolvimento
- `npm run build` - Cria build de produção
- `npm run start` - Inicia servidor de produção
- `npm run lint` - Executa o linter

## Variáveis de Ambiente

### Backend (.env)
- `DATABASE_URL` - URL de conexão do PostgreSQL
- `SECRET_KEY` - Chave secreta para JWT
- `ANTHROPIC_API_KEY` - Chave da API do Claude
- `ENVIRONMENT` - Ambiente de execução (development/production)

### Frontend (.env.local)
- `NEXT_PUBLIC_API_URL` - URL da API backend
- `NEXT_PUBLIC_APP_NAME` - Nome da aplicação

## Documentação Adicional

- [META_PROMPT.md](META_PROMPT.md) - Especificação completa e arquitetura do sistema
- [PROGRESS.md](PROGRESS.md) - Status atual e roadmap do desenvolvimento

## Contribuindo

Este é um projeto em desenvolvimento ativo. Para contribuir:

1. Consulte o [PROGRESS.md](PROGRESS.md) para ver as tarefas em andamento
2. Siga os padrões de código estabelecidos
3. Adicione testes para novas funcionalidades
4. Atualize a documentação conforme necessário

## Licença

[Definir licença]

## Suporte

Para questões e suporte, consulte a documentação ou abra uma issue no repositório.
