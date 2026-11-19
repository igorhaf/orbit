# 07D-R — Reconciliação após continuidade em chat anônimo

**Resultado: RECONCILIADO COM BLOQUEIOS.** A revisão editorial continua sem exposição HTTP ou execução em produto. A reconciliação corrigiu regressões localizadas de RBAC; a autorização de providers, a publicação compartilhada e a governança ainda têm pré-requisitos.

## Estado do repositório e baseline

- `main`, HEAD `d9307b8e6a54316f802acbd7bcb96baa26116f16` antes e depois. Inventário inicial com `git status --porcelain=v1 -uall`: 137 modificados sem stage e 356 não rastreados. As etapas 01–07D já estavam na árvore de trabalho. Não foram produzidos commits, mudanças de índice, tags ou alterações em bancos operacionais.
- Usei `/tmp/orbit07c-audit/before.json` e `inventory-final.json` como evidência de baseline para os arquivos que a própria 07C não modificou. Dos 3.407 arquivos nessa interseção, 3.403 continuam com o SHA-256 anterior; as quatro diferenças são os `access.ts`, já modificados na entrada pela C2/C4. A distribuição final da 07C foi conferida separadamente pelos 230 hashes de cada lock.
- Comparação do status inicial com o final: os quatro `access.ts` já constavam como modificados; as novas entradas da reconciliação são este relatório e `tools/orbit/discovery-editorial-access.test.mjs`. Sem remoções.
- `preflight --format json` somente leitura: `BLOCK` (4 PASS, 5 WARN, 46 NOT_VERIFIED, 4 BLOCK). Os quatro bloqueios emitidos foram de inspeção compartilhada. A 07C também era `BLOCK` (18 naquele snapshot); o erro atual interrompe essa parte da inspeção, portanto a diferença de contagem não indica que os achados históricos foram resolvidos.

## Etapas confirmadas e matriz de preservação

| Contrato ou etapa | Evidência e limite |
|---|---|
| 01 — Core e plugins | Core fonte publicada `1.12.4`, Core API `1.0.0`, Plugin API `1`; sem mudança de SDK, registry ou dos 230 arquivos mapeados anteriormente. Divergência nova de manifesto abaixo. |
| 02–03B — cards, filas, worktrees | Arquivos de versão de card, coordenação e checkout preservados na comparação disponível; sem novo writer, mudança de fila ou operação em worktree. Não reexecutei a matriz histórica. |
| 04–05 — manifesto, orçamento e compilador | Projeções anteriores conferidas por hash; nenhum formato, seleção, política de sandbox ou manifesto alterado pela 07D identificada. |
| 06–06C — Bridge/MCP/Codex | Projeções anteriores conferidas; nenhuma ferramenta de escrita, autorização nova ou execução real do Codex. |
| 07A–07B — lexical | Projeções anteriores conferidas; sem novo índice, BM25, memória automática ou inclusão editorial no Bridge. |
| 07C — Journal | Captura continua `proposed`, vinculada a run/turno/manifesto; migration 209 intacta; testes PG isolados passaram. Review usa a descoberta como origem e não a reescreve. |
| 07D-A — contratos | `discovery-review.ts`: `proposed → in_review → needs_information / approved / rejected`; `needs_information → in_review / rejected`, `approved → approval_withdrawn`; `approval_withdrawn` e `rejected` são terminais. CAS revisiona a decisão; compatibilidade e elegibilidade são estados distintos. Testes da máquina confirmam o contrato. |
| 07D-B — persistência | `discovery-review-repository.ts` e 210: histórico ordenado por revisão, guarda SQL para estados/transições e conteúdo, CAS e idempotência por descoberta. Nenhuma segunda tabela de estado atual. |
| 07D-C/C2 — aplicação e acesso | `discovery-review-application.ts` e `discovery-review-access-host.ts`: `current/history/decide` internos, com identidade do host, autorização transacional e separação de proponente/aprovador. Sem registro no bootstrap dos quatro runtimes. |
| 07D-C3 — política e evidência | `discovery-review-sources.ts`: origens allowlisted, hash, escopo exato, vigência, histórico recuperável e revalidação. Proveniência em `policy.editorialProvenance`; histórico sem procedência não comprova aprovação aplicável. Nenhuma autoridade de produção conectada. |
| 07D-C4 — escopo/concorrência | Negativa conservadora para callbacks não homologados; locks observados em código e reexecutados no PostgreSQL isolado. |
| 07D-C5A — candidatas | `discovery-editorial-policy-store.ts` e 211: candidata versionada, `current()` retorna `null`; validação de conteúdo e revogação são eventos. `pinCandidate()` protege consulta; `pinActive()`, `approve()` e `activate()` continuam indisponíveis. |

