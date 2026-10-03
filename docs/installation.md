# Instalação do Orbit

Este guia cobre uma instalação local do Orbit e a configuração do Codex CLI usado pelo recurso **Execução** dos cartões. Os comandos abaixo foram escritos para Linux com `bash`/`zsh`; para produção, use os mesmos valores em um gerenciador de serviços e mantenha segredos fora do controle de versão.

## Requisitos

- Node.js 20.19 ou superior e npm.
- PostgreSQL local ou remoto, acessível pela máquina que executa a API.
- Git para obter o código-fonte.
- Para executar cartões com o Codex: uma conta Codex autenticada para o mesmo usuário do sistema operacional que executa a API.

O Orbit roda diretamente na máquina; Docker não é necessário.

## Obter o código e instalar dependências

Na pasta onde o projeto será mantido:

```bash
git clone <URL-DO-REPOSITÓRIO> orbit
cd orbit
npm install
```

Se o repositório já estiver clonado, entre na pasta do projeto e atualize para a revisão desejada antes de instalar as dependências.

## Preparar o PostgreSQL e as variáveis

Crie um banco vazio e um usuário com permissão de conexão e alteração do esquema. Por exemplo, se o PostgreSQL local permitir:

```bash
createdb orbit
```

Crie os arquivos de configuração:

```bash
cp .env.example apps/api/.env
cp .env.example apps/web/.env.local
```

Edite `apps/api/.env` e configure pelo menos:

- `DATABASE_URL`: conexão do banco, por exemplo `postgresql://orbit_user:senha@localhost:5432/orbit`.
- `JWT_SECRET`: segredo aleatório com pelo menos 32 caracteres. Gere com `openssl rand -hex 32`.
- `ORBIT_BACKUP_KEY`: chave independente para criptografar backups. Gere outra chave com `openssl rand -hex 32` e guarde uma cópia fora deste servidor.
- `ORBIT_SECRET_KEY` e `VAULT_ENCRYPTION_KEY`: chaves independentes para criptografia das credenciais de integrações e do cofre. Gere cada uma com `openssl rand -hex 32`.
- `API_PORT`, `WEB_ORIGIN` e `NEXT_PUBLIC_API_URL`: ajuste se for usar portas ou origens diferentes das locais.

Não reutilize a mesma chave para banco, backup, integrações e cofre. Não envie arquivos `.env` ao Git, e não perca a chave de backup: sem ela, um arquivo criptografado não pode ser restaurado.

## Instalar o Codex CLI corrigido no Linux

O recurso de execução usa `CODEX_BIN` para iniciar o Codex CLI. Prefira apontar para um binário independente instalado pelo npm; a extensão do editor pode fornecer outra versão e continuar aparecendo primeiro no `PATH`.

