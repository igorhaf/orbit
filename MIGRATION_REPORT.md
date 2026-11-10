# Relatório da migração Orbit

Data: 2026-10-06. Inventário anterior a alterações estruturais:
`/home/meada/projetos/orbit-migration-inventory.txt` (modo 600).

## Estado inicial e preservação

| Item | Estado inicial | Estado após migração |
| --- | --- | --- |
| PROD | `/home/meada/projetos/orbit`, branch `main`, commit `ca5c46821e7c7c8841a45914066f43b26e7edbc5`, `apps/web/next-env.d.ts` modificado | Original renomeado atomicamente para `/home/meada/projetos/orbit-prod`; cópia em `prod/app` |
| DEV | `/home/meada/projetos/orbit-dev`, branch `develop`, commit `dc18aa47abe861e35b5337f7799e06b0f4a4a21f`, 47 alterações locais | Original preservado; cópia em `dev/app` |
| Runtime | Nenhum processo Orbit ou proxy escutava; PostgreSQL nativo 16.15 em `127.0.0.1:5432` | Seis contêineres Orbit; PostgreSQL nativo mantido |
| Docker | Ausente | Engine 29.1.3, Compose 2.40.3 instalados e habilitados no boot |

Não foi necessário parar processo Orbit antigo. Nenhum banco ou volume anterior foi
apagado. Não houve merge, rebase, commit, stage, push ou alteração de remotes.
As cópias iniciais foram feitas com `rsync -aHAX`; uma comparação posterior com
`rsync -aHAXcni` não listou diferenças. O hash SHA-256 da árvore PROD original,
excluindo caches descartáveis, permaneceu
`b6f0e240fa3b78361efea44f57e98333d370680620203328c0224876d91f8794`.
As cópias receberam depois apenas adaptações de contêiner e configuração; os
originais permanecem como referência.
Branch, HEAD e remote `origin` das cópias continuam iguais aos originais:
PROD `main`/`ca5c46821e7c7c8841a45914066f43b26e7edbc5` e DEV
`develop`/`dc18aa47abe861e35b5337f7799e06b0f4a4a21f`. O status original
tem 1 linha modificada em PROD e 47 em DEV; as cópias têm, respectivamente,
4 e 49 linhas após as adaptações locais de infraestrutura e isolamento de
pastas do Google Drive.

## Banco, backups e dados

O banco nativo `orbit` usa UTF8, collation `pt_BR.UTF-8` e extensão `pgcrypto`
1.3. O dump completo, validado com `pg_restore -l`, está em
`/home/meada/projetos/orbit-migration-backups/orbit-native-20261006T223434Z.dump`
(708071 bytes; SHA-256
`e74adbfc343dfee968a1bf7aef7e874503e357158f14c7f0831d8485f810bc49`).
Foi restaurado, sem erros, nos dois bancos PostgreSQL 16.15 independentes.
Os dois usam UTF8 e `pt_BR.UTF-8`, com extensão, índices, constraints,
sequências e histórico de migrations presentes.

| Métrica inicial | PROD | DEV |
| --- | ---: | ---: |
| Usuários | 1 | 1 |
| Quadros | 9 | 9 |
| Cartões | 102 | 102 |
| Cadernos | 4 | 4 |
| Itens do cofre | 1 | 1 |
| Migrations | 57 | 57 |
| Tabelas | 88 | 88 |
| Índices | 191 | 191 |
| Constraints | 331 | 331 |
| Sequências | 3 | 3 |

Um snapshot posterior de PROD foi criado pelo CONTROL em
`control/snapshots/prod-20261006T225217Z-9087bc58.dump`, com checksum em arquivo
adjacente. A restauração desse snapshot para DEV foi testada; uma cópia de DEV
anterior ao teste fica em `control/backups/dev-pre-restore-20261006.dump`.
Esses arquivos contêm dados sensíveis e estão protegidos por permissões locais.
Após o start, os ambientes podem divergir; não há replicação automática.

## Topologia em operação

Serviços: `orbit-control`, `orbit-prod-api`, `orbit-prod-web`, `orbit-db-prod`,
`orbit-dev`, `orbit-db-dev`. Redes: `orbit_control_net`, `orbit_prod_net`,
`orbit_dev_net`, `orbit_prod_db_net` e `orbit_dev_db_net`; as duas redes dos
bancos são internas. Volumes persistentes: `orbit_db_prod_data` e
`orbit_db_dev_data`. Configurações, backups locais e sessões usam diretórios
separados em `prod/data/` e `dev/data/`. PROD executa código da imagem, sem bind
mount do source; DEV monta apenas sua própria cópia do código. Apenas CONTROL
monta o socket Docker. Nenhum serviço usa `privileged: true`.

O DEV preserva a conta Google copiada no snapshot, mas seus envios automáticos
novos ao Drive usam pastas próprias com prefixo `Orbit DEV` para banco, cofre,
configurações e anexos. Isso mantém os arquivos gerados por DEV separados dos
arquivos de PROD, mesmo quando a conta é a mesma.

