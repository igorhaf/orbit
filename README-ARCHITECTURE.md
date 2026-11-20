# Orbit: CONTROL, DEV, PROD, Safdoulas e Suindá

Esta instalação usa Docker Compose em uma máquina. Os ambientes mantêm serviços,
configurações e bancos isolados, enquanto o código está consolidado neste
repositório, branch única `main`, com snapshot inicial marcado por
`orbit-monorepo-baseline-2026-11-10`. Os diretórios de aplicação ainda preservam
as cópias de cada runtime; a extração de um core compartilhado é uma etapa
separada da consolidação Git.

| Ambiente | Código executado | Quadro de trabalho | Caminho alvo | Branch |
| --- | --- | --- | --- | --- |
| DEV (`:3001`) | `forge/app` | Orbit | `workspace/app` | `main` |
| PROD (`:3000`) | `workspace/app` | Safdoulas | `safdoulas/app` | `main` |
| Safdoulas (`:3002`) | `safdoulas/app` | validação do cliente | — | `main` |
| Suindá (`:3003`) | `suinda/app` | plataforma de cursos | `suinda/app` | `main` |

Os caminhos acima pertencem ao mesmo repositório e branch. As cópias dos runtimes
ainda são distintas; portanto, uma mudança no core não se propaga entre elas por
mágica. Até a extração de módulos compartilhados, revise e integre a alteração em
cada caminho de aplicação pertinente. A consolidação removeu a separação Git por
ambiente, mas não fundiu automaticamente versões divergentes de código.

```text
                         HOST / Docker
                             |
                    orbit-control (Docker socket)
              /          |            \
      orbit_prod_net orbit_dev_net orbit_safdoulas_v2_net orbit_suinda_net
          |    |       |    |            |       |
    orbit-db-prod api  orbit-db-dev api  safdoulas-api     suinda-api
          |                 |              |                  |
    volume PROD        volume DEV     safdoulas-db       suinda-db
          |                 |              |                  |
      web-prod            web-dev       web:3002           web:3003
```

PROD é uma imagem construída de `workspace/app`; a API tem sistema de arquivos
somente leitura, exceto a montagem gravável e restrita do diretório Safdoulas em
`/host-projects/safdoulas`. O contêiner PROD não recebe acesso ao restante do host.
DEV monta o código `forge/app` para rodar o ambiente e usa a montagem já existente
`/:/host-filesystem` para alcançar o checkout de produção em
`/host-filesystem/home/meada/projetos/orbit/workspace/app`. O projeto Safdoulas não fica
mais cadastrado no banco DEV. A pasta `/home/meada/projetos/orbit/forge/app` é o
código executado por DEV; o checkout `/home/meada/projetos/orbit/workspace/app` é o
destino de código selecionado pelo quadro Orbit de DEV.

O quadro `SAFDOULA` no banco PROD usa o projeto `Safdoulas` em
`/host-projects/safdoulas`. Ele aponta ao diretório físico
`/home/meada/projetos/orbit/safdoulas/app`, dentro do mesmo repositório e
branch `main`. Esse diretório também é montado na instância de validação da porta
3002, que possui banco separado. Os quadros continuam limitados por caminho e
escopo do projeto, mesmo que a branch Git seja comum.

Suindá é mantido à parte em `suinda/app`, na branch comum `main`, com raiz Docker,
configuração, rede, volumes e PostgreSQL próprios em `suinda/`. A aplicação
reutiliza o shell e os recursos genéricos do Orbit; seu domínio acadêmico fica
em plugins filhos. A instância local usa Web `3003`, API `4004` e PostgreSQL
`5434`, todos publicados somente em loopback. Consulte [`suinda/README.md`](suinda/README.md)
para operação e [`suinda/app/docs/suinda/ARQUITETURA.md`](suinda/app/docs/suinda/ARQUITETURA.md)
para contratos e decisões do produto.
Abra a raiz `orbit/` como projeto principal no VS Code. Os diretórios `*/app`
continuam marcando os limites dos runtimes, não repositórios independentes.
Cada banco PostgreSQL 16 possui volume próprio, rede interna própria, credenciais
próprias e nenhuma porta publicada. As redes `orbit_prod_net` e `orbit_dev_net`
fornecem saída de rede apenas aos respectivos aplicativos. Não há Redis ou fila
externa: workers, schedulers e Socket.IO fazem parte do processo API de cada
ambiente. Não havia proxy reverso para substituir.

CONTROL é um contêiner independente. Apenas ele recebe `/var/run/docker.sock` e
executa os comandos administrativos. **O socket concede privilégios elevados sobre
o host**; mantenha acesso ao CONTROL restrito. O atalho do host apenas executa a
CLI dentro desse contêiner. Comandos de ambiente nomeiam serviços explicitamente;
nenhum usa `docker compose down` ou remove o CONTROL. Não monte o socket em DEV.

## Portas e URLs

