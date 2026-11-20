# 07D-R7 — Consolidação técnica e preparação do cutover DEV

## Resumo e estado do DEV

**DEV INTEGRADO COM PENDÊNCIAS TÉCNICAS.** A API DEV tem uma composição real para os três modos do toggle de plugins. O writer participante foi montado em dois processos do `main.ts` real contra PostgreSQL 16 restrito. O ensaio demonstrou escrita, polling e reconstrução depois de reiniciar uma instância. O cutover continua condicionado ao esquema efetivo, aos privilégios dos fluxos em uso, aos writers externos e à aprovação do operador.

A base era `main` em `d9307b8`, Core 1.12.5, 231 mappings e 485 entradas de trabalho anteriores no início da R7. Partimos de um writer testável, com composição ainda experimental no host. Ao final, o bootstrap da API faz a composição, o PostgreSQL fornece evidência de integridade da 212, o build protege as cópias do Core e a matriz contempla novos fluxos reais. PROD, Safdoulas, Suindá, locks e mappings ficaram sem alterações da R7. O repositório permaneceu sem commit ou push. O banco DEV real foi usado somente para identificar e reproduzir o esquema. Os testes gravaram exclusivamente em bancos descartáveis.

## Código e composição do host

- `forge/app/apps/api/src/main.ts` usa `composePluginSettingsHost` no provider de `PluginSettingsService`. A rota continua `PATCH /plugins/:id`. O AccessGuard autentica o ator e a operação revalida a sessão e `plugins.manage` antes do writer. Revisão, pool e credenciais vêm do servidor.
- `plugins/plugin-settings-host.ts` interpreta `ORBIT_PLUGIN_SETTINGS_MODE` e lê somente os arquivos indicados pelo host. No modo participante exige dois JSON distintos em caminhos absolutos. Os arquivos devem ser regulares, de propriedade do UID da API, com modo `0600`, até 4 KiB e sem seguir symlinks.
- `plugins/plugin-settings-boundary.ts` confirma PostgreSQL 16, logins efetivos distintos, mesmo banco com desafio de advisory lock, owners, ACLs, `search_path`, ausência das memberships e capacidades administrativas verificadas. Confere a migration pelo ledger, por view fixa, e o corpo do guard pelo SHA-256, além da instalação e ativação dos triggers. Liga o resultado ao banco, aos três papéis esperados e ao identificador do domínio.
- `plugins/plugin-settings.ts` mantém os fluxos R3C-B/C/D, drena operações no encerramento e fecha o pool privado de forma idempotente. `db.ts` limita a aquisição do pool geral quando a composição participante é solicitada. O writer tem limites próprios de conexão, consulta, lock e tempo ocioso em transação.
- O pool privado é criado e mantido no serviço, sem exportação no container de DI ou parâmetros HTTP. O papel administrativo é fornecido somente ao processo de manutenção. A implantação deve restringir arquivos e processos do host, pois código arbitrário executado com o mesmo UID não é isolado por um objeto JavaScript.

| Modo | Comportamento observado |
|---|---|
| `legacy` | Disponível antes de 212, com a autorização normal e o pool geral. Por padrão, aplica-se quando não há configuração privada. Em banco já migrado a rota recusa escrita. |
| `paused` | A rota devolve 503 ao ator autorizado. Também é o estado quando existem referências de configuração sem modo participante explícito. |
| `participant` | Requer os dois arquivos e as verificações SQL. Divergência ou indisponibilidade recusa o startup, com mensagem sanitizada. Não há fallback para o pool geral. |

**Campos do arquivo de aprovação técnica:** `version: 1`, `database`, `generalRole`, `writerRole`, `ownerRole` e `generationDomain`. A leitura do arquivo não substitui a autorização humana. Ele registra os valores conferidos após o corte.

