# 07D-R5B-AUTO2 — Diagnóstico PostgreSQL DEV

## Resultado

O diagnóstico conectou ao PostgreSQL DEV usando a configuração normal da API. Foi verificada uma identidade SQL: `orbit_dev_app`. Os privilégios observados nessa identidade tornam o corte inseguro; não foram feitas alterações no banco, serviços ou configuração.

## Identificação e método

- Configuração carregada em memória: `forge/app/apps/api/.env`, pelo caminho normal usado pela API DEV (`DATABASE_URL`). Nenhum segredo foi impresso ou registrado.
- Destino não secreto confirmado pela configuração e pela sessão: `127.0.0.1:5432`, banco `orbit_native_dev`, PostgreSQL 16.15.
- A própria conexão confirmou `current_database = orbit_native_dev` e `session_user = current_user = orbit_dev_app`.
- Consultas somente leitura executadas dentro de transação `READ ONLY`, com `statement_timeout` local de 4 segundos; transação encerrada com rollback.
- Total de identidades verificadas: **1**. Não havia configuração DEV separada acessível para writer privado ou migrador. Isso não prova que esses papéis não existam no banco.

## Evidências SQL

- `orbit_dev_app`: `SUPERUSER`, `CREATEROLE`, `CREATEDB`, `REPLICATION` e `BYPASSRLS` falsos; `INHERIT` verdadeiro. A consulta a memberships não retornou linhas.
- `plugin_settings` e `plugin_installations` existem e pertencem a `orbit_dev_app`.
- O papel tem `SELECT`, `INSERT`, `UPDATE`, `DELETE` e `TRUNCATE` efetivos nas duas tabelas; também tem privilégios de coluna `SELECT`/`INSERT`/`UPDATE` e `CREATE` no schema `public`.
- Não foram encontrados `editorial_authorization_generation` nem sua função guard.
- `schema_migrations` existe; não há registro da migration 212.
- As consultas de catálogo foram executadas para ownership, ACLs, funções e triggers relevantes. A evidência demonstra o ownership e os privilégios acima; não demonstra isolamento entre identidades porque só um login foi verificado.

## Writers observáveis

- O runtime DEV ainda contém o caminho legado `setPluginEnabled` em `forge/app/apps/api/src/main.ts`, escrevendo settings pelo pool geral.
- A migration 212 está disponível na fonte do core, mas não consta como aplicada no banco DEV diagnosticado. A projeção operacional DEV e os objetos da migration não foram alterados.
- A inspeção local de processos não prova ausência de outras instâncias, conexões remotas ou writers externos; esses permanecem não verificados.

## Gates G1–G7

| Gate | Status | Evidência / lacuna |
|---|---|---|
| G1 — Identidade e privilégios | **BLOQUEADO** | O único login observado é owner das tabelas e dispõe de DML amplo e `CREATE` no schema. Writer privado e migrador não verificados. |
| G2 — Migration 212 | **BLOQUEADO** | Não há registro 212 em `schema_migrations`; objetos de geração ausentes. |
| G3 — Exclusividade de escrita | **BLOQUEADO** | O writer legado continua no runtime; writers remotos/externos não foram descartados. |
| G4 — Segurança da aplicação | **PARCIAL** | R5A tem cobertura de fixture; o serviço não está montado no bootstrap operacional e não foi exercitado com identidades separadas reais. |
| G5 — Consistência local | **PARCIAL** | Fixtures cobrem confirmação incerta/recuperação local; sem prova operacional entre processos independentes. |
| G6 — Rollback | **BLOQUEADO** | Não foi provado que ACLs impeçam binário anterior de voltar a escrever. |
| G7 — Multi-instância | **PARCIAL** | Fixtures simulam concorrência; não foram testadas instâncias independentes com papéis reais. |

## Decisão e próxima ação mínima

**BLOQUEADO POR SEGURANÇA.** Não iniciar cutover ou R5C. O DBA/operador autorizado precisa provisionar ou disponibilizar separadamente as conexões DEV de runtime, writer privado e migrador, sem compartilhar segredos no relatório. Depois, comprovar os privilégios de cada papel, planejar a migration 212 e demonstrar que o papel legado não pode escrever após rollback.

O arquivo `tools/orbit/editorial-dev-sql-preflight.sql` não foi alterado, conforme o escopo de entrega restrito a este relatório. Na execução, a verificação de `schema_migrations` foi feita condicionalmente: primeiro presença no catálogo (`to_regclass`), depois leitura do registro 212. O script versionado ainda consulta essa tabela diretamente; antes de reutilizá-lo em bancos onde ela possa faltar, a consulta deve ser adaptada para essa verificação condicional.

## Preservação

Nenhum DDL, DML, grant/revoke, migration, deploy, restart, commit, push ou alteração de configuração foi executado. O único arquivo desta entrega atualizado é este relatório. As demais alterações preexistentes na árvore de trabalho foram preservadas.
