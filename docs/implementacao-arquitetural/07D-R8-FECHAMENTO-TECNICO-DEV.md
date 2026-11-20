# 07D-R8 — Fechamento técnico do toggle de plugins no DEV

Revalidação consolidada em 20/11/2026. O worktree contém alterações anteriores extensas; este relatório não atribui a esta execução a autoria exclusiva dos arquivos listados. Nenhuma operação destrutiva de Git, alteração no banco real, deploy ou restart foi feita.

## 1. Resumo executivo e decisão

- **Prontidão técnica do toggle DEV: PRONTO COM RESTRIÇÕES.** A composição `legacy`/`paused`/`participant`, o writer restrito, os guards SQL, CAS, convergência entre processos e recuperação foram exercitados em PostgreSQL 16 descartável com identidades sintéticas.
- **Prontidão de implantação no banco DEV: PENDENTE DE APROVAÇÃO E INFRAESTRUTURA.** O banco real continua no estado legado e o runtime ainda pode escrever nas tabelas protegidas. Este sprint não concede aprovação operacional.
- Nenhuma política editorial, Discovery Review, migration ou cutover foi ativado no banco real.

## 2. Baseline e estado final

- Branch `main`, HEAD `48b3328`; worktree já tinha aproximadamente 1.700 caminhos modificados/removidos/não rastreados. Preservados integralmente; sem reset, restore, clean, commit ou push.
- Fontes compartilhadas atuais: Core **1.16.3 (240 mappings)** e UI **1.4.3 (76 mappings)**. `shared check` retornou `ok: true`, sem divergências, atualizações, locks pendentes ou diagnósticos.
- Verificador oficial: compatibilidade de plugins alinhada em seis runtimes. `catalog --all`: `ok: true`, zero diagnósticos globais, seis runtimes.
- `git diff --check` passou.

## 3. Arquivos diretamente relacionados

- Composição DEV: `forge/app/apps/api/src/main.ts`, `db.ts`, `plugins/plugin-settings.ts`, `plugin-settings-host.ts`, `plugin-settings-boundary.ts` e `check-core-projections.mjs`.
- ACL e operação: `tools/orbit/dev-db-cutover/r6-runtime-acl.sql`, scripts `r6-*` e `tools/orbit/dev-db-cutover/README.md`.
- Ensaios: `tools/orbit/dev-db-cutover/r6-clone.postgres.spec.ts`, `transition.postgres.spec.ts`, `forge/app/experimental/plugin-settings-http.postgres.spec.ts` e fixtures em `forge/app/experimental/`.
- Correção do worker: `forge/app/apps/api/src/plugins/webhooks.ts` e `webhooks.spec.ts`.
- Nenhuma migration histórica foi alterada.

## 4. Implementação e composição do host

A API DEV compõe os modos `legacy`, `paused` e `participant`. No modo participante, um pool geral sem escrita protegida é separado do pool privado do writer. Credenciais privadas não são parâmetros HTTP nem dependências exportadas do container de plugins. A configuração exige arquivos privados distintos, caminhos absolutos, arquivo regular, UID esperado e modo `0600`. Identidade do banco/papéis, evidência da migration 212, guard, triggers, ACLs, domínio e revisão são verificados no startup; falha fecha a montagem, sem fallback ao pool geral. O host drena e fecha o pool no shutdown.

Essas verificações técnicas não substituem aprovação operacional. A segurança do arquivo também depende de restringir processos com o UID da API; ela não isola código arbitrário executado sob o mesmo UID.

## 5. Homologação em clone e fluxos

Os testes usaram PostgreSQL 16 descartável, socket Unix privado, identidades e dados sintéticos; o clone de schema foi exportado do alvo local em transação `READ ONLY`. O bootstrap real da API usou rede isolada, serviços externos desabilitados e executor Codex falso.

Cobertura aprovada nesta revalidação:

- Clone, bootstrap restrito, restore/ACL, fluxos administrativos sintéticos, workers e duas APIs reais independentes: **12/12**.
- Transição, ownership/ACL, identidades, escrita legada negada, CAS, falha SQL, COMMIT incerto e restore: **6/6**.
- Harness HTTP de dois processos, modos, autorização, toggle, último quadro obrigatório, polling, restart, ACK perdido, revogação e recuperação: **11/11**.
- R02/R08, políticas/revisão editorial sem ativação, snapshot, permissões, locks de writers e webhooks: **71/71**.
- **Total aprovado nesta revalidação: 100 testes, 0 falhas de asserção.** Há cobertura sobreposta entre grupos; o total não representa casos únicos.

Um comando combinado que também continha `records.spec.ts` foi interrompido após mais de quatro minutos sem progresso; o runner marcou quatro arquivos como cancelados. Esses cancelamentos não entram nos 100 aprovados. Registros não foi revalidado nesta passagem; o histórico de R8 registra seus ensaios anteriores.

Não houve entrega real de webhook, SMTP, OAuth, backup criptografado, Codex ou fila externa. A inspeção de processos locais não prova ausência de writers remotos.

## 6. Build e qualidade

Nesta revalidação do DEV atual, `npm run build --workspace apps/api` passou: paridade do Core, ESLint e TypeScript. `npm run build --workspace apps/web` passou: ESLint, compilação, TypeScript, geração de 23 páginas e otimização de produção.

A validação anterior registrada no relatório R8 executou os builds API e Web nos seis runtimes; a revalidação presente executou novamente ambos no Forge. Não houve build vermelho nesta passagem. Não foi feita homologação visual assistida. O runner de Registros cancelado é uma limitação de teste, não falha de build.