**Campos do arquivo de credencial:** `host`, `port`, `database`, `user` e `password` quando exigida. Aceita socket Unix privado ou loopback. O banco e o login precisam coincidir com o arquivo de aprovação. As variáveis `ORBIT_PLUGIN_SETTINGS_APPROVAL_FILE` e `ORBIT_PLUGIN_SETTINGS_WRITER_CREDENTIAL_FILE` levam somente caminhos. O ensaio usou identidades sintéticas. Nenhuma credencial real nova foi criada ou usada.

## Fonte canônica e compilação

`@orbit/core-source` é a distribuição de código fonte por mappings. O TypeScript do DEV emite a API com `rootDir: src`, sem exportação compilada dos módulos editoriais. Mantive por isso as quatro cópias locais de geração, writer, orquestração e recuperação. `apps/api/check-core-projections.mjs` compara os bytes com a fonte canônica antes de `npm run build` e `npm run compile`. Ausência ou divergência faz o comando falhar. O teste inseriu divergência em árvore descartável e confirmou que o check não reescreve arquivos. O mesmo comando protege a projeção DEV de `access/management.ts` após a correção de ordem dos locks.

## Fronteira PostgreSQL e matriz exercitada

O procedimento canônico para a estrutura observada no DEV usa os scripts `r6-*` sob `tools/orbit/dev-db-cutover/`. As entradas anteriores seguem como regressão do cenário R5C-A, em que o owner já era administrativo. A transferência usa `REASSIGN OWNED` com inventário aprovado, SHA-256 de identidades e validação de ownership compartilhado. Preserva OID e versão de `pgcrypto`. O checksum do inventário não cobre alterações de definição ou ACL. Essas têm verificações e revisão próprias.

Foi adicionado um ponto de parada porque faltavam colunas usadas pelo DEV atual no esquema exportado. `157_card_revisions.sql` e `158_workspace_coordination.sql` foram reproduzidas pelo migrador versionado no clone. A preparação em clone também instala a 212 canônica e registra o checksum pelo caminho versionado. A view administrativa `orbit_plugin_settings_migration_212` expõe só o checksum da 212 ao writer, sem leitura do ledger inteiro. O cutover e a restauração recriam ou validam esse acesso.

| Fluxo exercitado | Fronteira SQL e evidência |
|---|---|
| Bootstrap, login e sessão | `main.ts` real sob role geral, em namespace de rede sem saída. SELECT do RBAC, login limiter, histórico de login, catálogo de plugins e leituras pontuais dos scans de startup. Sessão inválida ou revogada é recusada. |
| Cadastro e manutenção | Porções de INSERT e UPDATE de `users`, alterações de grupos e associação de usuários. Operações com contas sintéticas. |
| Papéis e exceções | SELECT para RBAC, INSERT/UPDATE de definição e DML nominal nas tabelas de grants, membros e exceções. Testes da API de acesso e rollback real em PostgreSQL. |
| Convite, recuperação e MFA | Limite de tentativas, criação e consumo de tokens e desafios com grants por coluna. Mensagens capturadas em outbox sintética. Nenhum SMTP ou login social externo. |
| Auditoria | INSERT das colunas de auditoria, leitura das colunas usadas pelo trigger e INSERT no histórico encadeado. USAGE nas duas sequências. |
| Workspaces | Criação, membros e subrecursos exercitados com grants nomeados nas relações correspondentes. |
| Quadros, listas e cartões | O ensaio usa a view de membros autorizados, as ACLs nomeadas de CRUD e permissões auxiliares de revisões, atividades, visitas, notificações e triggers. Operações exercitadas por SQL/serviço e pela API real. |
| Triggers de cartão | Grants específicos para fila de automação e sua sequência, atualização de organização de backups e escrita de histórico de revisão. |
| Registros e protocolos | USAGE em `extension_protocol_seq` e regressões dirigidas de Registros. O ciclo completo de todos os plugins de Registros sob role restrita não foi homologado. |
| Jobs | Claim e manutenção da fila base com grants identificados nas tabelas de runs, logs e sequência. O loop real marcou um job sintético obsoleto como falho e registrou `finished_card_revision=1`. Nenhum serviço externo ou executor pago. Filas e integrações adicionais requerem evidência por fluxo. |
| Configuração e instalações | Geral lê as duas relações. Writer atualiza só as colunas de configuração e `revision`. O runtime antigo recebe `42501` no SQL legado. Instalação administrativa não é operação do writer. |
| Migrations e seed | Execução administrativa isolada, com ledger e checksums, seed idempotente e preparação transacional. |
| Backup e restore | Dump/restore reais de dados sintéticos. Reaplicação das ACLs no destino isolado e nova recusa de escrita legada. A CLI criptografada e integrações externas de backup continuam fora da cobertura. |

