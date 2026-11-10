# Auditoria de isolamento dos bancos Orbit

Data da auditoria: 6 de outubro de 2026, America/Recife. Não houve commit, push,
upgrade de PostgreSQL nem exclusão do banco original.

## Estado encontrado

O banco original é PostgreSQL 16.15 nativo em `127.0.0.1:5432/orbit`, dono
`shared`, 24 MB, UTF8, locale `pt_BR.UTF-8`, schema `public`, extensões
`pgcrypto 1.3` e `plpgsql 1.0`. Está ativo e preservado como **LEGACY / MIGRATION
FALLBACK**. Contém 88 tabelas, 191 índices, 331 constraints, 3 sequências e 57
migrations; a última é `050_attachment_folder_refresh.sql`.

PROD e DEV já usavam PostgreSQL 16.15 em contêineres separados. As URLs ativas
tinham hosts diferentes, mas as aplicações ainda usavam o superusuário `orbit`
dos seus respectivos bancos. Isso foi corrigido nesta auditoria.

| Ambiente | Serviço/host | Banco | Papel da API | Volume físico | Rede do banco |
| --- | --- | --- | --- | --- | --- |
| PROD | `orbit-db-prod` / `db-prod:5432` | `orbit` | `orbit_prod_app` | `orbit_db_prod_data` em `/var/lib/docker/volumes/orbit_db_prod_data/_data` | `orbit_prod_db_net` |
| DEV | `orbit-db-dev` / `db-dev:5432` | `orbit` | `orbit_dev_app` | `orbit_db_dev_data` em `/var/lib/docker/volumes/orbit_db_dev_data/_data` | `orbit_dev_db_net` |

Os dois papéis de aplicação têm senhas distintas, não são superusuários e são
donos apenas das 88 tabelas e 3 sequências do próprio banco, necessárias para
as migrations atuais. O papel administrativo `orbit` permanece somente no
CONTROL e nos bancos. As APIs receberam suas URLs novas por `env_file`; consulta
feita **dentro de cada processo** confirmou host, banco, papel e `rolsuper=false`.
As cópias `apps/api/.env` também foram alinhadas às configurações ativas, sem
alterar os projetos originais.

## Backup canônico e origem comum

Antes de alterar papéis, foi criado o backup custom-format do banco original em
`control/backups/database/original/2026-10-07_00-14-15/backup.dump` (465783
bytes; SHA-256 `08bb0bfd2dca00943bedadebf4ccc159b852c84857dbe7fef4278f33fe12d582`).
`metadata.txt`, `checksums.txt` e `validation.txt` ficam na mesma pasta. O dump
passou por `pg_restore -l` e restauração em PostgreSQL 16.15 temporário, sem
rede e com dados em tmpfs. Todas as 88 tabelas tiveram fingerprint lógico
idêntico ao original; contagens, índices, constraints, sequências, extensões e
169 chaves estrangeiras validadas conferiram. O banco temporário foi removido.

O dump inicial usado pela migração anterior foi restaurado em outro banco
temporário e comparado com o novo backup canônico: **88 de 88 tabelas idênticas**.
Logo, o novo backup representa o mesmo estado original que inicializou PROD e
DEV. Ambos os bancos ativos já foram restaurados desse estado na migração
anterior. **Não foram apagados e restaurados de novo nesta auditoria:** isso
descartaria renovações de tokens e históricos de backup surgidos depois do T0.
Antes da troca de papéis, dumps atuais de PROD e DEV foram salvos em
`control/backups/database/pre-role/2026-10-07_00-16-40/` com checksum próprio.

| Dados verificados agora | Original | PROD | DEV |
| --- | ---: | ---: | ---: |
| Usuários | 1 | 1 | 1 |
| Quadros | 9 | 9 | 9 |
| Cartões | 102 | 102 | 102 |
| Cadernos | 4 | 4 | 4 |
| Itens do cofre | 1 | 1 | 1 |
| Migrations | 57 | 57 | 57 |
| Fingerprints de tabelas iguais ao original | 88/88 | 87/88 | 83/88 |