## SQL, concorrência e governança

| Migration | Presença e garantias verificadas | SHA-256 inicial, prefixo |
|---|---|---|
| `209_discovery_journal.sql` | Canônica e projetada nos quatro runtimes. Bindings/FKs, validação canônica, constraints diferidas para completude, idempotência e imutabilidade do Journal. | `0bcafa1e52cb` |
| `210_discovery_review.sql` | Só na fonte, depois da 209; FK restritiva à descoberta, revisão e chave únicas por descoberta. Advisory lock comum entre repository/trigger, hash da decisão e guarda de estado anterior; `UPDATE/DELETE/TRUNCATE` rejeitados. | `04a41ad39ec5` |
| `211_discovery_editorial_policies.sql` | Só na fonte, depois da 210; FK à descoberta, id/versão únicos, referência completa verificada, escopo e digest canônicos, somente `unavailable`; eventos monotônicos e imutáveis com FK à versão. | `0fe06966b57b` |

Sem colisão numérica nessa faixa. A cadeia foi aplicada em ordem sobre fixtures mínimas no PG16 descartável. Não executei a cadeia histórica integral dos produtos. Triggers cobrem DML comum, não dono/superusuário que possa desabilitá-los. A retenção depende de política administrativa explícita; não há limpeza automática. Na 210, o repository reautoriza tentativas e reaproveita a decisão original para a mesma chave e conteúdo; uma chave com conteúdo diferente conflita. Estado histórico e compatibilidade passada não equivalem a elegibilidade atual.

No review, `BEGIN READ COMMITTED` → advisory lock por descoberta → autorização com `LOCK TABLE … IN SHARE MODE`, nesta ordem: `users`, `access_roles`, `access_grants`, `access_groups`, `access_group_members`, `access_user_exceptions`, `access_permission_settings`, `boards`, `board_members`, `lists`, `cards`, `ai_projects`, `vault_items`. Avaliação, reautorização, inserção e revalidação ocorrem na mesma conexão antes do `COMMIT`. Escritas comuns de revogação de sessão/grant, mudanças de membros e transferências que tocam essas tabelas aguardam mesmo entre projetos diferentes. O teste observou `55P03` com timeout de 100 ms, `40P01` com ordem adversa e rollback sem revogação parcial. Não há medição de carga real ou garantia de latência/ausência de deadlock.

Na 211, o pin usa `FOR SHARE` na versão e writers de evento usam `FOR UPDATE` no mesmo registro, inclusive no trigger de `INSERT`. Revogação concorrente aguardou o término do pin; a versão continuou recuperável e um novo pin foi recusado. O hash verifica conteúdo/identidade de política; proveniência de cadastro é metadado imutável separado e atribuição não prova identidade institucional. Fonte externa não adquire atomicidade por revalidação em JavaScript.

## RBAC e providers

O diff prévio dos quatro `AccessService` adicionava sete permissões editoriais ao catálogo, excluía essas permissões dos defaults de usuário/administradores e criava leitura transacional de roles, grupos, exceções e permissões desativadas. A lógica de sessão, act-as, membership, rotas, boards, workspaces e recursos não editoriais permaneceu a de cada runtime. `hasScoped` continua recusando a família editorial. Auditoria editorial é inserida na transação do host; não se declara trilha de negativas fora dela. O catálogo de permissões pode ser consultado pela superfície administrativa existente; ele não expõe operações do Review.

| Runtime | Contexto real de simulação usado na auditoria | Escopo editorial |
|---|---|---|
| DEV | `currentSimulatedProfile(user)` | Só pessoal nativo e projeto próprio sem callbacks; o adapter não substitui a autorização normal de produto. |
| PROD | `this.simulation(user)` / contexto de requisição | Mesmo limite; conserva a variante local de login e simulação. |
| Safdoulas | `this.simulation(user)` / contexto com identidade demonstrativa | Mesmo limite; perfil administrativo simulado recebe catálogo na sua rotina normal, mas isso não autoriza review. |
| Suindá | `this.currentProfileSimulation()?.actor===user` | Mesmo limite; também recusa providers `scoped` e `request` próprios. |

