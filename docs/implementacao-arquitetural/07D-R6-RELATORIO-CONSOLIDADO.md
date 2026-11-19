# 07D-R6 — Consolidação do isolamento PostgreSQL e da integração DEV

## 1. Resumo executivo

O DEV ganhou um controller para o toggle de plugins e um serviço participante dentro da API. O serviço foi exercitado por HTTP em processos independentes, usando o AccessGuard, o PostgreSQL 16 e os privilégios restritos. A composição operacional continua fechada ao novo writer. A presença do caminho de credencial privada só pausa a rota. A presença da migration 212 também impede o caminho legado.

Os scripts R6 transferiram o ownership do esquema real em clone estrutural, preservaram a extensão `pgcrypto` no mesmo OID e instalaram 212 em uma transação. A nova matriz permitiu iniciar o bootstrap real isolado e exercitar autenticação, configuração, auditoria, workspaces e operações selecionadas em quadros, listas e cartões. O ensaio de restore reaplicou a fronteira e manteve o SQL legado bloqueado. O banco operacional foi consultado somente para exportação estrutural autorizada.

## 2. Baseline

Branch `main`, HEAD `d9307b8`, com 478 entradas já alteradas ou não rastreadas no início. Core fonte, workspace e locks dos quatro runtimes registravam **1.12.5 e 231 mappings**. No DEV real, o login da API possuía o banco, 136 tabelas, uma view, seis sequências, 14 rotinas próprias e `pgcrypto`. A migration 212 não constava como aplicada. Os diretórios PROD, Safdoulas e Suindá preservaram as alterações preexistentes.

## 3. Alterações implementadas

- O endpoint `PATCH /plugins/:id` foi transferido do controller amplo para o controller de configuração. Ele usa a mesma rota e o AccessGuard global. A operação participante vive no código compilado da API DEV.
- O serviço diferencia o estado anterior ao corte, a pausa e o writer participante. O host controla o pool privado e invoca a validação SQL antes de montar o writer. Não há parâmetro HTTP de credencial ou revisão.
- A recuperação R3C-D passou a aceitar o valor padrão do host. A API lê settings em snapshot por consulta e aplica os valores configurados juntos, antes de notificar, para que o registry avalie dependências no mesmo estado local.
- O fluxo de papéis de Registros no DEV atualiza `users.session_version` antes do DML em `access_grants`, mantendo a auditoria na mesma transação. Essa ordem elimina uma inversão concreta com a primeira parte do protocolo editorial.
- A preparação R6 usa o plano de ownership e a matriz de ACLs por fluxo. Há um caminho separado e restrito para reaplicação de ACLs após restore.

## 4. Infraestrutura PostgreSQL

O clone R6 foi restaurado a partir de exportação `--schema-only` com o login DEV autorizado. A conexão verificou o destino e o dump rodou com somente leitura. A reprodução trouxe objetos e dependências, e recriou os logins relevantes e o ownership da extensão. O cluster PostgreSQL 16 temporário escutou apenas em socket Unix privado. Os dados de teste foram sintéticos.

`r6-ownership-plan.sql` lista identidades com ownership e calcula SHA-256 do inventário. O operador precisa revisar a lista e fornecer o hash aprovado. `r6-preflight.sql` exige a mesma fronteira e detecta mudanças no inventário. A preparação protege o ledger e tabelas alvo com locks e exige as sessões drenadas. O isolamento de novas conexões e de operadores concorrentes depende do controle externo da janela. O hash cobre identidades de objetos. A revisão de definições e ACLs depende da inspeção separada.

`REASSIGN OWNED` foi executado no clone sob essa guarda, com proteção explícita contra outros objetos compartilhados do login antigo. Moveu os objetos do banco ao papel administrativo e preservou o OID e a versão de `pgcrypto`. O ensaio elimina a necessidade de recriar a extensão neste perfil. A preparação aborta diante de divergência, como outro objeto compartilhado do legado. A migration 212 é aplicada a partir do SQL canônico e registrada no ledger com nome e checksum. O SQL da migration original permaneceu intocado.

