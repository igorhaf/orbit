# Isolamento PostgreSQL DEV — procedimento canônico

**Não executar sem aprovação operacional explícita, inventário revisado e janela autorizada.** Este documento é o único runbook de cutover. Para o banco DEV use exclusivamente os arquivos `r6-*`; os arquivos sem prefixo `r6-` são fixtures/regressões do cenário R5C-A e não são um procedimento alternativo.

O procedimento separa a identidade geral da API, o writer privado do toggle, o leitor de evidências e o owner/migrador administrativo. Ele não provisiona papéis, cria credenciais, altera configurações de host nem autoriza a montagem do toggle. Connection strings e senhas são fornecidas pelo operador fora dos artefatos. Não use nomes de papéis de exemplo sem inventário e aprovação.

## Pré-requisitos e pontos de parada

1. Um operador independente confirma host, porta, banco, versão, login e backup em fonte operacional. O script não confia no nome informado como prova do alvo.
2. Migrations 157 e 158 devem estar aplicadas pelo migrador versionado e aprovadas no fluxo normal. O cutover R6 **não** as aplica. Confirme schema, ledger e checksums por conexão nova.
3. Homologue a exportação estrutural em PostgreSQL 16 descartável. Revise owners, ACLs de tabela/coluna, privilégios de PUBLIC e defaults, memberships, extensões, funções privilegiadas e writers externos. O teste local não prova que todos os writers remotos foram localizados.
4. O procedimento de transferência exige operador PostgreSQL com autoridade para `REASSIGN OWNED`; use uma identidade administrativa separada das três identidades de runtime.
5. Confira backup e restore em destino isolado. Durante a janela, suspenda alterações de configuração e workers, bloqueie novas conexões pelo mecanismo operacional, drene instâncias e migradores e registre evidência de cada etapa. Uma consulta local de sessões não prova ausência de clientes remotos.

**Pare imediatamente** se o alvo divergir, faltar aprovação/hash revisado, houver migration/checksum inesperado, objeto compartilhado adicional, ACL diferente da fixture, sessão não drenada, writer externo sem tratamento, backup não restaurável ou qualquer resultado SQL diferente do esperado. Não repita uma preparação com `COMMIT` incerto: reconcilie em conexão nova.

## Sequência única de cutover

Execute cada arquivo individualmente com `psql -X`, `ON_ERROR_STOP`, contra a conexão conferida. Registre os resultados sem segredos.

1. `r6-ownership-plan.sql`: produzir o inventário. Revisar os papéis e dependências à parte e registrar o SHA-256 candidato; o próprio hash não aprova o plano.
2. `r6-preflight.sql`: em transação read-only, passar `approval=OPERATOR_APPROVED`, os quatro papéis revistos e `ownership_sha256=<hash aprovado>`. Qualquer divergência encerra o processo.
3. `r6-prepare.sql`: somente após bloquear novas admissões e drenar todos os writers. Em uma transação, transfere ownership, instala a 212 e a ACL nomeada, então valida as invariantes antes do `COMMIT`.
4. `r6-validate.sql`: rodar em conexões novas; conferir identities, ownership, ACLs, migration, guard e recusa de escrita legada. Se falhar, manter a aplicação pausada e seguir a contingência.
5. Só após validação SQL e aprovação própria do host, montar os arquivos privados de aprovação e credencial com dono UID da API e modo `0600`; iniciar uma instância, executar aceitação sem escrita legada, depois validar cada instância adicional. Nenhum script SQL inicia, reinicia ou libera tráfego da API.

Exemplo de invocação (substitua papéis e hash somente pelos valores aprovados; a conexão é fornecida fora do arquivo):

```sh
psql -X -v ON_ERROR_STOP=1 -v approval=OPERATOR_APPROVED \
  -v owner_role=OWNER_REVISADO -v app_role=orbit_dev_app \
  -v writer_role=WRITER_REVISADO -v reader_role=LEITOR_REVISADO \
  -v ownership_sha256=HASH_REVISADO \
  -f tools/orbit/dev-db-cutover/r6-preflight.sql
```

Repita a mesma invocação aprovada, trocando o arquivo para `r6-prepare.sql` e depois `r6-validate.sql`. Não use `approval=OPERATOR_APPROVED` em fixture nem `approval=DISPOSABLE` no banco real.

## Contingência e restore

- Falha antes do `COMMIT`: confirmar rollback e executar `r6-preflight.sql` em conexão nova. Não reabrir escritores até conferir o estado.
- Confirmação de `COMMIT` perdida: manter tráfego suspenso e comparar ledger, ownership e ACLs com `r6-preflight.sql` e `r6-validate.sql`; nunca reaplicar às cegas.
- Após o corte, se o binário precisar ser revertido: pausar o toggle, retirar o pool privado e executar `r6-contingency.sql`. Ela mantém a ACL protetiva e não devolve escrita ao runtime legado. Voltar ownership pode reabrir escrita e requer plano aprovado separado.
- Restore: restaurar somente em banco `orbit_restore_*` isolado, validar conteúdo e executar `r6-restore-acl.sql` com `approval=OPERATOR_APPROVED_RESTORE`; validar em conexões novas antes de considerar qualquer troca. Restore de dados não constitui autorização.

## Ensaios descartáveis

O clone exporta apenas o schema do DEV por conexão local previamente identificada em `r6-clone.postgres.spec.ts`, em transação `READ ONLY`, timeouts limitados, `pg_dump --schema-only` e socket privado. Os testes gravam somente dados sintéticos no PostgreSQL descartável.

```sh
ORBIT_R6_REHEARSE_DEV_SCHEMA=1 ORBIT_R6_BOOTSTRAP_API=1 \
  ./forge/app/node_modules/.bin/tsx --tsconfig forge/app/apps/api/tsconfig.json --test \
  tools/orbit/dev-db-cutover/r6-clone.postgres.spec.ts \
  tools/orbit/dev-db-cutover/transition.postgres.spec.ts
```

`ORBIT_R6_BOOTSTRAP_API=1` acrescenta o bootstrap real e dois processos da API numa rede privada sem saída, usando identidades sintéticas e `/usr/bin/false` como executor Codex. Requer `unshare`, `ip` e `curl`. O ensaio demonstra somente os fluxos incluídos; não comprova topologia, writers ou disponibilidade de integrações no DEV operacional.
