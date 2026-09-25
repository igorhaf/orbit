# MyTrello

Aplicação Kanban inspirada no Trello, feita com Next.js, NestJS, PostgreSQL e Tailwind CSS. Roda diretamente na máquina, sem Docker.

## Funcionalidades desta etapa

- Acesso por e-mail e senha para uma conta única
- Perfil com nome, avatar, atividade, cartões atribuídos e preferências pessoais
- Temas claro e escuro, cartões compactos, atalhos e preferências de notificações
- Home com Up Next, Highlights, Your Items, conversas, quadros recentes e favoritos
- Quadros organizados por áreas de trabalho, favoritos reordenáveis e visitas recentes
- Cópia de quadros com listas, cartões, etiquetas, checklists e fundo; edição do nome e da descrição com links e menções
- Planos de fundo por cor ou imagem local (PNG, JPEG e WebP até 1,5 MB), guardada no PostgreSQL
- Atividade do quadro com filtro de comentários, link compartilhável e impressão de quadros e cartões
- Fechamento reversível de quadros, reabertura e exclusão permanente pelo proprietário
- Alternador de quadros com painel lateral fixável e pesquisa global de quadros e cartões
- Central de notificações por prazo e menção; alertas do navegador quando autorizados
- Desfazer/refazer de ações compatíveis durante a sessão (títulos, favoritos, movimentação, conclusão, descrição e prazos)
- Listas e cartões com arrastar e soltar, etiquetas, prazos, checklists, atribuições e comentários

O cadastro e os convites estão desativados nesta etapa de conta única. Exclusões permanentes não entram no histórico de desfazer.

## Requisitos

- Node.js 20.19+ e npm
- PostgreSQL local ou remoto

## Instalação

1. Crie um banco vazio no PostgreSQL. Exemplo, usando uma conta com permissão:

   ```bash
   createdb mytrello
   ```

2. Instale as dependências e prepare as variáveis:

   ```bash
   npm install
   cp .env.example apps/api/.env
   cp .env.example apps/web/.env.local
   ```

3. Edite `DATABASE_URL` em `apps/api/.env` com a conexão real do seu PostgreSQL. Defina `JWT_SECRET` com uma chave aleatória de pelo menos 32 caracteres (por exemplo, gere uma com `openssl rand -hex 32`). Se alterar as portas, ajuste `WEB_ORIGIN` e `NEXT_PUBLIC_API_URL` também.

4. Crie as tabelas, configure a conta inicial e inicie os servidores:

   ```bash
   npm run db:migrate
   npm run dev
   ```

Abra **http://localhost:3000**. A API fica em **http://localhost:4000** e oferece `GET /health` para checagem.

## Conta inicial

- E-mail: `igorhaf@gmail.com`
- Senha: a senha informada na especificação desta etapa

A migração guarda apenas o hash da senha e reconfigura esse acesso a cada execução. Altere a senha inicial antes de disponibilizar o sistema publicamente.

## Comandos

| Comando | Função |
| --- | --- |
| `npm run dev` | Inicia Next.js e NestJS em desenvolvimento |
| `npm run lint` | Verifica o código da API e do front, sem aceitar avisos |
| `npm run lint:fix` | Corrige automaticamente os problemas de lint possíveis |
| `npm run build` | Executa o lint e compila a API e o front |
| `npm run db:migrate` | Aplica o esquema SQL e prepara a conta inicial |
| `npm run start -w apps/api` | Inicia a API compilada |
| `npm run start -w apps/web` | Inicia o front compilado |

O SQL fica em `apps/api/sql/schema.sql`.

Antes de cada commit, o hook de Git executa `npm run build`. Se houver erro ou aviso de lint, corrija, execute o build novamente e só então faça o commit. O hook é instalado por `npm install` via Husky.