O prepare remove CREATE/TEMP do perfil restrito e fecha CONNECT e acesso ao schema para PUBLIC; os logins de uso recebem grants explícitos. O writer recebe somente as colunas da configuração e revisão exigidas por R3C-B. A credencial é privilegiada para essas colunas e deve ficar confinada ao writer. A ACL, por si, não obriga seu portador a avançar a geração.

## 5. Matriz de privilégios

| Fluxo | Privilégio do perfil proposto | Validação |
|---|---|---|
| Inicialização do RBAC | SELECT do catálogo e UPDATE de `access_roles(permissions,defaults_initialized)`. | `AccessService.initializeDefaults` exercitado no clone e no bootstrap real isolado. |
| Login, sessão, rate limits | SELECT em `users`. DML nas tabelas de tentativas e limite de requisições. DELETE e INSERT das colunas usadas no histórico de login. | Autenticação com senha sintética em `/auth/login`, sessão em `/auth/me`, JWT inválido e sessão revogada. Fluxos de cadastro, MFA e social login ficam pendentes. |
| RBAC e AccessGuard | SELECT nos grants, roles, grupos, membros, exceções e overrides de permissão. | Permissão de usuários ROOT e comuns no clone. HTTP real com manager e viewer no ensaio. Mutações administrativas de papéis fora da matriz atual. |
| Auditoria | INSERT das colunas usadas de `access_audit`, leitura para consulta e USAGE na sequência. O trigger invoker requer leitura de hash e sequência, INSERT das colunas gravadas e USAGE na sequência de `immutable_audit_events`. | `AccessService.audit` com histórico encadeado confirmado no clone. |
| PluginRegistry e toggle | SELECT de settings e instalações pelo geral. Writer com SELECT/INSERT em `plugin_id,enabled`, UPDATE de `enabled,updated_at`, SELECT de geração e UPDATE em `revision`. | Defaults, dependência, concorrência, reinício, recusa do legado e restrição de DML provados. Instalação e desinstalação administrativas ficam pendentes. |
| Workspaces | SELECT/INSERT/UPDATE em `workspaces`. Grants nomeados em membros e recursos. | `WorkspacesService.create` no clone. Cobertura incompleta de mutações dos subrecursos. |
| Boards, listas, cards | ACLs nomeadas no esquema base, SELECT na view de membros autorizados e nas leituras auxiliares cobertas pela matriz. | Criação e acesso de quadro/lista, criação e atualização de card. REST completo e plugins de cartão ficam pendentes. |
| Triggers de card | INSERT das colunas do evento de automação e USAGE na sequência. SELECT de `card_id,status` e UPDATE de `organized_at` em `attachment_backup_cloud_copies`. | Erros de privilégio reproduzidos. Operações repetidas com a concessão mínima identificada. |
| Registros e sequências | USAGE em `extension_protocol_seq`. | `nextval` real. Fluxos integrais de Registros, e demais sequências de jobs e entrega, ficam pendentes para o perfil restrito. |
| Migrations e seed | Owner administrativo com DDL e DML. O geral não controla ledger, trigger ou schema. | Migrador Orbit verificou 212 e registrou uma migration sintética idempotente. Seed real idempotente em clone. |
| Backup e restore | Dump e restore por papel administrativo, seguidos por reaplicação de ACLs no destino isolado. Leituras específicas de configuração, conexões e anexos para o startup. | Dump/restore reais com dados sintéticos. A aplicação voltou a ler settings, com DML protegido recusado. CLI criptografada e integrações de backup ficam pendentes. |
| TEMP e extensões | TEMP recusado no perfil restrito. `pgcrypto` mantido no namespace já usado, sob owner administrativo. | Preservação de identidade e versão e recusa de tabela temporária. Dependência de TEMP em fluxos fora da matriz fica pendente. |

## 6. Integração DEV

O controller autentica pelo AccessGuard e confirma a identidade e `plugins.manage` no momento em que o serviço retira a operação da fila local. O serviço confere instalação, tipo do valor e a definição registrada. Dependências continuam sendo avaliadas pelo PluginRegistry. O CAS nasce de observação do servidor. O writer conserva a ordem geração → advisory → DML. O pool privado é passado pelo host, fica encerrado no serviço e tem limites de conexões e tempos de aquisição, locks e consultas.