As diferenças atuais são posteriores à inicialização. PROD difere apenas em
`trello_connections.last_synced_at` e `last_error`. DEV difere em registros de
backups na nuvem, nesses dois campos Trello e nos campos de credencial cifrada
e atualização de `integration_connections`. Os dados de negócio principais e
o estado de migrations conferem. Tabelas de backup, sincronização, sessões,
jobs e logs são estado operacional; não há replicação automática.

## Provas de isolamento

- `npm run db:migrate` executado em DEV com `orbit_dev_app`: passou. Uma tabela
  temporária criada e removida pelo mesmo papel apareceu somente em DEV; em
  PROD ela permaneceu ausente. O SHA-256 normalizado do schema PROD ficou
  `05df58dca00a1909252f31874a960fb82455b4c791011f47eb62ca26d3434b11`
  antes e durante o teste.
- Credencial DEV conectou a `db-dev` e foi rejeitada por `db-prod`. A partir do
  runtime DEV, DNS de `db-prod` falhou e conexão TCP ao IP do banco PROD foi
  bloqueada. Bancos não publicam portas no host; volumes e mounts são distintos.
- O CONTROL agora valida que URL administrativa PROD aponta a `db-prod:5432/orbit`
  e DEV a `db-dev:5432/orbit`, ambas com o papel esperado. `reset-data prod`,
  `restore prod`, `sync-data prod --from dev` e reset sem ambiente são recusados.
  Uma URL DEV propositalmente apontada a `db-prod` foi rejeitada em teste
  sem executar alteração.
- O restabelecimento do papel `orbit_dev_app` após restore foi executado contra
  um banco temporário novo: conexão, `rolsuper=false`, propriedade das 88
  tabelas e leitura de 102 cartões passaram. O volume DEV real não foi resetado
  novamente nesta auditoria; seu reset completo já havia passado na migração
  anterior, antes da troca de papel.

## Operação e segredos

O CONTROL usa credenciais administrativas próprias para dump e restore. A CLI
exige ambiente explícito. `reset-data dev <snapshot>` valida checksum e formato,
recria apenas o volume DEV, restaura o snapshot, recria/ajusta o papel de
aplicação DEV, aplica migrations DEV e inicia DEV. `sync-data dev --from prod`
executa snapshot PROD e restore DEV sob pedido; não existe fluxo DEV → PROD.
Scripts em `control/scripts/` oferecem backup PROD, verificação e restore DEV.
Não foi criado agendamento novo.
Após a correção da CLI, um novo snapshot PROD
`control/snapshots/prod-20261007T002812Z-9985e028.dump` foi criado e validado
por checksum e `pg_restore -l`.

Os snapshots integrais incluem `users.password_hash`, dados cifrados do cofre,
credenciais OAuth em `integration_connections`, credenciais de delivery e
metadados de webhooks. DEV conserva cópias de credenciais de integração; a
automação de Trello, manutenção Google/Outlook e retomada de deploys foi
desligada por padrão apenas em DEV. Backups DEV ao Drive seguem ativos em pastas
`Orbit DEV`. Ações externas manuais em DEV ainda podem usar contas reais e
devem ser testadas com destinos apropriados. Uma futura sincronização seletiva
deve separar schema, dados de negócio, runtime e segredos.

## Matriz final

| Verificação | Resultado |
| --- | --- |
| PROD usa banco exclusivo | PASS |
| DEV usa banco exclusivo | PASS |
| Volumes diferentes | PASS |
| Credenciais diferentes | PASS |
| Redes isoladas | PASS |
| Migration DEV altera apenas DEV | PASS |
| Migration DEV não altera PROD | PASS |
| DEV acessa DB DEV | PASS |
| DEV não acessa DB PROD | PASS |
| Dados PROD restaurados corretamente | PASS |
| Dados DEV restaurados corretamente | PASS |
| Paridade inicial de negócio validada | PASS |
| Banco original preservado | PASS |
| Backup original validado por restauração | PASS |
| Snapshot PROD → DEV disponível | PASS |
| DEV → PROD automático inexistente | PASS |

Limite da prova: o fingerprint integral de ambos os bancos não foi capturado
exatamente no T0 da migração anterior. A evidência reúne o dump inicial, o
backup canônico idêntico em 88/88 tabelas, as contagens da restauração inicial
e os fingerprints atuais dos dados de negócio. O novo backup canônico não foi
reaplicado aos bancos ativos para preservar as alterações operacionais citadas.