| Ambiente | Web | API | Banco |
| --- | --- | --- | --- |
| PROD | <http://localhost:3000> | <http://localhost:4000> | `db-prod:5432`, interno |
| DEV | <http://localhost:3001> | <http://localhost:4001> | `db-dev:5432`, interno |
| Safdoulas validação | <http://localhost:3002> | <http://localhost:4003> | banco próprio, interno |
| Suindá | <http://localhost:3003/suinda> | <http://localhost:4004/health> | `suinda-db:5432`; host `127.0.0.1:5434` |
| CONTROL | sem porta pública | CLI local | acesso aos dois bancos |

As portas web e API são publicadas somente em `127.0.0.1`. As URLs OAuth existentes
que usam `localhost:4000` ou `localhost:4001` foram mantidas. Se for adicionado um
domínio ou proxy, confira `WEB_ORIGIN`, `API_PUBLIC_URL`, URLs de callback do Google,
Microsoft, GitHub, Dropbox e webhooks antes da troca. Uma integração externa que
dependa de acesso público não funcionará sem um proxy ou publicação planejada.

## Operação diária

Use `/home/meada/projetos/orbit/control/bin/orbit-env` (ou execute-o após `cd`). A ferramenta administra os ambientes Orbit/cliente cobertos pela configuração; Suindá tem Compose próprio em `suinda/compose.yml`:

```bash
./control/bin/orbit-env status
./control/bin/orbit-env health dev
./control/bin/orbit-env health prod
./control/bin/orbit-env logs dev
./control/bin/orbit-env logs prod
./control/bin/orbit-env start dev
./control/bin/orbit-env stop dev
./control/bin/orbit-env restart dev
./control/bin/orbit-env rebuild dev
./control/bin/orbit-env restart prod
./control/bin/orbit-env rebuild prod
./control/bin/orbit-env migrate dev
./control/bin/orbit-env snapshot prod
./control/bin/orbit-env restore dev <nome-do-snapshot-prod.dump>
./control/bin/orbit-env reset dev <nome-do-snapshot-prod.dump>
./control/bin/orbit-env destroy dev
```

Para consultar a configuração Suindá sem alterar serviços:

```bash
docker compose -f suinda/compose.yml config --quiet
docker compose -f suinda/compose.yml ps
```

Iniciar, parar, reconstruir ou reiniciar Suindá deve ser feito explicitamente
com esse Compose, apontando apenas aos serviços Suindá. Não use o Compose da
raiz para controlar a pilha Suindá.

`restore dev` confirma o checksum, para DEV, limpa **somente o schema DEV**,
restaura o snapshot, executa as migrations DEV e reinicia DEV. Se falhar, DEV fica
parado para inspeção. `destroy dev` remove só o contêiner DEV; o volume do banco
permanece. Para recriá-lo, use `start dev`. `reset dev <snapshot>` é a operação
destrutiva explícita: remove somente o volume `orbit_db_dev_data`, recria o banco,
restaura o snapshot, executa migrations DEV e inicia DEV. Os snapshots ficam em
`control/snapshots/` com permissões restritas e incluem dados sensíveis. A cópia
inicial do PostgreSQL nativo está em `orbit-migration-backups/` fora desta árvore.

Para iniciar manualmente toda a plataforma após uma instalação nova, use
`docker compose -f compose.yml up -d`. Para inspeção direta, `docker compose ps`
e `docker compose logs <serviço>`. O Docker foi habilitado no boot e todos os
serviços usam `restart: unless-stopped`. Dependências saudáveis controlam o
primeiro start; em reboot, uma API que iniciar antes do banco será reiniciada até
o banco estar disponível. **`docker compose down` derruba toda a plataforma** e
não faz parte da operação normal; nunca use `down -v` para manutenção.

## Dados, migrations e segredos

Migrations são de schema e rodam na API do próprio ambiente. PROD, DEV e Safdoulas
usam bancos e volumes separados; não há replicação. Um snapshot é uma cópia
pontual dos dados e do schema para recuperação, seguida das migrations do código
DEV após uma restauração em DEV. DEV pode divergir de PROD sem enviar dados de
volta. Não use seeds para copiar dados de negócio.

Classificação inicial das entidades reais do Orbit:

| Classe | Entidades ou arquivos | Regra inicial |
| --- | --- | --- |
| SYSTEM | `schema_migrations`, `users`, `workspaces` | Identidade e estrutura; revisar antes de sincronização seletiva. |
| BUSINESS | `boards`, `lists`, `cards`, `comments`, `attachments`, `comment_attachments`, `notebooks`, `vault_items`, `vault_categories`, `labels`, `checklists`, `planner_rules`, `focus_events` | Dados do usuário; comparar em snapshots. |
| ENVIRONMENT | Caminhos de `ai_projects`, `backup_cloud_settings`, endpoints e destinos de `delivery_*`, URLs públicas | Adaptar ao ambiente; nunca copiar cegamente em sincronização seletiva. |
| RUNTIME | `card_ai_runs`, `card_runs`, `card_run_logs`, `delivery_runs`, `oauth_states`, sessões `.orbit` | Não replicar automaticamente entre ambientes. |
| SECRET | `integration_connections`, `delivery_credentials`, `.env`, `db.env`, chaves de backup e OAuth | Proteger, criptografar e tratar por ambiente. |