Os ensaios identificaram `42501` em `account_auth_limits`, no histórico de login, em `board_architecture_contracts`, `board_visits.visited_at`, `card_ai_runs.created_at` e nas dependências de triggers. Guards de cartões de Registros também precisaram da leitura do vínculo e de `extension_records(id,plugin_id,kind)` em rotas de quadros. Os grants foram corrigidos por operação, sem devolver ownership, DML protegido, CREATE/TEMP ou permissões administrativas. Divergências de extensões ou objetos compartilhados interrompem o procedimento. A matriz se aplica aos fluxos exercitados no ambiente sintético, com os plugins de teste explicitamente isolados.

## Testes de falha e recuperação

- A API real operou em dois processos. Uma instância alterou um plugin e a outra convergiu por polling. Reiniciar uma instância manteve o estado observado no PostgreSQL. O modo pausado e o bloqueio no caminho anterior ao corte também foram exercitados.
- O harness HTTP reduzido permite falhas controladas sem instrumentar a API operacional. Cobriu sessão inválida, autorização ausente, revogação, dependência desativada, última vista obrigatória, CAS, registry desatualizado e notificação perdida. Falhas após COMMIT e confirmação perdida preservaram o resultado do banco, sem repetir a escrita.
- O startup recusou arquivo incompleto ou com modo aberto, domínio divergente, checksum incorreto, evidência falsa por view, credencial privada indisponível e ACL de escrita legada. O encerramento do pool foi repetido e a composição voltou a iniciar após corrigir a causa.
- A preparação rejeita ownership divergente, ACL de baseline alterada e objeto compartilhado fora do escopo. Uma falha em trigger de evento sintético, depois de REASSIGN e da instalação de 212, reverteu ownership e migration no clone. Os testes de rollback SQL e restore preservaram configuração, revisão e recusa de DML no caminho legado. Uma revogação ocorrida depois da última checagem do toggle continua permitindo a operação em curso. A solicitação seguinte é recusada.

## Resultados e comandos

**158 resultados aprovados, zero falhas ou skips nas suítes dirigidas.** Os totais incluem testes pai do runner Node. A suíte R5C-A foi executada em dois comandos e contada uma vez.

| Grupo | Resultado | Comando na raiz |
|---|---:|---|
| R02, R08, snapshot e Registros | 89 | `./forge/app/node_modules/.bin/tsx --tsconfig forge/app/apps/api/tsconfig.json --test packages/orbit-core/src/execution/{discovery-review-repository,editorial-authorization-snapshot}.spec.ts forge/app/apps/api/src/plugins/records/records.spec.ts` |
| Geração, R3C, R5-PRE e R5A | 43 | `./forge/app/node_modules/.bin/tsx --tsconfig forge/app/apps/api/tsconfig.json --test packages/orbit-core/src/execution/editorial-authorization-generation.postgres.spec.ts` |
| Clone estrutural, bootstrap real e R5C-A | 16 | `ORBIT_R6_REHEARSE_DEV_SCHEMA=1 ORBIT_R6_BOOTSTRAP_API=1 ./forge/app/node_modules/.bin/tsx --tsconfig forge/app/apps/api/tsconfig.json --test tools/orbit/dev-db-cutover/{r6-clone,transition}.postgres.spec.ts` |
| HTTP, falhas e lifecycle em processos independentes | 10 | `./forge/app/node_modules/.bin/tsx --tsconfig forge/app/experimental/tsconfig.plugin-settings.json --test forge/app/experimental/plugin-settings-http.postgres.spec.ts` |