## 7. Banco DEV real — somente leitura

O script `tools/orbit/dev-db-cutover/r8-inspect-dev.mjs` carregou somente a configuração normal de `forge/app/apps/api/.env`, confirmou o alvo esperado antes de conectar e não exibiu segredo. A sessão confirmou `orbit_native_dev`, `127.0.0.1:5432`, PostgreSQL 16.15, login efetivo `orbit_dev_app`, transação somente leitura e timeouts.

Evidências observadas:

- Ledger: **156** registros; migrations locais: **124**. Migrations **157, 158 e 212 não registradas**; schema correspondente ausente.
- Sete migrations locais além dos focos estão sem registro (`155`, `156`, `159`, `160`, `207`, `208`, `209`); 41 registros do ledger não têm arquivo local correspondente. Nenhuma divergência de checksum foi observada entre arquivo e registro coincidentes.
- `orbit_dev_app` não é superuser, não cria papéis/bancos, não tem memberships nem bypass de RLS. Porém é owner do banco e de **143 objetos de classe**, tem `CREATE` em `public`, `TEMP` e privilégios integrais sobre `plugin_settings` e `plugin_installations`.
- O login também possui `pgcrypto` e 14 funções. Não há ACL explícita nas duas tabelas; a propriedade já lhe dá escrita.
- Modo do host é implícito; arquivos privados de aprovação e writer não estão configurados. Três sessões locais do mesmo login foram observadas; isso não prova drenagem ou ausência de escritores externos.
- Nenhuma DDL/DML, migration, alteração de ACL ou credencial real foi executada.

## 8. Matriz de privilégios e Gates G1–G7

| Gate | Clone descartável | DEV real agora |
|---|---|---|
| G1 — identidades/privilégios | papéis distintos e grants mínimos exercitados | **bloqueado**: runtime é owner; writer/leitor/migrador distintos não comprovados |
| G2 — schema/migration 212 | 157/158 e 212 executadas pelo fluxo versionado no clone | **bloqueado**: as três não constam no ledger/schema; divergência histórica requer plano DBA |
| G3 — escrita exclusiva | DML legado negado pelo PostgreSQL após preparação | **bloqueado**: runtime real ainda tem escrita protegida; escritores remotos não inventariados |
| G4 — aplicação | bootstrap, acesso, workspaces, quadros, Registros, auditoria e workers exercitados | **parcial**: sem cutover real e integrações externas não exercitadas |
| G5 — consistência | CAS, polling, COMMIT incerto, idempotência e restart multi-processo | **parcial**: não comprovada no modo participante real |
| G6 — contingência | rollback, backup/restore sintético e reaplicação ACL exercitados | **bloqueado/parcial**: restauração operacional não comprovada |
| G7 — múltiplas instâncias | duas APIs independentes e reconvergência aprovadas | **parcial**: topologia e writers remotos desconhecidos |

## 9. Migrations, R02, R06 e R08

- **157/158/212:** clone aplicou as pré-condições pelo migrador versionado e a 212 pelo procedimento de cutover. Não foram aplicadas ao DEV real. O ledger real tem divergência entre 124 arquivos locais e 156 entradas históricas; não é seguro aplicar só esses três números sem plano do DBA.
- **R02 aberto:** a asserção de providers cobre o limite local antes do despacho do COMMIT, mas não prova sincronização entre processos após o despacho. Discovery Review permanece `unavailable`.
- **R06:** preparação, ACLs e restore foram exercitados no clone; identidade, schema, sessões e writers reais ainda impedem cutover.
- **R08 aberto para revisão editorial:** ordem de locks corrigida nos writers comprovados; 13 locks SHARE preservados. Concorrência completa dos demais writers permanece fora da prova. Esse bloqueio editorial não invalida por si só o toggle DEV.

## 10. Pacote operacional único

`tools/orbit/dev-db-cutover/README.md` é a entrada canônica. Procedimento: `r6-ownership-plan.sql` → `r6-preflight.sql` → `r6-prepare.sql` → `r6-validate.sql`; depois montagem aprovada do host. Scripts sem `r6-` são explicitamente fixtures/regressões antigas, não procedimentos concorrentes. O runbook define alvo, inventário/hash revisado, schema, ownership/ACL, bloqueio e drenagem, condições de parada, pós-COMMIT incerto, contingência e restore isolado com reaplicação de ACL. Não contém senhas ou URLs.

Foi ensaiado em clone. **Não está liberado para execução no DEV atual.** Operador/DBA devem interromper se alvo, ledger, checksum, objetos, ACLs, sessões, writers, backup ou aprovação divergirem.

## 11. Dependências e riscos reais

- Reconciliação revisada do ledger/schema histórico e validação operacional das migrations.
- Provisionamento aprovado de owner/migrador, runtime, writer e leitor com credenciais distintas.
- Inventário de jobs, operadores, processos e writers remotos; bloqueio de admissão e drenagem verificável.
- Backup e restauração aprovados no alvo, hash/inventário revisados e janela operacional.
- Aceitação no DEV real depois dos gates SQL e aprovação explícita. A ausência de observação não prova inexistência.

## 12. Próximas ações (máximo cinco)

1. DBA reconcilia o schema/ledger e entrega plano aprovado de migrações.
2. DBA provisiona e valida as identidades separadas e a matriz de ACL.
3. Operação inventaria writers externos, prepara backup/restauração e janela com bloqueio/drain.
4. Com aprovação explícita, repetir `r6-preflight.sql`; qualquer diferença mantém parada.
5. Só após validação SQL e aprovação do host, montar uma instância participante, executar aceitação e expandir para as demais.