Algumas tabelas misturam classes, como `ai_projects`, `plugin_settings` e
`integration_connections`; uma sincronização futura precisará separar campos.
As configurações ativas estão em `workspace/data/config/` e `forge/data/config/`. Os
atalhos `prod/.env` e `dev/.env` apontam para os respectivos arquivos de API.
Credenciais dos bancos ficam em `prod/db.env` e `dev/db.env`; CONTROL usa
`control/.env`. Todos são ignorados pelo Git e têm modo restrito. Os arquivos
originais `apps/api/.env` permanecem nos diretórios de origem preservados. Nas
cópias de código, esses arquivos agora contêm as configurações ativas de cada
ambiente, sem credenciais do banco nativo. Em DEV, o backup
criptografado de configuração lê os arquivos ativos de `forge/data/config/`.
O Drive continua conectado à conta inicial, mas os novos backups DEV usam pastas
com prefixo `Orbit DEV` (banco, cofre, configurações e anexos) para não misturar
arquivos com PROD. As contas OAuth copiadas no snapshot devem ser revisadas antes
de liberar integrações externas no DEV.

## Database Isolation

O PostgreSQL nativo 16.15 em `127.0.0.1:5432/orbit` é a fonte original e
permanece intacto como fallback. Seu backup canônico está em
`control/backups/database/original/2026-10-07_00-14-15/`, com `backup.dump`,
`metadata.txt`, `checksums.txt` e `validation.txt`. O dump foi restaurado em
banco temporário isolado e todas as 88 tabelas conferiram com a origem. O dump
usado na migração anterior foi comparado com esse backup: as 88 tabelas também
conferiram. PROD e DEV nasceram, portanto, do mesmo estado original. Não se
reaplicou o backup nos bancos já ativos, para preservar tokens renovados e
registros de backup criados depois da migração.

`orbit-db-prod` e `orbit-db-dev` têm volumes físicos, redes internas e senhas
administrativas diferentes. As APIs usam `orbit_prod_app` e `orbit_dev_app`,
respectivamente, sem superusuário. Cada papel de aplicação é dono apenas das
tabelas e sequências do próprio banco, para executar as migrations existentes.
As credenciais administrativas ficam no CONTROL e nos contêineres dos bancos;
não são montadas em DEV. O CONTROL acessa ambos os bancos somente para backup,
restore e administração explícita. DEV não resolve nem conecta ao banco PROD,
e suas credenciais são rejeitadas por ele.

```bash
./control/scripts/db-verify original ./control/backups/database/original/2026-10-07_00-14-15
./control/scripts/db-backup-prod prod
./control/scripts/db-verify prod <snapshot-prod.dump>
./control/scripts/db-restore-dev dev <snapshot-prod.dump>
./control/bin/orbit-env reset-data dev <snapshot-prod.dump>
./control/bin/orbit-env sync-data dev --from prod
```

`reset-data` exige `dev` e um snapshot PROD com checksum; recria somente o
volume DEV, restaura os dados, restabelece `orbit_dev_app`, aplica migrations e
inicia DEV. `sync-data` cria um snapshot de PROD e o restaura em DEV apenas por
solicitação explícita. Não há reset PROD ou fluxo DEV → PROD. Esses snapshots
integrais contêm hashes de senha, dados do cofre e credenciais OAuth
criptografadas; proteja os arquivos e revise integrações antes de usá-los em
outro ambiente. A futura sincronização seletiva deve separar schema, dados de
negócio, estado de execução e segredos.

O DEV não inicia automaticamente manutenção Google/Outlook, sincronização
Trello nem retomada de deploys copiados. Backups DEV ao Drive continuam ativos
em pastas próprias. Ações externas disparadas manualmente ainda são possíveis;
use contas e destinos de teste ao validar integrações. Para habilitar a
automação externa em DEV de forma deliberada, ajuste
`ORBIT_ALLOW_EXTERNAL_AUTOMATION` no Compose e recrie somente DEV.

## Recuperação do estado anterior

O banco PostgreSQL nativo e os diretórios originais não foram apagados. Para
reverter, registre antes qualquer escrita nova em PROD; um retorno simples ao
banco nativo pode deixar essas escritas de fora. Pare PROD e DEV pela CLI,
registre um snapshot PROD e pare CONTROL e os dois bancos via Compose **sem
remover volumes**. Renomeie a nova árvore `/home/meada/projetos/orbit` para um
nome de retenção livre; renomeie `/home/meada/projetos/orbit-prod` de volta para
`/home/meada/projetos/orbit`. O `.env` original aponta para o banco nativo ainda
presente. Verifique as portas e reinicie o gerenciador nativo com
`npm run orbit:serve` no projeto original. Não havia serviço systemd, PM2 ou proxy
Orbit ativo no inventário. Se dados novos precisarem ser levados de volta,
restaure um dump validado em um banco de recuperação separado e compare antes
de alterar o banco nativo; não o sobrescreva automaticamente.