A compilação dirigida da API emitiu `main.js` num diretório temporário com `npm run compile -w apps/api -- --outDir <temporário>`, a partir de `forge/app`. TypeScript do harness e ESLint dos arquivos fonte DEV alterados passaram. O lint integral teve **147 erros preexistentes restantes**, ante 151 na R6. A tipagem do adaptador SQL editorial em `AccessService` eliminou quatro. O comando `npm run build` completo mantém o lint integral como gate. Não houve supressão de diagnósticos. `git diff --check` e a conferência dos demais runtimes passaram.

O ensaio corrigiu dois defeitos além das permissões. A definição da view normalizada pelo PostgreSQL 16 deixa nomes de coluna sem qualificação. O verificador passou a comparar a definição que o servidor realmente emite. O primeiro ensaio legado também tentou conferir settings com um owner que só receberia ownership depois do corte. A prova em clone foi ajustada para ler com o operador descartável e drenar os processos antes da preparação.

## R02, R06 e R08

**R02 aberto.** A aplicação, o host e o repositório do Core agora propagam uma asserção síncrona dos providers locais imediatamente antes do despacho de COMMIT. Um teste PostgreSQL registra provider real depois da escrita, antes do despacho, e prova rollback da decisão e da auditoria. A janela após o despacho e a sincronização entre processos permanecem sem garantia. O snapshot não se torna suficiente para autorizar. Discovery Review continua indisponível.

**R06 aberto.** Identidades, ACLs, evidência da migration, composição de pools, transição e contingência foram comprovadas em clone. No DEV efetivo, ownership, migrations e credenciais aguardam autorização e comprovação. Escritas externas e acesso de processos do host ao mecanismo de segredos precisam de inventário e controle.

**R08 aberto.** `assignScopedRoles` e `saveExceptions` agora adquirem o lock de escrita em `users` antes de modificar `access_grants` ou `access_user_exceptions`. O PostgreSQL demonstrou espera no primeiro objeto sem prender a relação seguinte e rollback integrado à auditoria em falhas `23514` e `23505`. Os 13 locks SHARE foram preservados. Contenção transversal e writers restantes continuam abertos, inclusive operações do Cofre que envolvem `vault_items` e cartões vinculados.

## Gates G1–G7

| Gate | Evidência de ensaio | DEV efetivo |
|---|---|---|
| G1 — Identidades e privilégios | Logins, escopo da credencial, owners e ACLs conferidos antes de montar. | Bloqueado pela separação operacional e pela matriz dos serviços em uso. |
| G2 — Migration 212 | Checksum do ledger e guard verificados. Evidência alterada recusada. | Bloqueado. 157, 158 e 212 exigem tratamento operacional. |
| G3 — Escrita exclusiva | DML legado recusado pelo PostgreSQL. Confirmação incerta sem replay. | Bloqueado até verificar writers externos, credenciais e drenagem. |
| G4 — Aplicação | Bootstrap real, login, RBAC, auditoria, MFA isolado e fluxos ordinários exercitados. | Parcial. Restam fluxos de plugins, workers e integrações reais. |
| G5 — Consistência local | CAS, rollback, poll, reinício e falhas após COMMIT. | Parcial. Sem evidência no DEV real. |
| G6 — Contingência | Validação pós-rollback mantém a ACL protetiva. Restore isolado reaplica a matriz. | Bloqueado. Barreira ainda ausente no DEV real. |
| G7 — Multi-instância | Dois processos do `main.ts` e teste HTTP de falhas em processos distintos. | Parcial. Topologia, manutenção e escritores reais não foram homologados. |