Workspaces e seus recursos usam membership/compartilhamento; ExtensionRecords usa grants/registro e plugin ativo; RecordCards usa vínculos de registros mais callbacks de acesso/lista/escopo/membros; Collections adiciona política de board e Vault, disponibilidade/registro de item. Suindá acrescenta perfil de workspace e autorização de unidade/ancestralidade, incluindo callbacks por request. `editorialScopeProvidersPresent()` cobre as 11 categorias comuns, mais duas do Suindá. Um callback registrado pode recusar o adapter mesmo para um board aparentemente nativo. O código não trata `true` de um callback nem uma segunda checagem como fence do PluginRegistry; registro/estado em memória pode mudar depois da última autorização e antes do commit.

## Fontes e projeções

- `@orbit/core-source` **1.12.4 efetiva, 230 mappings com locks verificados por arquivo** nos quatro runtimes. Todos os 230 arquivos correspondem à fonte e ao hash registrado. O `orbit.workspace.json` declara **231**; `packages/orbit-core/package.json` ainda declara **230**. A entrada exclusiva é `src/access/editorial-permissions.ts` → `apps/api/src/access/editorial-permissions.ts`. O conteúdo existe na fonte e em quatro cópias idênticas fora dos locks; `access.ts` continua local a cada produto, sem mapping.
- Apenas canônicos: `discovery-review.ts` e spec, `discovery-review-repository.ts` e spec, `discovery-review-application.ts`, `discovery-review-access-host.ts`, `discovery-review-sources.ts` e spec, `discovery-editorial-policy-store.ts` e migrations 210/211. Sua ausência nos runtimes é staging deliberado. 209 e os seis mappings do Journal integram a distribuição 1.12.4.
- `shared check` falhou com `Package projection manifest differs from workspace`. `shared reconcile --packages @orbit/core-source --files packages/orbit-core/src/access/editorial-permissions.ts`, em modo plano, devolveu `invalid-package`, zero paths/release e `written:false`. Não houve edição manual de manifestos de publicação, locks, versão, projeções ou UI. As nove variantes de UI descritas na 07C não foram sincronizadas.

## Findings

| ID | Arquivo / origem | Esperado → observado e evidência | Severidade / custo, correção e estado |
|---|---|---|---|
| R01 | Quatro `access.ts`, C2 | Entrada editorial recusa simulação → `has` usava a avaliação do perfil e podia reconhecer a permissão; Safdoulas inclui todo o catálogo no perfil admin simulado. A fachada já recusava simulação, sem exposição operacional observada. | **P0** latente, corrigido localmente: `has` recusa contexto simulado para a família editorial antes de avaliar grants. Baixo custo; teste nos quatro runtimes. |
| R02 | `discovery-review-access-host.ts` e callbacks/PluginRegistry, C2/C4 | Segurança até o commit → sem fence para registro e política de providers mutáveis após a última checagem. O teste de registro durante avaliação prova recusa na reautorização, não cobre o intervalo final. | **P0** condicional e contido: manter caminho fechado; exige protocolo compartilhado de geração/lease ou estado transacional com participação dos writers. Alto risco se habilitado sem prova. |
| R03 | `access.ts` em PROD/Safdoulas/Suindá, C2 | Helper existe em cada variante → `TS2304` para `currentSimulatedProfile` nas três APIs. | **P1** corrigido: usar o helper local de cada produto. Baixo custo; `tsc` e teste de `editorialPermissions`. |
| R04 | Os mesmos três `access.ts`, C2 | ROOT com grant explícito valida uma permissão editorial, sem grant recebe negativa → `explicitOnly` era ignorado e o caminho retornava `['*']`, que não satisfazia a checagem de concessão específica. | **P1** corrigido: limitar o atalho ao modo normal. Baixo custo; teste confirma grant, deny e wildcard não editorial. |
| R05 | `orbit.workspace.json` / `packages/orbit-core/package.json`, C2 | Os dois manifests e os locks concordam → 231/230/230; preflight e plano oficial bloqueiam. | **P2** aberto: release selecionada dedicada ao catálogo após alinhamento homologado dos manifests; revisar precondições e aceitar somente catálogo + metadados/locks previstos. Baixo a médio custo, sem publicação global. |
| R06 | 210/211 e repositories, B/C5A | Separação de papéis de banco demonstrada antes de produção → integridade estrutural testada, mas INSERT direto sob papel autorizado pelo banco não autentica reviewer nem valida autoridade institucional. Sem conexão de produção. | **P2** aberto: revisar grants SQL/ownership, impor caminho de escrita autorizado e comprovar teste com papéis restritos antes de integrar. Custo médio, risco de integridade se a migração for exposta. |
| R07 | DEV `access.spec.ts`, anterior à 07D | Teste espera identidade ROOT em `sessionUser`/`me.id` → recebeu a identidade demonstrativa; mesma asserção e valores no HEAD isolado. | **P3** preexistente: alinhar contrato e teste de simulação em mudança própria. Sem mudança de autenticação nesta auditoria. |
| R08 | `discovery-review-access-host.ts`, C2/C4 | Protocolo operacional com contenção limitada → bloqueio transversal e deadlock reproduzidos; resultado não homologado. | **P3** conhecido e bloqueante: inventário de writers, estratégia única de ordem/fence, revalidação, timeout e orçamento de contenção; teste adversarial multiconexão. Médio/alto custo. |
| R09 | `discovery-review-sources.ts` / `discovery-editorial-policy-store.ts`, C3/C5A | Ativação e elegibilidade precisam de autoridade comprovada → fonte C5A retorna ausência; avaliação evidencial autorizada e aprovação institucional não existem. | **P3** decisão de governança, não defeito da candidata. Aprovação, ativação, revogação autorizada e origem evidencial precisam de decisão institucional e implementação separada. |

