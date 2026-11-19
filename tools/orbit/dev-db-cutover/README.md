# Isolamento PostgreSQL DEV

**NÃO EXECUTAR SEM APROVAÇÃO OPERACIONAL.**

O procedimento cobre a fronteira de `plugin_settings`, `plugin_installations` e geração editorial. Os quatro logins são parâmetros, e somente o nome do runtime DEV é fixado pelo diagnóstico anterior. Os scripts não provisionam roles nem leem credenciais. Execute a partir de uma sessão administrativa direta no destino conferido, com `psql -X` e um único arquivo por invocação.

## Antes da janela

1. Confirme host, porta, banco, versão e login por inventário independente. Confirme o SHA-256 do SQL canônico de 212 contra o valor de `prepare.sql`. A migration cria o contador com autorização indisponível.
2. Homologue em clone representativo. Faça inventário do ownership do banco, schemas, tabelas, sequências, rotinas, extensões e migrations, ACLs diretas, por coluna, de PUBLIC e defaults, roles herdadas, rotinas com privilégios elevados e writers externos. Prepare um plano explícito para transferir os demais objetos do login legado e preservar os grants ordinários necessários. O script recusa ownership legado adicional e não usa `REASSIGN OWNED`.
3. Separe a credencial do migrador da API e do writer. O owner administrativo deve possuir o banco, o ledger e o schema `public` ou controlá-lo via `pg_database_owner`. O perfil testado usa quatro logins distintos sem memberships. A preparação exige um operador PostgreSQL superusuário para transferir objetos entre owners sem vincular os logins.
4. Confira permissões ordinárias e dependências de `TEMP`, schema e `search_path`, incluindo migrations, seed, backup e restore. A preparação retira `TEMP` de PUBLIC. Se houver consumidores legítimos que dependam de permissões afetadas, encaminhe-os para revisão antes de prosseguir.
5. Verifique backup e restauração em destino isolado. Suspenda o toggle, drene conexões, bloqueie reconexões por controle externo de admissão e coordene operadores, migradores, jobs e instâncias remotas. A checagem local de sessões é uma barreira adicional.

## Ordem sob aprovação

Use `approval=OPERATOR_APPROVED` apenas para `orbit_native_dev`. Use `approval=DISPOSABLE` para a fixture `orbit_r5ca_fixture` em socket Unix privado.

1. Rode `preflight.sql` em transação somente leitura. Qualquer divergência interrompe o procedimento.
2. Rode `prepare.sql` uma vez. A operação em uma transação adquire o advisory lock do migrador, bloqueia as tabelas alvo, confere a base, transfere ownership, aplica e registra 212, restringe ACLs e confere a matriz antes do COMMIT.
3. Rode `validate.sql`. Com conexões novas, confira as identidades efetivas, as leituras e a recusa do SQL legado em clone, e valide fluxos ordinários e bootstrap com as credenciais planejadas. A montagem do writer no host exige autorização própria. O passo SQL não publica nem habilita rota.

Formato do comando, com os nomes operacionais conferidos e a conexão fornecida fora do arquivo:

```sh
psql -X -v approval=OPERATOR_APPROVED \
  -v owner_role=OWNER_REVISADO -v app_role=orbit_dev_app \
  -v writer_role=WRITER_REVISADO -v reader_role=LEITOR_REVISADO \
  -f tools/orbit/dev-db-cutover/preflight.sql
```

## Contingência

Se a preparação falhar antes do COMMIT, encerre a sessão e confirme o estado com o preflight. Em perda de confirmação do COMMIT, mantenha isolamento e compare o preflight e a validação em sessão nova. Não repita a preparação às cegas.

Após COMMIT confirmado, suspenda o toggle e retire o pool privado de circulação em caso de rollback do binário. Rode `contingency.sql` para confirmar que a barreira SQL continua aplicada. Se as checagens falharem, mantenha o isolamento e investigue antes de reabrir o tráfego. A contingência mantém ownership administrativo e não devolve DML ao binário legado. A volta de ownership exige revisão específica, pois pode reabrir capacidades inerentes ao owner.