## Runbook de cutover e contingência

1. **Operador, após aprovação.** Conferir host, porta, banco, login, backup e restauração em destino isolado. Confirmar as migrations 157 e 158 com o migrador versionado e validar a matriz de fluxos em uso. A falta de pré-requisito é ponto de parada. Separar a invocação administrativa do ambiente da API.
2. **DBA, com escritores pausados e admissão bloqueada.** Rodar `r6-ownership-plan.sql`. Revisar identidades, definições, ACLs, dependências e writers. Guardar o hash revisto e a lista de evidências. Não derivar `ownership_sha256` automaticamente para aprovar uma execução.
3. **DBA, na janela aprovada.** Invocar cada arquivo com `psql -X` contra conexão verificada, `-v approval=OPERATOR_APPROVED`, `-v app_role=orbit_dev_app`, `-v owner_role=OWNER`, `-v writer_role=WRITER`, `-v reader_role=LEITOR`. Passar `-v ownership_sha256=HASH_REVISADO` a preflight e prepare. Ordem: `r6-preflight.sql`, `r6-prepare.sql`, `r6-validate.sql`. Divergência, sessão não drenada ou erro de ACL suspende o corte.
4. **Operador da API, após o DBA validar.** Com os dois arquivos privados montados, conferir papéis e domínio observado por conexão administrativa. Subir primeiro uma instância autorizada, confirmar login, leitura, toggle e recusa do SQL legado, e então comparar com a segunda. Configuração incompleta mantém pausa ou recusa startup. Somente a aprovação operacional autoriza essa troca.
5. **Em falha.** Antes de COMMIT, confirmar rollback e conservar o estado anterior. Se COMMIT estiver incerto, abrir sessão nova e conferir ledger, owners e ACLs. Depois do corte, pausar o toggle, retirar o pool privado e rodar `r6-contingency.sql`. O teste representou a reversão executando o SQL exato do writer anterior sob o papel geral e confirmou a recusa pelo PostgreSQL. Se for necessário restaurar dados, usar novo destino `orbit_restore_*`, com aprovação específica e `r6-restore-acl.sql`, conferir os grants e revalidar o namespace e a identidade antes de propor a troca. O modo participante aceita o nome operacional DEV e o nome da fixture em socket privado. Uma base de restore não é um destino participante aprovado por si só.

## Inventário e próximos passos

- API DEV: `main.ts`, `db.ts`, `plugins/plugin-settings.ts`, `plugins/plugin-settings-host.ts` e `plugins/plugin-settings-boundary.ts`. Configuração, montagem, verificação e lifecycle.
- Build DEV: `apps/api/package.json` e `apps/api/check-core-projections.mjs`. Paridade obrigatória no build e na compilação dirigida.
- Testes DEV: `experimental/fixtures/plugin-settings-http.ts` e `experimental/plugin-settings-http.postgres.spec.ts`. Estados, arquivos host, recusa técnica, deriva e recuperação multi-processo.
- ACL: `protected-acl.sql`, `after.sql`, `r6-before.sql`, `r6-after.sql`, `r6-runtime-acl.sql`, `r6-clone.postgres.spec.ts` e README do procedimento. Evidência de 212, pré-requisitos, grants por fluxo e bootstrap real com execução descartável.
- R02/R08: Core `discovery-review-{access-host,application,repository,repository.spec}.ts`, DEV `access/access.ts` e `access/management.ts` na fonte e projeção DEV. A validação final local e as ordens corrigidas preservam o contrato editorial indisponível.

As próximas ações são validar os fluxos de plugins e workers que a operação vai manter, autorizar e homologar as migrations prévias, segregar os logins e segredos e aprovar janela, inventário, backup e drenagem. A composição participante continua condicionada às verificações e ao ato autorizado de operação.
