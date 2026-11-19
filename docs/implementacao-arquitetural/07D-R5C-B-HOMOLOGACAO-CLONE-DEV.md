# 07D-R5C-B — Homologação em clone estrutural do DEV

**ENSAIO APROVADO COM PENDÊNCIAS OPERACIONAIS.** A estrutura exportada do DEV foi restaurada, a transição foi aplicada depois de resolver as precondições de ownership no clone, e o isolamento foi comprovado com logins distintos. O conjunto de fluxos da aplicação exercitado foi direcionado. **R02, R06 e R08 continuam abertos.** O ensaio não autoriza o corte.

## Reprodução e cobertura

- A configuração normal da API identificou o destino antes da conexão. A sessão de diagnóstico confirmou `orbit_native_dev`, PostgreSQL 16.15 e `orbit_dev_app` em loopback. A leitura usou transação `REPEATABLE READ READ ONLY`, com timeouts. O `pg_dump --schema-only` utilizou o mesmo snapshot e transação configurada para somente leitura.
- O dump reproduziu definições, índices, constraints, triggers, views, funções e ACLs de schema. A restauração preservou os comandos de ownership e ACLs. O ensaio também recriou explicitamente o owner do banco, a extensão `pgcrypto` sob o login antigo, a codificação UTF-8 e a locale `pt_BR.UTF-8`. O clone conferiu contagens, owners, ACL do schema, versão da extensão e ausência de memberships pertinentes.
- A estrutura do ledger foi restaurada com `version` e `checksum` em `text`, `applied_at` em `timestamptz` e chave primária por versão. O DEV não tinha 212. O ledger do clone começou vazio e foi populado pelo ensaio. As versões históricas, os dados de negócio, usuários, anexos, valores de sequências e o estado operacional dos serviços não foram copiados. A checagem local de indicadores de credenciais embutidas e objetos com conexões externas não encontrou ocorrências. A exportação ficou em diretório privado, fora do repositório.
- Toda escrita ocorreu no cluster descartável PostgreSQL 16.15, sem listener TCP. O harness verificou socket privado, banco de fixture e diretório de dados como administrador. As conexões de aplicação confirmaram banco, transporte e identidades. Só foi usado o modo `DISPOSABLE`.

## Inventário que explica o bloqueio

| Superfície | Evidência do DEV |
|---|---|
| Banco e schema | O login legado é owner do banco. `public` pertence a `pg_database_owner` e também tem grant direto de USAGE/CREATE ao legado. PUBLIC tem USAGE em `public` e CONNECT/TEMP padrão no banco. |
| Ownership adicional | 136 tabelas, uma view, seis sequências e 14 funções próprias pertencem ao legado, além do banco e da extensão `pgcrypto`. Entre as tabelas estão o ledger, `users`, `boards`, `cards` e `access_audit`. |
| Dependências | 520 constraints, incluindo 237 chaves estrangeiras. Seis sequências incluem IDs de auditoria e protocolo de Registros. Triggers de auditoria escrevem em outra tabela sob os privilégios do chamador. |
| ACLs e roles | Nenhuma ACL explícita em relações ou colunas inventariadas e nenhum default ACL customizado. A capacidade do runtime vinha do ownership. Nenhuma membership envolvendo o login legado. |
| Funções e extensões | Nenhuma função de usuário com `SECURITY DEFINER`. As 50 rotinas em `public`, incluindo 36 membros de `pgcrypto`, tinham EXECUTE para PUBLIC. `pgcrypto` 1.3 e `plpgsql` 1.0 foram reproduzidas. |

## Execução dos scripts

1. No clone inicial, preflight e preparação recusaram o ownership do banco. Transferir banco e ledger revelou o bloqueio por outros objetos do legado.
2. No clone, transferi individualmente as relações e funções restantes, exceto as duas tabelas que cabem à preparação. A extensão ainda bloqueou o preflight. No clone, `DROP EXTENSION ... RESTRICT` e recriação administrativa de `pgcrypto` na mesma transação passaram. Essa intervenção requer decisão do operador para o DEV, inclusive verificação de dependências e impacto sobre objetos da extensão.
3. O clone preparado passou por `preflight.sql`, `prepare.sql`, `validate.sql`, `contingency.sql` e nova validação. Validação e contingência passaram novamente após as verificações de aplicação. Nenhum script R5C-A precisou ser alterado.
4. A preparação registrou o nome completo e SHA-256 de 212. O legado terminou sem objetos próprios no banco e recebeu recusa PostgreSQL para o UPSERT antigo, DML protegido, SET ROLE, CREATE em `public`, alteração de trigger e delegação de ACL. O writer privado conseguiu o toggle pelo repositório R3C-B, com recusa para DELETE, escrita em instalações, alteração do estado editorial e DDL de schema. A contingência preservou a barreira.