O erro `mountinfo path is not absolute` é causado pela validação de mounts de namespace no sandbox Linux. O conserto oficial foi integrado em 19 de setembro de 2026 no PR [Allow unrelated namespace mounts in Linux sandbox socket checks](https://github.com/openai/codex/pull/46535). Use uma versão estável publicada depois desse conserto. A versão usada e verificada ao preparar este guia foi `@openai/codex 0.159.2` (`codex-cli 0.159.2`). Confira a versão disponível e as notas nas [releases oficiais](https://github.com/openai/codex/releases) antes de atualizar instalações futuras.

Instale uma cópia isolada no diretório pessoal do usuário que executará a API:

```bash
mkdir -p "$HOME/.local/opt/orbit-codex"
npm install --prefix "$HOME/.local/opt/orbit-codex" @openai/codex@0.159.2
```

Confirme o caminho e a versão:

```bash
"$HOME/.local/opt/orbit-codex/node_modules/.bin/codex" --version
```

A saída deve indicar `codex-cli 0.159.2`. O número mostrado por `command -v codex` pode apontar para a extensão do editor; para evitar ambiguidade, configure `CODEX_BIN` com o caminho absoluto do binário recém-instalado.

### Autenticação

Autentique o Codex como o mesmo usuário do sistema operacional que roda a API. A sessão usada no terminal de outra conta não estará automaticamente disponível para o serviço. Confira o estado com `codex login status`; se necessário, execute `codex login` em um terminal interativo dessa conta e conclua o login. Não copie tokens de sessão para arquivos do Orbit nem os inclua em logs.

### Configurar o Orbit para usar o binário

Defina em `apps/api/.env`:

```dotenv
CODEX_BIN="/home/SEU_USUARIO/.local/opt/orbit-codex/node_modules/.bin/codex"
CODEX_AI_TIMEOUT_MS=300000
ORBIT_EXECUTION_TIMEOUT_MS=300000
```

Substitua `SEU_USUARIO` pelo diretório pessoal real da conta que executa a API. O campo **Executável Codex** também pode ser ajustado pela aba **Perfil → Integrações → Configurações do servidor → Execução e IA**. Depois de alterar configurações, reinicie a API. O Orbit lê `CODEX_BIN` tanto para sugestões e sessões de prompt quanto para a execução de cartões.

O valor já configurado nesta cópia local aponta para `/home/meada/.local/opt/orbit-codex/node_modules/.bin/codex`. Em outra máquina, use o caminho correspondente àquela instalação.

### Verificar sandbox e escrita

Confirme primeiro que o executável responde e informa a versão esperada:

```bash
"$HOME/.local/opt/orbit-codex/node_modules/.bin/codex" --version
```

O Orbit mantém as sessões do Codex em `.orbit/sessions` na raiz do repositório. O login existente continua sendo usado por meio de um link simbólico para o `auth.json` do `CODEX_HOME` global. As sessões iniciadas pelo Orbit usam acesso total ao ambiente e não ficam limitadas pelo sandbox; execute apenas instruções e projetos confiáveis.

Para verificar a escrita pelo executor, peça para criar uma pasta de teste vazia dentro de um projeto confiável. Confira que a pasta existe e remova-a em seguida. Use um nome único e confira o caminho antes de remover arquivos.

Antes de as sessões do Orbit passarem a usar acesso total, uma chamada real em `/home/meada/projetos/pindorama` usou `codex-cli 0.159.2`, criou `.orbit-sandbox-check-20260930` no modo `workspace-write`, confirmou que estava vazia e removeu a pasta de teste após a verificação.

## Aplicar o esquema e iniciar

Com o banco disponível e os arquivos `.env` configurados:

```bash
npm run db:migrate
npm run dev
```

Abra <http://localhost:3000>. A API estará em <http://localhost:4000>; `GET /health` verifica sua disponibilidade. Para executar cartões, inicie a API depois de instalar e configurar o Codex, e confira se o serviço está sob o usuário autenticado no Codex.

Para um processo de produção, compile antes e inicie os workspaces compilados:

```bash
npm run build
npm run start -w apps/api
npm run start -w apps/web
```

Use um supervisor (por exemplo, systemd) para manter os processos ativos e reiniciá-los após atualização. Garanta que ele carregue as variáveis do backend e execute a API a partir do workspace `apps/api`, onde está o arquivo de configuração do servidor.

## Atualizações e recuperação

Antes de uma mudança de versão, atualize o código, instale dependências, confira as variáveis e aplique `npm run db:migrate`. Mantenha backups verificados e guarde a chave de criptografia separadamente. O guia [Backups do banco e recuperação](database-backups.md) descreve a cópia PostgreSQL, o Google Drive e o procedimento de restauração.

Para uma mudança manual de esquema, gere e verifique um backup antes de alterar o banco. Não restaure sobre o banco ativo sem confirmar o banco de destino: o procedimento recomendado restaura primeiro para uma base nova e só então valida os dados.

## Diagnóstico

| Sintoma | Verificação |
| --- | --- |
| `O executável local do Codex não foi encontrado` | Confirme se `CODEX_BIN` contém um caminho absoluto existente e se o usuário da API tem permissão de execução. |
| O Orbit ainda inicia a versão da extensão | Confira a configuração salva em `apps/api/.env`, reinicie a API e confira o caminho absoluto salvo. |
| `mountinfo path is not absolute` | Verifique a versão efetiva em `CODEX_BIN --version`; substitua uma versão antiga/alpha por uma release posterior à correção oficial e reinicie a API. |
| Falha de login ou cota | Confirme a autenticação da conta do usuário que executa a API e confira a cota da conta. |
| O cartão diz que terminou, mas não há alteração | Leia a saída e o histórico da execução; confira a existência e o conteúdo esperado no caminho exato antes de tratar a tarefa como concluída. |
| Não conecta ao PostgreSQL | Verifique `DATABASE_URL`, disponibilidade do serviço, credenciais, porta e permissões do banco. |

Não desative o sandbox para contornar falhas de montagem. Instale uma versão corrigida e mantenha `workspace-write` limitado ao projeto selecionado.