Para recuperar dados, restaure em banco isolado sob papel administrativo. Reaplique e verifique a matriz no destino antes de conectá-lo à aplicação. Um dump sem ACL e sem owner não transporta essa fronteira. O contador e o identificador de domínio podem ser clonados com os dados, portanto o restore não constitui uma nova autorização editorial.

## Procedimento canônico para o DEV após a R7

Os comandos sem prefixo `r6-` continuam atendendo ao cenário R5C-A, com o owner administrativo já separado. Para cutover DEV, use o caminho com prefixo `r6-`, atualizado e ensaiado na R7. Ele parte da estrutura observada no DEV, em que o runtime antigo é dono do banco e dos objetos ordinários, e usa a mesma aprovação e as mesmas quatro variáveis de papéis.

1. Antes de calcular o fingerprint, confira as migrations de runtime 157 e 158 no ledger e no catálogo. O clone exportado não tinha `cards.card_revision` nem `card_runs.worker_id`. O ensaio aplicou os dois arquivos canônicos somente no cluster descartável pelo runner versionado. O DBA deve revisar e aprovar a atualização de schema operacional pelo fluxo normal de migrations. O script de cutover recusa uma base sem os objetos necessários e não aplica esse conjunto de migrations.
2. Em janela aprovada e com admissões bloqueadas, execute `r6-ownership-plan.sql`. Revise cada identidade retornada, os privilégios efetivos e os dependentes. Registre o SHA-256 exibido no plano aprovado. O hash vincula as identidades de ownership. Definições, dependentes e ACLs exigem revisão separada.
3. Passe o SHA-256 conferido em `-v ownership_sha256=<valor>` para `r6-preflight.sql` e `r6-prepare.sql`. A preparação recusa outros objetos compartilhados, desvios na lista revisada e ACLs de relações/colunas que fujam da base observada. O advisory lock e a drenagem são verificações adicionais à contenção externa de novas conexões.
4. A preparação transfere o banco, suas relações, rotinas e a extensão com `REASSIGN OWNED` em uma transação. Confere que `pgcrypto` preserva OID e versão. Reaproveita a migration 212, o ledger da R5C-A e suas ACLs protegidas, instala a matriz de grants por operação e verifica a fronteira antes do COMMIT.
5. Repita `r6-validate.sql` e use `r6-contingency.sql` se precisar suspender o toggle e retirar o pool privado. As verificações preservam o bloqueio do binário antigo.
6. Para um dump pós-corte, restaure sob o papel administrativo em um banco `orbit_restore_*` isolado. Valide o conteúdo e use `r6-restore-acl.sql` com `approval=OPERATOR_APPROVED_RESTORE`. O mecanismo exige 212 restaurada, reaplica as ACLs e falha se as invariantes não forem atendidas. Libere a aplicação somente após o destino restaurado passar nas verificações. A matriz de ensaio cobre os fluxos declarados em `r6-runtime-acl.sql` e exige complemento revisado para outros serviços.

O ensaio reproduz somente o esquema do destino DEV autorizado. A exportação é obtida em snapshot somente leitura no mecanismo DEV conhecido e usada num PostgreSQL 16 temporário de socket privado. Os únicos dados gravados são sintéticos no clone.

```sh
ORBIT_R6_REHEARSE_DEV_SCHEMA=1 ./dev/app/node_modules/.bin/tsx \
  --tsconfig dev/app/apps/api/tsconfig.json --test \
  tools/orbit/dev-db-cutover/r6-clone.postgres.spec.ts
```

O ensaio opcional do bootstrap e dos dois processos da API usa `ORBIT_R6_BOOTSTRAP_API=1`, uma rede privada Linux sem saída e configurações sintéticas. A fixture não possui consumidores externos e usa `/usr/bin/false` como binário do Codex. Requer `unshare`, `ip` e `curl`.