A verificação de montagem exige logins efetivamente distintos e restritos, mesma base comprovada por teste de advisory lock, `search_path` controlado, ownership administrativo, guard ativo e ACLs efetivas de runtime e writer. A validação de 212 e do inventário de outros writers pertence aos scripts de operador. Esse verificador é feito na montagem, sem tentar deduzir que a fronteira operacional está homologada.

O `main.ts` monta o caminho anterior ao corte. A variável `ORBIT_PLUGIN_SETTINGS_WRITER_CREDENTIAL_FILE` representa apenas a presença da configuração de host e pausa o toggle. O código desta entrega não abre o arquivo nem usa a variável para autorizar montagem. O ensaio compõe o serviço participante diretamente com um pool restrito. A ativação futura exige revisão da composição do host e evidência operacional. O migrador pode receber `DATABASE_URL` administrativo na sua própria invocação, com o valor geral mantido no processo da API. O pool privado não foi adicionado a configurações editáveis pelos plugins.

## 7. Recuperação e consistência

O caminho participante atualiza o registry depois da confirmação do COMMIT. Falha de memória ou de notificação produz resposta de commit com estado local possivelmente obsoleto. A recuperação lê SQL novamente. COMMIT incerto responde 503 e pede nova leitura ao cliente. O teste confirmou uma única tentativa de gravação e atualização do registry por observação posterior.

A montagem participante carrega o snapshot inicial, respeitando defaults de plugins sem registro. O poll corrige diferenças mesmo se um evento for perdido. Hints apenas iniciam nova observação. O ensaio demonstrou processos com estados distintos, convergência, recuperação de dependências e reconstrução após reinício. Notificações de websocket permanecem locais e não comprovam entrega entre hosts. A observação de settings sempre preserva o estado editorial indisponível.

## 8. Testes executados

- Regressões do repositório editorial, Registros e snapshot, **87 aprovados**. Comando `./dev/app/node_modules/.bin/tsx --tsconfig dev/app/apps/api/tsconfig.json --test packages/orbit-core/src/execution/{discovery-review-repository,editorial-authorization-snapshot}.spec.ts dev/app/apps/api/src/plugins/records/records.spec.ts`. Incluem 53 testes editoriais anteriores, a nova prova de ordem no writer real, 27 de Registros e seis de snapshot.
- Regressão de geração, CAS, writer, reconciliação, recuperação, R5-PRE e R5A, **43 aprovados**, incluindo pais. Comando `./dev/app/node_modules/.bin/tsx --tsconfig dev/app/apps/api/tsconfig.json --test packages/orbit-core/src/execution/editorial-authorization-generation.postgres.spec.ts`.
- Preparação R5C-A e clone estrutural R6, **11 aprovados**, incluindo pais. Comando `ORBIT_R6_REHEARSE_DEV_SCHEMA=1 ORBIT_R6_BOOTSTRAP_API=1 ./dev/app/node_modules/.bin/tsx --tsconfig dev/app/apps/api/tsconfig.json --test tools/orbit/dev-db-cutover/{r6-clone,transition}.postgres.spec.ts`.
- Ensaio HTTP em dois processos, **8 aprovados**, incluindo o pai. Comando `./dev/app/node_modules/.bin/tsx --tsconfig dev/app/experimental/tsconfig.plugin-settings.json --test dev/app/experimental/plugin-settings-http.postgres.spec.ts`.
- TypeScript da API e do harness aprovados. A compilação da API emitiu `main.js` em diretório temporário. ESLint dos arquivos DEV alterados aprovado. O lint integral da API registrou 151 erros preexistentes, inclusive em Access e Context Bridge, e impede considerar `npm run build` completo aprovado. `git diff --check` passou.

O ensaio HTTP participante usa um app Nest reduzido com o mesmo controller, AccessGuard, AccessService, registry e serviço de escrita em processos diferentes. Um ensaio complementar subiu o `main.ts` real contra o clone restrito, em namespace de rede Linux sem saída, com ambiente sintético. Validou saúde, login, sessão, catálogo e pausa do PATCH após 212. A cobertura do bootstrap compreende essa configuração isolada, sem filas ativas ou credenciais de integração.

