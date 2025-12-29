# Quickstart - AI Orchestrator

## Início Rápido em 3 Passos

### 1. Configure as variáveis de ambiente

O arquivo `.env` já foi criado com valores padrão para desenvolvimento. Se você tiver uma API key do Anthropic, adicione-a agora:

```bash
# Edite o arquivo .env e adicione sua chave (opcional para setup inicial)
# ANTHROPIC_API_KEY=sk-ant-...
```

### 2. Inicie os serviços

```bash
docker-compose up --build
```

Aguarde alguns minutos na primeira execução enquanto:
- As imagens Docker são construídas
- As dependências são instaladas
- O banco de dados é inicializado

### 3. Acesse as aplicações

Quando ver a mensagem "Application startup complete", acesse:

- 🌐 **Frontend**: http://localhost:3000
- 🚀 **API Backend**: http://localhost:8000
- 📚 **Documentação da API**: http://localhost:8000/docs
- ✅ **Health Check**: http://localhost:8000/health

## Verificação Rápida

1. Abra http://localhost:3000
2. Você deve ver "API Conectada" em verde no card de status
3. Clique em "Ver Documentação da API" para explorar os endpoints

## Próximos Passos

- ✅ Setup inicial completo
- 📖 Leia [SETUP.md](SETUP.md) para detalhes avançados
- 🗺️ Consulte [PROGRESS.md](PROGRESS.md) para o roadmap
- 🏗️ Veja [META_PROMPT.md](META_PROMPT.md) para arquitetura completa

## Comandos Úteis

```bash
# Parar os serviços
docker-compose down

# Ver logs
docker-compose logs -f

# Reconstruir tudo
docker-compose up --build

# Limpar tudo e começar do zero
docker-compose down -v && docker-compose up --build
```

## Estrutura Criada

```
orbit-2.1/
├── 📄 README.md              # Documentação principal
├── 📄 SETUP.md               # Guia de setup detalhado
├── 📄 QUICKSTART.md          # Este arquivo
├── 📄 META_PROMPT.md         # Especificação completa
├── 📄 PROGRESS.md            # Roadmap e progresso
├── 🐳 docker-compose.yml     # Orquestração dos serviços
├── 📁 docker/                # Dockerfiles
├── 📁 backend/               # FastAPI + PostgreSQL
│   ├── app/                  # Código da aplicação
│   │   ├── main.py          # Entry point
│   │   ├── config.py        # Configurações
│   │   ├── database.py      # Setup do DB
│   │   ├── models/          # SQLAlchemy models
│   │   ├── schemas/         # Pydantic schemas
│   │   ├── api/routes/      # Endpoints
│   │   └── services/        # Lógica de negócio
│   ├── alembic/             # Migrações
│   └── pyproject.toml       # Dependências Python
└── 📁 frontend/             # Next.js + TypeScript
    ├── src/
    │   ├── app/             # Pages e layout
    │   ├── components/      # Componentes React
    │   ├── lib/            # Utilitários
    │   └── types/          # Tipos TypeScript
    └── package.json        # Dependências Node

🎯 Tudo pronto para começar o desenvolvimento!
```

## Status do Projeto

✅ Setup inicial completo
✅ Docker configurado
✅ Backend FastAPI rodando
✅ Frontend Next.js rodando
✅ PostgreSQL configurado
✅ Documentação criada

🚀 Próxima fase: Implementação dos modelos do banco de dados