## Validação e handoff

- Execução inicial selecionada: `node --import ./dev/app/node_modules/tsx/dist/loader.mjs --test` com `TSX_TSCONFIG_PATH=dev/app/apps/api/tsconfig.json`, sobre os três specs canônicos `discovery-review{,-sources,-repository}.spec.ts` e `dev/app/apps/api/src/access/access.spec.ts`. **100 aprovados, 1 falha preexistente**: 77 da 07D e 23 de Access DEV aprovados. `git archive HEAD` para diretório temporário, com o mesmo teste filtrado, reproduziu a falha; comparação com o relatório C2 confirma o mesmo desvio.
- Após R01/R03/R04: `node --test tools/orbit/discovery-editorial-access.test.mjs` **4/4** e reexecução do spec canônico `discovery-review-repository.spec.ts` **50/50** (já contado no total de 77). A regressão local usa objetos `AccessService` dos quatro produtos com DB fixture e o mecanismo de simulação de cada runtime; o repository usa PG16 descartável por socket Unix.
- `node --test tools/orbit/discovery-journal.postgres.test.mjs` **13/13**, comprovando diretório, dono e socket próprios antes de DDL. Total sem duplicar reexecuções: **117 aprovados, 1 falha preexistente, 0 ignorados**. `tsc --noEmit --incremental false` nas APIs de DEV/PROD/Safdoulas/Suindá: **4/4 limpas** após a correção; `git diff --check` dos caminhos alterados rastreados passou. Sem suítes globais, browser, bancos de produto, deploy ou restart.
- Guardas preservadas: sem novos endpoints, fila, broker, serviço externo, publicação, aprovação automática, alteração de cards por agentes, alteração em worktrees operacionais, relaxamento de sandbox, merge automático ou Codex/MCP real. A 07D-R não altera os três SQL nem ativa migrations operacionalmente.
- Próxima implementação recomendada: primeiro release selecionada do catálogo editorial com precondições do mecanismo oficial (R05); nenhum include de 210/211 nesse release. Em seguida, etapa isolada para papéis SQL, protocolo de writers e fence dos providers, com matriz de concorrência antes de qualquer promoção. **Modelo: Sol, esforço Médio**, separando esses dois trabalhos de uma eventual etapa de governança.
- Antes de tratar uma candidata como ativa: definir quem cadastra, valida, aprova, ativa e revoga; como provar identidade, segregação e vigência no escopo; e quem pode atestar presença e compatibilidade da evidência. Validar reconsulta histórica e revogação concorrente em fonte autorizada. O handoff parte do host e do store atuais, sem ativar C5B/C6, HTTP, UI ou publicação neste marco.