## Compatibilidade e concessões pontuais observadas

As consultas a settings e instalações passaram com as ACLs de R5C-A. Estas operações ordinárias falharam depois da transferência de ownership e voltaram a passar com os grants indicados, aplicados **somente no clone**.

| Operação exercitada | Acesso mínimo demonstrado |
|---|---|
| Listar IDs e títulos de quadros | SELECT nas colunas `id,title` de `boards`. |
| Obter protocolo no módulo de Registros | USAGE em `extension_protocol_seq` para `nextval`. |
| `AccessService.audit` e trigger de histórico | INSERT nas colunas utilizadas de `access_audit`, USAGE em `access_audit_id_seq`, SELECT em `immutable_audit_events(event_hash,sequence_number)`, USAGE em `immutable_audit_events_sequence_number_seq` e INSERT nas cinco colunas gravadas pelo trigger em `immutable_audit_events`. O teste confirmou a associação entre evento e registro de auditoria. |

- `CREATE TEMP TABLE` recebeu recusa. A necessidade operacional de TEMP, o CRUD completo, as demais sequências, os serviços de plugins e a entrega distribuída ficaram sem homologação.
- Duas conexões writer, com a mesma revisão, produziram um avanço e um conflito CAS. A última vista obrigatória permaneceu disponível. Uma constraint provocou falha SQL e confirmou rollback de settings e revisão. A perda simulada da resposta de COMMIT fez uma única tentativa e recuperou o estado por nova leitura. Revisão final 2, autorização `unavailable`.
- O migrador real validou o checksum de 212 e aplicou uma migration de DDL sintética em diretório isolado. A segunda execução foi idempotente. O seed real passou duas vezes sob owner administrativo e preservou um único Inbox com identidade sintética. A API e a CLI de migration compartilham hoje a variável `DATABASE_URL`. A separação precisa ser aplicada no modo de invocação, incluindo bootstrap e backups da migration.
- O owner gerou e listou um dump do clone com dados exclusivamente sintéticos. O restore estrutural foi exercitado na entrada do ensaio. A CLI Orbit de restore, recuperação de dados e reaplicação de ACLs a um destino operacional precisam de ensaio próprio. O restore padrão usa `--no-owner --no-privileges`.
- A regressão direcionada `transition.postgres.spec.ts` passou com 6 testes, incluindo o pai. No clone, usei o writer real e `AccessService.audit`. O adaptador HTTP experimental e o bootstrap completo ficaram fora da cobertura.

## Gates e próxima ação

| Gate | Evidência do clone | DEV efetivo |
|---|---|---|
| G1 — Identidade e privilégios | Ownership separado, logins e ACLs conferidos. | **BLOQUEADO.** Runtime ainda owner na origem e credenciais segregadas não verificadas. |
| G2 — Migration 212 | Aplicada e registrada com checksum verificado. | **BLOQUEADO.** Ausente na origem consultada. |
| G3 — Exclusividade de escrita | SQL legado recusado. O host ainda precisa confinar o login privado ao writer participante. | **BLOQUEADO.** Código legado e capacidade de escrita presentes. Writers externos não verificados. |
| G4 — Segurança da aplicação | Auditoria real e leituras selecionadas passaram. | **PARCIAL.** Sem validação do bootstrap com os pools segregados. |
| G5 — Consistência local | Rollback, CAS e recuperação após COMMIT incerto demonstrados. | **PARCIAL.** Reconciliação operacional não verificada. |
| G6 — Rollback | Contingência repetida sem reabrir privilégios legados. | **BLOQUEADO.** A proteção ainda não existe no DEV. |
| G7 — Multi-instância | CAS com duas conexões distintas. | **PARCIAL.** Instâncias remotas, drenagem e notificações não verificadas. |

A próxima ação é revisar, em clone, a lista de transferências incluindo `pgcrypto` e completar uma matriz de grants por fluxo antes de pedir aprovação operacional. Ela deve cobrir bootstrap da API, auditoria, operações ordinárias e restore com ACLs reconstruídas. O DEV operacional foi usado apenas para leitura estrutural e permaneceu sem a transição.