## 9. Problemas encontrados e resolvidos

- O prepare anterior exigia que o banco e ledger já fossem administrativos. A R6 transferiu a estrutura dentro da transação, usando inventário revisado, preservando a extensão sem DROP/CREATE.
- DML em card encontrou privilégios indiretos de triggers ausentes. A matriz passou a conceder as colunas e a sequência usadas. No bootstrap real, login e varredura de backup também revelaram operações em histórico de login e leituras de conexões e anexos, cobertas com ACLs nomeadas.
- A instalação de 212 sem ACLs já não basta para montar o writer. O ensaio rejeitou papel owner como writer e credenciais iguais, e confirmou pausa com configuração privada presente.
- A composição local tinha default fixo em recuperação. O host agora fornece o default registrado e preserva a configuração ausente.
- O harness de HTTP precisava de tsconfig próprio para aplicar decorators aos arquivos de fixture e ao código DEV. Os processos usam esse arquivo e ambiente sintético isolado.
- O writer de papéis de Registros invertia `users` e `access_grants`. O teste observado mostrou o writer esperando em `users` sem obter o lock em grants, e rollback íntegro quando a auditoria falhou.

## 10. Problemas ainda abertos

- **Alta:** a matriz é parcial para o runtime amplo. Jobs e plugins, operações administrativas e alguns fluxos de autenticação ainda não foram testados com o perfil restrito. O isolamento SQL evita ampliar privilégios para mascarar esses fluxos.
- **Alta:** a autorização do toggle é conferida antes da transação. Em HTTP, revoguei o papel enquanto a operação já autorizada esperava um lock. A gravação em curso concluiu. A próxima solicitação recebeu 403. Esse limite impede usar o toggle como autorização editorial.
- **Alta:** inventário de credenciais, writers externos e instâncias reais do DEV ainda depende do operador. Nenhum resultado de clone demonstra ausência de reconexões ou ACLs efetivas após corte real.
- **Média:** o poll recupera estado local, mas o host ainda precisa de prova de comportamento entre instâncias reais sob falha e reinício. Um dump lógico restaura o identificador de domínio e a revisão. Clones de restore exigem avaliação antes de substituir qualquer destino.

## 11. R02, R06 e R08

**R02 aberto.** Callbacks reais de Workspace, Vault e Coleções no AccessService não estão cobertos pela geração SQL. O snapshot segue com `live_sources_unsealed` e `plugin_inventory_partial`. O teste confirmou recusa ao registrar provider durante a avaliação e nenhuma alteração de histórico. Ainda falta um protocolo confiável que cubra a mudança posterior à última checagem até COMMIT.

**R06 aberto.** A fronteira e a transição estão implementadas. O clone estrutural e o harness HTTP comprovaram isolamento de credenciais e recusa de DML pelo PostgreSQL. No DEV real, o login legado ainda é owner e 212 está ausente. A lacuna operacional inclui completar os grants, preparar configurações e validar identidades e writers sob janela de manutenção.

**R08 aberto.** O ensaio PostgreSQL manteve os 13 locks SHARE. Reproduziu `55P03` para UPDATE não relacionado e `40P01` na ordem inversa, sem mudança da versão de sessão após rollback. O writer real de Registros passou a seguir `users` antes de `access_grants`. O teste demonstrou a ordem e a atomicidade da auditoria nessa transação. A cobertura dos outros writers e a contenção na granularidade de tabela seguem em aberto.

## 12. Gates G1–G7

| Gate | Ensaio | Operação DEV |
|---|---|---|
| G1 — Identidade e privilégios | Owner, runtime, writer e leitor distintos. Validação de ACLs e recusa de elevação. | Bloqueado. Identidades segregadas e ACLs pendentes. |
| G2 — Migration 212 | Instalada com ledger e checksum válidos, incluindo prova no migrador. | Bloqueado. Ausente no DEV consultado. |
| G3 — Exclusividade de escrita | UPSERT legado recusado. Restrição do pool privado exercitada. | Bloqueado. Credencial confinada, writers externos e drenagem pendentes. |
| G4 — Segurança da aplicação | Bootstrap real isolado, Guard, auth, permissões e fluxos selecionados do clone. Revogação posterior à checagem tem limite demonstrado. | Parcial. Perfis completos e fluxos fora da matriz pendentes. |
| G5 — Consistência local | CAS, rollback, falhas locais, COMMIT incerto e polling exercitados. | Parcial. Ausência de evidência operacional. |
| G6 — Rollback | Contingência mantém DML protegido após reversão de código. Restore isolado reaplica ACLs. | Bloqueado. Fronteira ainda não aplicada. |
| G7 — Multi-instância | Dois processos HTTP reais, sessões SQL distintas, divergência e reconciliação. | Parcial. Instâncias e notificação distribuída não homologadas. |