Portas locais: PROD web `127.0.0.1:3000`, API `127.0.0.1:4000`; DEV web
`127.0.0.1:3001`, API `127.0.0.1:4001`. Bancos não publicam portas. URLs web:
<http://localhost:3000> e <http://localhost:3001>. Não havia proxy reverso a
reconfigurar. Os callbacks existentes que usam essas portas foram preservados.

## Verificações executadas

- Builds das imagens dos bancos, PROD, DEV e CONTROL passaram. `npm run build`
  na cópia DEV passou; os 80 testes unitários DEV e os 45 testes unitários
  PROD passaram.
- PROD e DEV responderam HTTP 200 na rota web. API e web de ambos têm
  healthchecks; os bancos respondem ao `pg_isready`; CONTROL responde ao Docker.
- `restart dev`, `rebuild dev`, parada de `db-dev`, `destroy dev` e recriação de
  DEV foram executados. PROD continuou a responder HTTP 200 e CONTROL ficou
  saudável durante esses testes.
- `reset dev <snapshot>` removeu o contêiner e o volume `orbit_db_dev_data`,
  recriou o banco vazio, restaurou o snapshot PROD, executou migrations DEV e
  reiniciou DEV. As contagens voltaram a 1 usuário, 9 quadros, 102 cartões e
  57 migrations, enquanto PROD continuou HTTP 200 e CONTROL saudável.
- `migrate dev` passou. O dump de schema PROD, normalizado para retirar os
  marcadores aleatórios do `pg_dump`, manteve SHA-256
  `60086e18e57d5e20f187e6615c9f36b37a0957d3cb802bd9a00ef68254e5815f`.
- O DEV não resolveu `db-prod` nem abriu conexão TCP com o IP de `db-prod`.
  Inspeção de mounts confirmou ausência de socket Docker e de árvores PROD ou
  CONTROL em DEV. A senha do banco DEV foi rejeitada por PROD. O código PROD
  não possui bind mount e sua raiz é read-only.
- `snapshot prod` e `restore dev <snapshot>` passaram. Após restauração,
  usuários, quadros, cartões e migrations voltaram às contagens esperadas.
- O backup criptografado de configurações em DEV incluiu os dois `.env`
  virtuais e confirmou que o `DATABASE_URL` arquivado é o do banco DEV ativo.
- Após separar as pastas do Google Drive de DEV, a cópia DEV passou novamente no
  `npm run build` completo e nos 80 testes da API. O contêiner recebeu
  `ORBIT_ENV=development`, e o teste de anexos confirmou o caminho com prefixo
  `Orbit DEV Card Attachments`.

## Correções e limites

Foi necessário instalar Docker. Um `/tmp` inicial com `noexec` impediu um teste
do Codex; a montagem DEV passou a permitir execução temporária. CONTROL precisou
de acesso de leitura à árvore do Compose e foi mantido como runtime confiável
com socket Docker. A primeira tentativa de `restore dev` restaurou o banco, mas
um shell de login retirou `pg_dump` do PATH; a CLI foi corrigida, o processo
foi repetido e passou. Um teste inicial de rede produziu falso positivo por
quoting do shell; a execução corrigida confirmou bloqueio.

A integração Trello padrão registra falta de credenciais ao iniciar DEV, mas a
API inicia e o healthcheck passa. Os diretórios originais conservam seus URLs
para o banco nativo e são apenas fallback; iniciá-los junto com os contêineres
nas mesmas portas causaria conflito. O banco nativo não recebe escritas novas
dos contêineres. Antes de qualquer rollback após uso real, compare dados novos
em PROD com o fallback. Não houve teste destrutivo de rollback nem reboot do host.
Para callbacks externos ou acesso fora do host, será necessário configurar um
proxy/domínio e revisar as URLs autorizadas dos provedores OAuth.
As rotas web responderam HTTP 200 em PROD e DEV; a chamada `/api/boards` via
ambos os frontends retornou HTTP 401 sem sessão, confirmando o proxy da API.
Comandos `stop control`, `destroy prod` e `restore prod` foram rejeitados pela
CLI sem alterar os serviços.

## Rollback

Após a migração, o projeto de IA `Orbit (nativo)` em DEV ainda apontava para
`/home/meada/projetos/orbit-dev`, caminho existente só no host. Seu registro
DEV foi corrigido para `/home/meada/projetos/orbit`, que é o mount de
`/home/meada/projetos/orbit/dev/app` dentro do contêiner. O código DEV agora
reconcilia esse registro após futuros restores. O original no host foi mantido.
O registro nativo de PROD foi corrigido para o mesmo caminho interno, que em
PROD é código da imagem e permanece somente leitura. A cópia de PROD foi
atualizada para apresentar uma mensagem explícita quando houver tentativa de
autodesenvolvimento nela. A imagem foi reconstruída e somente a API PROD foi
recriada após autorização; o healthcheck e a web PROD passaram.

Veja o procedimento em `README-ARCHITECTURE.md`. Em resumo: primeiro crie
snapshot e avalie escritas novas; pare DEV, PROD, CONTROL e os dois bancos sem
remover volumes; retenha a nova árvore com outro nome; devolva `orbit-prod` ao
caminho `/home/meada/projetos/orbit`; use o PostgreSQL nativo preservado e o
gerenciador nativo original. Não sobrescreva automaticamente o banco nativo
com um snapshot posterior sem comparar schema e dados.