## 13. Rollback e contingência

Antes do COMMIT, uma falha SQL aborta a transação de corte. Se houver confirmação incerta, o operador consulta novamente a estrutura e o ledger antes de decidir. Depois do COMMIT, suspender o toggle, drenar o pool privado e executar `r6-contingency.sql`. A reversão de binário preserva ownership administrativo e ACLs. O SQL do writer antigo continua recebendo recusa. O restore de recuperação vai para banco isolado. O operador verifica o destino, reaplica os grants pelo script restrito ao restore e confirma a barreira antes de apontar a aplicação para a recuperação.

## 14. Pendências operacionais

A infraestrutura precisa fornecer os logins reais de owner/migrador, writer e leitor, sem compartilhar credenciais com processos genéricos. Também requer aprovação da janela de manutenção, inventário atualizado de objetos e dependências, backup verificado e barreira contra novas sessões. A CLI de migration e a API precisam de ambientes de invocação separados na operação. O DEV atual continuou sem mudanças de privilégio, migration ou restart.

## 15. Próximas ações

1. Completar a matriz com os fluxos de serviço faltantes em clone. Essa validação técnica é descartável.
2. Revisar no clone a composição de credencial privada e a estratégia para writers externos. A configuração das credenciais reais depende do operador.
3. Submeter plano de transição, hash revisto e backup aprovado ao operador. A execução no DEV requer autorização operacional explícita.
4. Após a autorização, validar ACLs, identidades e contingência do banco antes de liberar, por mudança revisada do host, a montagem do writer.

## 16. Estado final

**DEV INTEGRADO, COM BLOQUEIOS DE INFRAESTRUTURA.** O código do endpoint e o serviço participante passaram pelo ensaio HTTP. Os scripts passaram no clone estrutural. A matriz do runtime completo, a configuração operacional do host e as credenciais efetivas ainda impedem o cutover. Discovery Review segue indisponível.

## 17. Inventário de mudanças

- DEV `apps/api/src/main.ts`, `plugins/plugin-settings.ts` e `plugins/plugin-settings-boundary.ts`. Controller, composição, verificador de montagem e lifecycle.
- DEV `apps/api/src/execution/editorial-authorization-generation.ts` e `editorial-plugin-settings-{writer,orchestration,recovery}.ts`. Cópias locais byte a byte para o build com `rootDir: src`. A fonte continua no Core. O teste verifica paridade. Nenhum mapping ou lock foi atualizado.
- Core `src/execution/editorial-authorization-generation.ts` e `editorial-plugin-settings-recovery.ts`. Defaults do host e preservação de chamadas anteriores.
- DEV `plugins/records/records.service.ts` e Core `discovery-review-repository.spec.ts`. Correção de ordem e regressão PostgreSQL.
- DEV `experimental/plugin-settings-http.postgres.spec.ts`, `fixtures/plugin-settings-http.ts` e `tsconfig.plugin-settings.json`. Ensaio Nest em processos independentes. As fixtures históricas da R5A foram preservadas para regressão.
- `tools/orbit/dev-db-cutover/`. Includes de identidade, operador, drenagem, baseline, preparação protegida e ACL. Entradas `r6-ownership-plan.sql`, `r6-preflight.sql`, `r6-prepare.sql`, `r6-validate.sql`, `r6-contingency.sql` e `r6-restore-acl.sql`, assertions, fingerprint, matriz e harness `r6-clone.postgres.spec.ts`. As entradas R5C-A continuam cobertas pela sua suíte.
