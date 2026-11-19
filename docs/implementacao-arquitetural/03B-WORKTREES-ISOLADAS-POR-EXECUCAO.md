# Implementação 03B — Worktrees isoladas por execução

Início: 2026-11-13. Fechamento da continuação: 2026-11-14, America/Recife. Repositório: `/home/meada/projetos/orbit`.

**CONCLUÍDA no escopo de código, distribuição em arquivos e testes isolados.** Core final **1.6.2**. Não houve migração de bancos reais, ativação, reinício ou implantação. O isolamento continua opt-in e a serialização de worktrees relacionadas continua conservadora. Sucesso de execução não aprova integração.

## 1. Resumo executivo

O Core passou a preparar e identificar uma worktree Git detached por run, vinculando as duas filas existentes a um commit-base completo, card/revisão, projeto/workspace, diretórios físicos, metadados Git e proprietário. O host captura a base durante a preparação do enqueue, revalida a origem antes de executar e fornece aos executores apenas o checkout aprovado. Falhas não fazem fallback para a origem.

Árvores originais com alterações tracked, staged, untracked, ignored ou flags que escondem mudanças são bloqueadas; não se faz stash, cópia de árvore suja, commit temporário ou descarte. Resultados ficam preservados, com diffs, hashes, identidade e `integration: not_integrated`. Perguntas podem retomar o mesmo checkout mediante identidade, evidência e CAS; outros replays não executam novamente.

As classes reais `CardExecutionService` e `PromptSessionsService` foram exercitadas com DB/executores simulados e filesystem/Git temporários. O gerenciador foi testado com PostgreSQL16 efêmero, Git real de fixture e SIGKILL de worker sintético. O provider real foi testado exclusivamente contra um executável fake, com HOME/quota isolados. **144 testes distintos aprovados, zero falhos ou ignorados nas suítes finais; quatro APIs passaram TypeScript.** Reexecuções de testes não aumentam essa contagem.

Não foi liberado paralelismo entre worktrees do mesmo common-dir. Não há Integration Gate, merge, rebase, cherry-pick, RAG novo, Context Bridge, Consistency Engine ou descarte automático. O sandbox solicitado ao CLI foi conferido em argumentos de um CLI fake; contenção efetiva do Codex real não foi homologada, conforme a proibição de chamá-lo. Worktree não é sandbox universal contra plugins ou escritores externos.

## 2. Base documental


Foram lidos integralmente os relatórios00–20 de `docs/sondagem-arquitetural/`, as implementações01/02/03A, incluindo continuação02§18 e a ressalva operacional03A§16. Nenhum documento solicitado estava ausente. A leitura documental foi uma frente independente; contratos e resultados finais foram conferidos pelo integrador no código atual, pois os relatórios registram estados históricos diferentes.

| Referência | Consequência para03B |
| --- | --- |
| 00 | Orbit possui duas trilhas de execução; a flag multiagent não prova supervisor ou autoria por agente-filho. |
| 01 | Monorepo único não elimina cópias de runtime; preservar dados e configuração por produto. |
| 02 | Reaproveitar cards, plugins, filas, logs e verificadores; inventário é histórico, não homologação. |
| 03 | Preservar lifecycle, ações e sessão existentes, sem terceira fila. |
| 04 | Migrations centralizadas/aditivas; relações e cascades existentes não equivalem a retenção eterna de evidências. |
| 05 | Codex/embeddings são adaptadores; contexto, projeto e permissões pertencem ao host. |
| 06 | Separar decisões de produto de fatos verificáveis; não prometer garantia não testada. |
| 07 | Preservar variantes de produto e distinguir documentação de estado operacional. |
| 08 | Não rediscutir intenção já autorizada; ativação/efeitos externos exigem escopo próprio. |
| 09 | Usar índice de contratos como ponto de navegação, conferindo os arquivos atuais. |
| 10 | Vincular run, card revision e base Git, sem equiparar sessão/prompt a versão completa do contexto. |
| 11 | Tratar edição queued/running, concorrência e rollback sem confundir sucesso com integração. |
| 12 | JSONL/progresso/pergunta não são Context Bridge nem autorização de operações. |
| 13 | Hash de recurso e busca lexical/vetorial não estabelecem validade semântica. |
| 14 | Check de escopo e lock não são reconciliador global. |
| 15 | Requisito vigente, contexto e estado observado permanecem dimensões diferentes. |
| 16 | Reaproveitar ProjectRegistry, ContextBuilder, RunRepository, verificações e evidências. |
| 17 | Confirma assimetria histórica das filas, ausência de commit-base e limites de atribuição. |
| 18 | C1/C3 reproduziram perda cruzada por snapshot/rollback; isolamento precisa impedir mistura de arquivos. |
| 19 | Fonte canônica/projeção/lock devem ser reconciliados oficialmente; testes CLI só com HOME/binário sintéticos. |
| 20 | Identidade/autorização/coordenação são core; registry não é loader/sandbox. Suindá possui consumidor vetorial concreto, corrigindo o alcance de buscas anteriores. |
| Implementação01 | Preflight estático somente leitura, preservação de drift e publicação com precondições. |
| Implementação02 | Revisão base monotônica, snapshots imutáveis, captura transacional, idempotência, CAS e freshness devem permanecer. Continuação§18 corrigiu a aspa do painel docente Suindá; não tratar como falha atual. |
| Implementação03A | Reutilizar lease físico, common-dir, supervisão, ownership e quarentena; não repetir teste herdado de quota real. |

Também orientam o trabalho: `AGENTS.md`, `docs/acceleration/README.md`, `docs/product-experience.md`, `orbit.workspace.json` e skill `orbit-environment`. A tarefa vem diretamente do ambiente de desenvolvimento; não existe cartão ativo ou `context.write_scope` fornecido para esta sessão. Isso não amplia autorização operacional.

## 3. Estado inicial

Branch `main`, HEAD `d9307b8e6a54316f802acbd7bcb96baa26116f16`, preservados. No início da 03B: Core1.5.4,181 mappings; UI1.1.3,74 mappings. No início da continuação: Core1.6.1 já distribuído, gerenciador e integrações presentes, relatório documental provisório e teste das duas filas ainda sem resultado final. Não se reiniciou a implementação.

Já existiam alterações não commitadas das etapas01/02/03A, incluindo helper/migration157, coordinator/supervisor/migration158, preflight/reconcile, revisões em main/card-dialog, testes, relatórios18–20 e ZIP. A aspa do painel docente Suindá já estava corrigida. Nove drifts UI eram anteriores: limits/navigation nos quatro runtimes e access-shell Safdoulas.

Preflight somente leitura inicial e da continuação: `PASS4/WARN5/NOT_VERIFIED46/BLOCK18`. Os bloqueios incluem as variantes UI, sem nova divergência core. O preflight não consulta bancos nem homologa implantação. O checker textual de tema Suindá também permanece uma pendência anterior; não foi afrouxado.

Foi mantido inventário de hashes de161 arquivos locais e status Git em `/tmp/orbit03b-audit-jnvk5i5v/`. Esse snapshot já incluía o esqueleto da159 escrito pela frente03B: não é uma reconstrução de um commit limpo. A comparação final confirmou ausência de exclusões e preservação dos arquivos fora do escopo atribuído; os deltas comuns esperados e a159 foram atribuídos explicitamente. As entradas UI de lock foram preservadas pelo mecanismo selecionado.

Migrations157/158 constavam somente de testes anteriores descartáveis. O estado dos quatro bancos reais não foi consultado; continua **NÃO VERIFICADO**, sem alegação de estarem aplicadas ou pendentes baseada em leitura operacional atual.

## 4. Arquitetura anterior

A 03A já oferecia `withWorkspaceWriteLease`, `currentWorkspaceWriteLease` e `assertWorkspaceWriteCoverage`, com identidade física, locks Linux de diretórios, advisory locks PG de sessão, ownership persistente e supervisor Python Linux. As duas filas tinham uma fronteira de escrita comum. O snapshot de escopo sob lease recusa rollback sem autoria, preservando arquivos.

A unidade conservadora inclui checkout e Git common-dir; worktrees ligadas já se serializavam. O guard não criava checkout por run, não fixava commit-base e não atribuía diferenças a worktrees exclusivas. APIs Git independentes, editores e ferramentas externas permaneciam fora da autoridade global. Essas limitações não foram apagadas do histórico03A.

Na 03B o coordenador, seu supervisor e migration158 **não foram modificados**. A nova camada compõe leases existentes em duas fases, sem afrouxar o common-dir ou criar outra fila.

## 5. Decisões arquiteturais

1. **Worktree detached por run, sem branch de execução:** evita criar/refazer branches reais e fornece commit-base verificável, sem integração automática.
2. **Pin no enqueue:** captura anterior à composição final do prompt/contexto e revalidação posterior. Worker não escolhe um HEAD novo para um prompt antigo.
3. **Origem limpa como precondição:** qualquer trabalho fora do commit e recursos ignored exigem preparação explícita. Não há snapshot indiscriminado ou provisioning nesta etapa.
4. **Storage do host:** diretório existente, absoluto, físico, privado0700, mesmo UID, fora da origem; caminho de run é derivado de fila+UUID, nunca de texto do agente.
5. **Serialização preservada:** criar/registrar worktree altera common-dir. As duas fases adquirem os recursos conservadores da03A, sequencialmente, sem upgrade/nesting de locks. Não remover common-dir da chave.
6. **Ownership e evidência separados do status do job:** registry retido, manifestos privados, inodes e hashes. Finalização do callback não prova que filhos drenaram; preservação/awaiting_answer definitivos só depois do retorno do lease.
7. **Q&A com CAS:** continuidade explícita, mesmo run/revisão/base, fingerprint preservado e transição exclusiva. Novo run não herda sessão de outra worktree.
8. **Efeitos externos falham fechados:** somente action built-in filesystem.read no modo isolado; checks configurados e Delivery exigem autoridade/provisioning ainda ausentes e são bloqueados. Nenhum plugin é desativado para passar testes.
9. **Sandbox do adaptador:** modo isolado deixa de usar bypass, solicita workspace-write ou read-only, sem escalada de aprovação/MCP/rede e com ambiente restrito. É solicitação ao provider, não prova de contenção SO.
10. **Sem recuperação destrutiva:** não existem remoção, reaproveitamento por idade/PID, merge ou aprovação de integração automáticos.

## 6. Contratos introduzidos

Fonte pública determinística: `packages/orbit-core/src/execution/isolated-checkout.ts`.

| Contrato | Conteúdo e responsabilidade |
| --- | --- |
| `IsolatedCheckoutRequest` | version1, mode isolated, projectId/workspaceId, sourceRoot/repositoryRoot/projectSubdirectory/commonDir, reference/branch/baseCommit, inodes de source/repository/common e capturedAt. Persistido com o run. |
| `IsolatedCheckoutIdentity` | fila existente, runId/cardId/cardRevision/projectId/workspaceId, request, **authorizedProjectRoot independente da request**, signal, continuation e onState. Autorização do usuário é obrigação do host antes da chamada. |
| `captureIsolationRequest(project,{reference?})` | Somente leitura Git/FS; exige opt-in e precondições; captura commit completo e estado verificável antes de preparar a execução. Não cria worktree. |
| `validateIsolationRequest(project,request)` | Recalcula estado e compara commit, branch/ref, raízes e inodes; mudanças pedem reconciliação, sem recaptura silenciosa. |
| `withIsolatedCheckout(db,identity,callback)` | Registra/prepara checkout, adquire leases, revalida identidade, executa callback, captura evidências e preserva. Não retorna sucesso se proteção/drenagem falhar. |
| `IsolatedCheckout` | root do projeto na worktree, worktreeRoot completa, runDirectory, owner, baseCommit, id e `deferForAnswer()`. |
| `IsolatedCheckoutEvidence` | Base/HEAD, status Git, alterações, hashes de untracked, artifact privado, fingerprint, executorStatus, integração e limite de atribuição. |
| `IsolatedCheckoutError` | Falha explícita: disabled/blocked, base/identity changed ou run already registered, entre os diagnósticos. Sem fallback. |

`isolated-execution-policy.ts` fornece ALS `withIsolatedExecution/currentIsolatedExecution`, verificação de root e workingDirectory, política de argumentos do Codex, ambiente restrito e bloqueio de checks. O contexto é transitório e do host; não vem do prompt nem de uma declaração do plugin. Não é um token criptográfico contra código não cooperante do mesmo processo.

A identidade durável do registry inclui fila/run/card/revisão/projeto/workspace, request, owner, caminhos derivados, identidades físicas de storage/run/tree/root/gitdir e hash do ponteiro `.git`. O manager usa comparação estável de JSON, pois JSONB não preserva ordem de chaves.

Hosts integrados exigem workspace organizacional identificado no quadro e autorização atual do projeto por owner. O helper Core aceita workspace opcional para consumidores determinísticos/legados; isso não dispensa o host de verificar RBAC e escopo.

## 7. Implementação arquivo por arquivo

Os caminhos abaixo são relativos à raiz. Projeções citadas em§17 são cópias geradas, não fontes independentes.

| Arquivo | Antes → alteração; consumidores, compatibilidade e risco |
| --- | --- |
| `packages/orbit-core/src/execution/isolated-checkout.ts` | Novo manager/contratos/lifecycle/evidência. Consumido pelos dois workers. Reusa coordinator03A; opt-in deixa legado intacto. Risco de indisponibilidade conservadora/quarentena; não é sandbox universal. |
| `packages/orbit-core/src/execution/isolated-execution-policy.ts` | Novo contexto do host/guards de diretório/flags/env. Consumido por adapters, registry, checks, Delivery e workers. Sem contexto mantém legado. Sandbox real depende do provider homologado. |
| `packages/orbit-core/src/execution/isolated-execution-policy.spec.ts` | Novo teste de limites: actions, checks, Delivery e diretórios recusados antes de efeitos; flags/env. Só fixture local, sem serviço/provider real. |
| `packages/orbit-core/sql/migrations/159_isolated_checkouts.sql` | Nova persistência aditiva; não modifica157/158. Cria ledger e campos opcionais IA. Consumidores exigem migration na ativação futura. |
| `packages/orbit-core/src/execution/execution.service.ts` | Antes executava só com lease na origem; agora captura/persiste request opcional no enqueue, reautoriza projeto/workspace/revisão, remapeia ContextBuilder e executa no checkout aprovado. Mantém quota/freshness/outputs/eventos. Modo isolado sem provisioning bloqueia checks e actions externas. |
| `packages/orbit-core/src/execution/run-repository.ts` | Input do run recebe checkout_request opcional; enqueue persiste junto ao snapshot. Worker fences/revision/quota/status antigos mantidos. Não cria uma nova revisão nem nova fila. |
| `packages/orbit-core/src/execution/codex-executor.ts` | Antes bypass local; sob contexto isolado valida root/workingDirectory/cobertura antes de HOME/spawn, restringe env e pede sandbox compatível com ação/permissão. Mantém supervisor. analyze/review sem escrita usam read-only. |
| `packages/orbit-core/src/execution/registries.ts` | Registry/schema/capabilities/RBAC preservados; sob isolamento só built-in filesystem.read recebe autoridade. Outras actions recusadas antes de executar. Não confiar em um plugin declarar a si mesmo seguro. |
| `packages/orbit-core/src/execution/project-checks.ts` | Checks continuam obrigatórios no legado. Se houver contexto isolado e checks não vazios, recusa antes de spawn; host já bloqueia preparação desse run. Sem provisioning não se finge que checks passaram. |
| `packages/orbit-core/src/delivery/executors.ts` | Adiciona recusa explícita de Delivery local/remoto sob isolamento antes de ler credenciais/abrir conexão. Fora desse contexto, comportamento03A preservado. |
| `{dev,prod,safdoulas,suinda}/app/apps/api/src/plugins/ai/prompt-sessions.ts` | Alterações localizadas por runtime: allowlisted workspace_mode/request_key, pin/enqueue, FIFO+manager, reautorização pós-espera, diretório do provider, sessão/Q&A/CAS, diagnóstico e tratamento de cancelamento. Diferenças dos produtos preservadas. |
| `{dev,prod,safdoulas,suinda}/app/apps/api/src/plugins/ai/codex-provider.ts` | Consome contexto aprovado, bloqueia fallback de complete para process.cwd sob isolamento, pede sandbox/env restritos e mantém supervisor. Review Git isolado recebe env sanitizado. Legado mantém política anterior. |
| `{dev,prod,safdoulas,suinda}/app/apps/api/src/orbit-architecture.ts` | Campos opcionais da API de prompt e instrução persistente de worktrees sincronizados. Consumido pelo Codex IDE/cartões como developerInstructions. Não muda tema/UI. |
| `tools/orbit/isolated-checkout.test.mjs` | Novo harness Git/PG16 sintético e15 subcenários, incluindo crash, cancelamento, Q&A, índices e ponteiro Git. Nenhum bootstrap de app ou quota real. |
| `tools/orbit/isolated-workers.test.mjs` | Novo harness com duas classes reais, DB/quotas/executores fake, Git/FS reais descartáveis. Verifica revisão antiga, sessões/Q&A/idempotência e origem. Teardown espera workers; não remove recurso ativo. |
| `tools/orbit/isolated-provider.test.mjs` | Novo teste do provider real com binário Node fake/HOME próprio, flags/env e recusa de diretório original. Não executa Codex real nem prepara HOME real. |
| `packages/orbit-core/package.json`, `orbit.workspace.json` | Quatro mappings novos e releases1.6.0/1.6.1/1.6.2 atribuídas. Versão de pacote fonte não substitui API version do core ou contrato de plugin. |
| `{dev,prod,safdoulas,suinda}/app/orbit.shared-lock.json` | Atualizados oficialmente só para core; UI anterior preservada. |
| `AGENTS.md`, `docs/product-experience.md` | Regra persistente de identidade/opt-in/evidência/limites sincronizada com prompt dos quatro runtimes. |
| `docs/implementacao-arquitetural/03B-WORKTREES-ISOLADAS-POR-EXECUCAO.md` | Este relatório final substitui o rascunho, mantendo base histórica e resultados verificáveis. |

Não houve alteração de `packages/orbit-ui`, coordinator03A, supervisor, migrations157/158, checker de tema, teacher-dashboard ou ferramentas compartilhadas de release nesta etapa03B.

## 8. Lifecycle das worktrees

Fluxo normal: `preparing → ready → running → ended → preserved`. Pergunta: `ended → awaiting_answer`; resposta autorizada reivindica `awaiting_answer → ready` por CAS e usa o mesmo checkout. Não são criadas duas continuações concorrentes.

`ended` registra resultado técnico antes de drenar/liberar o lease. `preserved/awaiting_answer` definitivos só são persistidos após o retorno do coordenador, que aguarda os processos supervisionados. `blocked` e `discard_eligible` são valores reservados do schema/tipo; não há transição automática que conceda descarte nem API de remoção implementada.

| Situação | Tratamento real |
| --- | --- |
| Origem suja/base/ref/autorização inválida antes de registro | Enqueue ou worker falha com motivo; sem criar checkout/fallback. O erro fica na fila; nem todo bloqueio gera linha no ledger. |
| Falha após registry/preparação parcial | Preserva registro/diretório/metadados criados e tenta registrar quarantined. Criação incerta também envenena o lease; sem limpeza automática. |
| Executor falha com ownership íntegro | Coleta diferenças e executorStatus failed, preserva checkout e propaga erro. |
| Cancelamento ou perda de PG/proteção | Interrompe via sinal/supervisor; arquivos permanecem, podendo haver quarantine e evidência final incompleta. Não inventa sucesso ou rollback. |
| Worker/SIGKILL/restart | Guard persistente e linha em running/preparing/ended podem permanecer. Nenhum TTL/PID morto autoriza takeover. Recovery de job legado não recupera o filesystem. |
| Replay de run terminal | Recusado sem executar callback/criar worktree adicional; request-key da fila retorna associação original. |
| Continuação de pergunta | Mesma identidade/revisão/base/storage, manifesto/inodes/ponteiro e fingerprint; CAS exclusivo. Mudanças exigem reconciliação. |
| Revisão editada antes de iniciar | Host recusa execução mutável e registra necessidade de reconciliação. |
| Revisão editada durante callback | Revisão capturada permanece; triggers157/freshness distinguem resultado stale. Não reescrever snapshot para torná-lo atual. |
| Mudança de origem/HEAD/branch durante execução | Revalidação final falha; preserva worktree e sinaliza conflito/quarentena, sem integrar. |
| Descarte | Nenhuma remoção automática ou endpoint foi introduzido. Exige implementação/política/autorização futura e prova de ausência de escritores. |

Manifestos não fazem recovery automático; são evidência para revisão. Se o DB estiver indisponível, pode não ser possível atualizar sua linha: manifestos/guard e arquivos preservados são as evidências restantes.

## 9. Modelo de coordenação

**Fase1:** lease sobre repositoryRoot/common-dir da origem; valida fonte/authorization snapshot, reserva unique(queue,run), cria diretório privado e worktree detached, registra identidades e ready. Git worktree add é a única operação Git mutável própria do manager; não altera os arquivos de trabalho, branch ou HEAD da origem, mas modifica legitimamente o registro no common-dir.

**Fase2:** outro lease sobre worktreeRoot/root e o mesmo common-dir. Verifica registro físico e fonte; executa callback, coleta evidência e encerra. As fases não mantêm leases aninhados ou fazem upgrade de lock. Não se concluiu separação segura de checkout e metadados: common-dir continua protegido durante **todo** o intervalo mutável e captura, inclusive consultas necessárias. Worktrees relacionadas esperam uma pela outra.

A ordem de diretórios/advisory locks, tentativas não bloqueantes, fechamento integral/retry, ancestrais SH/raízes EX, heartbeat, guard e drenagem são da03A. No Git principal, common-dir dentro da origem participa também da hierarquia física; outra fila que queira o original não pode concorrer com a worktree coordenada. Bancos diferentes no mesmo host não dispensam o flock físico.

Os subprocessos Git passam por runManagedProcess/supervisor sob lease, com argv e env sanitizados, hooks/fsmonitor/external diff desativados, sem configurações global/system nem substituição de objetos Git. Leituras de preparação usam GIT_OPTIONAL_LOCKS=0; criação é mutável e protegida. Operações sobre índice/refs pelo executor não ganham autorização automática. Trocá-los para ocultar resultado, mudar HEAD ou trocar ponteiro `.git` falha na validação.

Linux, mesmo UID, filesystem local suportado e sessão PG dedicada continuam precondições. Storage passa por verificação física/mounts antes de criar. Bind subtrees/mounts aninhados não homologados falham fechados. Não foram realizados mounts privilegiados nos testes.

## 10. Integração com as filas

### card_runs

A entrada é o endpoint existente `POST /cards/:id/runs`, com `request_key` e, opcionalmente, `workspace_mode: isolated`. Esse campo só solicita o modo; `ORBIT_ISOLATED_RUNS=1`, storage válido, RBAC/card/layout e ProjectRegistry continuam obrigatórios.

Enqueue verifica chave idempotente, resolve projeto autorizado, captura request, compõe contexto e revalida a base. RunRepository persiste `input.checkout_request` junto ao card/revisão na mesma transação de enqueue, preservando idempotência/revision guard. Sem request, input legado continua válido.

Worker resolve novamente autorização/configuração, confirma associação run/config/projeto, workspace e executor. Sob o checkout/lease, confere revisão vigente antes de iniciar. Rebase de `project.root/resourcesRoot` fornece os recursos ao ContextBuilder na árvore aprovada; working_directory passa pelo safePath. O executor recebe projectRoot/workingDirectory da worktree. Registry e checks mantêm suas guardas. Resultado/outputs/freshness continuam nos contratos antigos; o ledger fornece identidade/evidência complementar. Notificação de sucesso só ocorre após encerramento protegido.

### card_ai_runs

A API de prompt existente aceita workspace_mode e request_key opcionais no allowlist. Project owner e card/workspace são verificados, a base é capturada antes de compor skills/prompt e revalidada antes de inserir. `checkout_request` e `request_key` são persistidos na mesma transação, com revisão e lock por card. Chave repetida retorna o run original, inclusive depois de editar card/HEAD, em vez de preparar outro checkout.

A fila conserva pausa/cota/FIFO por card e ownership worker. Após esperar, reautoriza project.local_path e workspace; manager/host revalidam base e revisão. O provider recebe executionPath da worktree. Eventos/diagnósticos usam write_coordination. Cancelamento antes do claim no modo isolado lança falha/interrupção, evitando evidência falsa de executor executado com sucesso.

Novo run isolado não usa previousSessionId de outra execução. Resposta a waiting_answer herda checkout_request do mesmo run; manager exige awaiting_answer/fingerprint/CAS e o provider pode retomar sua sessão específica. Runs legados não selecionam sessão anterior com checkout_request. Configurar isolamento ao responder uma sessão legada é recusado; não se troca silenciosamente o cwd de uma conversa antiga.

Sem opt-in, as duas filas seguem o fluxo03A original. Nenhuma terceira fila ou clone de serviço IA foi criado.

## 11. Relação com revisão e contexto

A base Git é pinada explicitamente na preparação do enqueue, antes da composição final do prompt/contexto. Capture e validate verificam HEAD/ref/branch e identidade/limpeza. O worker exige o mesmo pin, incluindo depois de esperar. `HEAD` significa a referência capturada naquele ponto, não licença para usar um HEAD posterior.

Revisão capturada continua pertencendo ao snapshot da demanda. Se mudar antes do início mutável isolado, há reconciliação; se editar durante execução, o resultado mantém a revisão antiga e pode ficar stale. Migration157 e CAS409 continuam sendo a fonte de verdade, não o status do checkout. O teste das classes muda revisão durante callback e verifica identidade antiga preservada; os testes PG157 exercitam freshness/CAS reais.

Config/skills/arquivos necessários não podem depender de ignored/untracked copiados: capture/validate bloqueiam essas fontes. Subdiretórios de projeto são mapeados dentro da worktree completa e resourcesRoot também é remapeado. A branch/ref de origem não muda por causa do trabalho do run.

**Limite:** checklist, anexos, linked cards, comentários, configuração fora do Git e sessão não formam um manifesto global imutável. O fingerprint novo é das alterações observadas, não do contexto completo. Não se implementou Context Compiler/Context Bridge ou reconciliação semântica de memória. Uma sessão antiga não é prova de compatibilidade com o checkout novo.

## 12. Registro de alterações

O manager coleta do filesystem/Git aprovado, sem depender dos eventos JSONL:

- HEAD e base completos, status inicial clean/preserved_continuation e status porcelain v1 -z.
- Alterações index/worktree: caminho, caminho anterior em rename/copy, status e kind (added/modified/removed/renamed/untracked/ignored).
- Diff binário Git relativo à base e diff staged, com external diff/textconv desativados.
- Untracked/ignored regulares: caminho, tipo, tamanho e SHA256; symlink: hash de seu alvo textual, sem ler o destino.
- Artefato JSON privado changes-UUID.json no runDirectory, com SHA256/tamanho e fingerprint determinístico do conteúdo observado.
- executorStatus, capturedAt, `integration: not_integrated` e `attribution: executor_and_auxiliary_tools_unseparated`.

Porcelain com NUL é convertido para escape textual `\0`/statusEncoding nul-escaped antes de JSONB; o artefato local JSON preserva representação verificável. Isso corrige uma falha real detectada na primeira execução PG.

Os manifestos/artefatos usam0600 e parent privado0700, escrita temporária/fsync/rename, com validação física e comparação DB/manifesto. Limites:4MiB por saída Git,50mil entradas de árvore,64MiB de conteúdo para hashes de untracked; saída UTF8 indeterminada é recusada. O mínimo de64MiB livres é uma guarda conservadora, não estimativa exata de espaço total da árvore. Exceder limite preserva checkout sem aprovar evidência incompleta.

Arquivos untracked permanecem na worktree; não se copia seu conteúdo para um diff público. Artefatos podem conter dados sensíveis de arquivos tracked e são privados; nenhuma rota de download/publicação indiscriminada foi adicionada. Não há scanner universal de segredos, retenção/backup criptografado ou garantia contra outro código do mesmo UID. Preservação local não substitui política operacional de dados.

Um diff prova diferenças observadas; não identifica qual subprocesso escreveu cada linha, nem valida semântica/compatibilidade futura. Artifact hash deve ser revalidado por um futuro consumidor; o Integration Gate ainda não existe.

## 13. Compatibilidade de plugins

PluginRegistry, PluginDefinition, capabilities/actions, dependencies, schemas e RBAC existentes permanecem. O core não importa a classe concreta do plugin IA para autorizar checkout; o plugin consome contratos core. O coordinator determinístico e o manager funcionam sem IA, comprovado com callbacks Core e executor não IA.

No modo isolado a allowlist do host é intencionalmente estreita: somente action built-in filesystem.read é aceita. Mail, Git actions, conectores, bancos, Delivery e outras actions podem afetar destinos externos/origem e falham antes da execução nesse modo. Não basta declarar cwd nem uma capability para ganhar autoridade isolada. No modo legado continuam com seus contratos anteriores e suas permissões.

Checks configurados são bloqueados no modo novo quando não há provisioning/autoridade de efeitos homologados; não são ignorados ou declarados aprovados. O host rejeita esse run, preservando os critérios obrigatórios do projeto. A política executora pede ao Codex sandbox workspace-write/read-only, approval never, MCP vazio, network off e sem writable tmp amplo; ambiente não herda DATABASE_URL/GIT_WORK_TREE/tokens arbitrários.

Essas guardas não são sandbox de plugins JavaScript não cooperantes, proteção de API remota ou homologação de todas as combinações históricas de versões. A regra canônica de compatibilidade continua, com zero novo drift core e testes de registry/fundações/filas aprovados. O checker global UI continua bloqueado por diferenças anteriores.

## 14. Persistência e migrations

Nova migration canônica **159_isolated_checkouts.sql**, projetada nos quatro runtimes:

| Objeto | Efeito |
| --- | --- |
| card_ai_runs.checkout_request jsonb nullable | Pin/identidade opcionais para prompt isolado; legado fica NULL. |
| card_ai_runs.request_key text nullable | Idempotência explícita de prompt. Índice unique(card_id,request_key) quando não NULL; runs antigos sem chave continuam válidos. |
| isolated_run_checkouts | PK(queue,run_id); queue limitada às duas existentes; card_id/card_revision/project_id/workspace_id/owner_id; state, identity/evidence JSONB, diagnostic e timestamps. |

Não cria fila nova. O ledger é polimórfico, sem cascades para card/run, permitindo reter evidência após exclusão administrativa. A autorização de consulta não nasce desse fato: cabe ao host e a qualquer futura API. Ausência de FK também exige manter a validação dos vínculos nos workers/manager.

Run genérico reaproveita input JSONB, sem coluna obrigatória nova. Write_coordination existente mantém diagnóstico. Contexto ALS/signal/descriptors são transitórios; inodes e manifestos persistidos são evidências revalidadas, não uma autorização eterna.

159 foi aplicada apenas no PG16 criado pelo teste, após provar data_directory/socket/usuário/listen_addresses. Cenário SQL verificou legado NULL e unique da request-key.157/158 não foram editadas nem aplicadas em bancos reais. O rollout futuro exige migration ordenada antes de executar este código; alguns SELECTs novos consultam colunas159 inclusive em caminhos de histórico/resposta legados.

## 15. Testes H1–H14

Comandos identificadores, todos efetivamente executados sobre a implementação integrada:

```sh
# T1: manager determinístico, Git real sintético e PG16 efêmero
node --test tools/orbit/isolated-checkout.test.mjs
# T2: duas classes reais de fila, DB/quota/executores substituídos
node --test tools/orbit/isolated-workers.test.mjs
# T3: provider real com CLI Node fake e HOME próprio
node --test tools/orbit/isolated-provider.test.mjs
# T4: regressão física/PG e limites reais das filas03A, somente fixtures
node --test tools/orbit/workspace-coordinator.postgres.test.mjs tools/orbit/workspace-workers.test.mjs
```

| ID | Status | Método/evidência efetiva | Limitação |
| --- | --- | --- | --- |
| H1 | PASS | T1: dois runs/filas, diretórios distintos com mesmo SHA verificado. T2 verifica cwd real entregue pelos workers. | Sem ativação de runtime. |
| H2 | PASS | T1/T2: escrevem nas worktrees e comparam bytes, status, branch/HEAD da origem, preservados. | Registro de worktree no common-dir muda legitimamente. |
| H3 | PASS | T1: unstaged/staged/untracked/ignored e assume/skip recusados; bytes/status preservados. | Sem provisioning de node_modules/env. |
| H4 | PASS | T1: ambos alteram shared.txt e mantêm resultados/diffs separados por run. | Não prova integração semântica. |
| H5 | PASS | T1: contenção de criação/execução, git fsck e worktree list consistentes. T4 revalida common-dir. | Não inclui Git externo não coordenado. |
| H6 | PASS | T4: writers concorrentes, duas ordens das filas e supervisão com exclusividade física; T1 confirma relação com worktrees. | Não é lock de editores humanos. |
| H7 | PASS | T1: segundo callback não entra antes de liberação, máximo observado1 no common-dir. | **Serialização**, sem paralelismo irrestrito. |
| H8 | PASS | T2: edição durante callback mantém revisão1; run antigo queued não chama executor e registra reconciliação. T1 ledger/revisão e regressão PG157 de freshness/CAS reais. | Revisão não versiona todo contexto; DB dos workers é fake. |
| H9 | PASS | T1: SIGKILL real de worker sintético preserva arquivo, linha e guard; sucessor não toma posse. Cancelamento ativo também preserva/quarentena. T4 cobre queda PG/supervisor. | Não afirma apagar ou matar todo escritor externo. |
| H10 | PASS | T1: replay não repete callback/não cria checkout; CAS de continuações concorrentes; unique SQL. T2 request-key de prompt retorna mesmo run. Regressão genérica de request-key. | Sem retry destrutivo de recurso incerto. |
| H11 | PASS | T1 usa só helpers determinísticos sem carregar IA; T2 executor plugin fake não IA; regressões registry/startup IA desligada. | Não modifica plugin_settings operacional. |
| H12 | PASS | Suítes de§16: snapshots/CAS/freshness/quotas fake/permissões/eventos/filas/checks/rollback e supervisor. | Não é npm test integral nem todas combinações produtivas. |
| H13 | PASS | T1/T2: origem/branch/HEAD intactos; ledger not_integrated após success e failed. | Não implementa Integration Gate. |
| H14 | PASS | T1: base/ref/projeto/storage inválidos, Git incompleto, flags e ponteiro .git adulterados bloqueiam; T3/policy: root/cwd/fallback/efeitos externos recusados. | Fake CLI prova argumentos e contratos, não sandbox SO real. |

T1:16 testes reportados (pai+15 subtests), todos aprovados. T2:1 teste composto aprovado. T3:1 aprovado. Não contar cada assert ou ID H como teste adicional.

Nenhum H ficou FAIL/NOT_RUN/BLOCKED ao final **no escopo isolado descrito**. Três grupos operacionais permanecem NOT_RUN por restrição: Codex real/sandbox, migrations em bancos reais e homologação dos workers implantados. Não contam como testes automatizados aprovados.

## 16. Testes de regressão

| Conjunto executado | Resultado final |
| --- | --- |
| T1 isolated-checkout (PG/Git) |16 PASS,0 FAIL,0 skipped. |
| T2 isolated-workers |1 PASS,0 FAIL,0 skipped. |
| T3 isolated-provider |1 PASS,0 FAIL,0 skipped. |
| Core DEV: isolated-execution-policy, execution, file-scope, managed-process, project-checks, workspace-coordinator, workspace-process |30 PASS. Policy/execution foram reconferidos após patch1.6.2:7 PASS, reexecução sem aumentar contagem. |
| Prompt selecionados DEV/PROD/Safdoulas/Suindá: prompt queue, revision, disabled AI startup, Questionar, multi_agent |21 PASS (6 DEV/5 cada outro), com quota/HOME/CLI fake. |
| Tools: shared/preflight/catalog/registry-foundation/card-revision-ui/card-version-enqueue/card-revisions.postgres/workspace-coordinator.postgres/workspace-workers |75 PASS. Inclui PG e multiprocessos sintéticos; não inclui serviços de produto. |
| TypeScript --noEmit --incremental false APIs DEV/PROD/Safdoulas/Suindá |4 PASS, reconferidas após patch final. |
| Git diff --check e sintaxe Node dos três novos testes |PASS. |
| Shared inspector |core drift0, locks pendentes0; UI drift9 preservado. |
| Preflight / gate global de promoção |Preflight BLOCK por condições UI/históricas; não declarado aprovado. Checker textual de tema não foi reexecutado nesta03B. |

**Total distinto:144 PASS,0 FAIL finais,0 skipped.** Não somar as7 reexecuções ou as14 classificações H ao total. As quatro compilações são verificações separadas. Web não mudou nesta etapa e não foi recompilada novamente; as oito compilações citadas no relatório03A são evidência histórica, não resultado novo03B.

Comandos adicionais seguros, usando as fixtures já corrigidas:

```sh
TSX_DISABLE_CACHE=1 TSX_TSCONFIG_PATH=dev/app/apps/api/tsconfig.json CODEX_BIN=/nonexistent/orbit-fixture-never-codex node --import ./dev/app/node_modules/tsx/dist/loader.mjs --test dev/app/apps/api/src/execution/isolated-execution-policy.spec.ts dev/app/apps/api/src/execution/execution.spec.ts dev/app/apps/api/src/execution/file-scope.spec.ts dev/app/apps/api/src/execution/managed-process.spec.ts dev/app/apps/api/src/execution/project-checks.spec.ts dev/app/apps/api/src/execution/workspace-coordinator.spec.ts dev/app/apps/api/src/execution/workspace-process.spec.ts
TSX_DISABLE_CACHE=1 TSX_TSCONFIG_PATH=dev/app/apps/api/tsconfig.json CODEX_BIN=/nonexistent/orbit-fixture-never-codex node --import ./dev/app/node_modules/tsx/dist/loader.mjs --test --test-name-pattern='prompt queue|revision|disabled AI startup|Questionar|multi_agent' dev/app/apps/api/src/prompt-question.spec.ts
node dev/app/node_modules/typescript/bin/tsc --noEmit --incremental false -p dev/app/apps/api/tsconfig.json
```

O comando de prompt/tsc aplica-se aos outros três prefixos com seus respectivos loader/tsconfig. O bloco75 foi executado via node --test com os nove arquivos listados na tabela. Logs locais de execução estão em `/tmp/orbit03b-audit-jnvk5i5v/`; não são requeridos para reproduzir os comandos e não se presume sua retenção permanente.

Falhas intermediárias investigadas/corrigidas:

- JSONB não aceita raw NUL do Git status: representação persistida corrigida e PG reexecutado.
- Ordem de chaves JSONB: comparação estabilizada, sem desconsiderar campos.
- Continuação concorrente: CAS awaiting_answer→ready antes da segunda fase, testado.
- Source index assume/skip e troca de ponteiro Git: guardas e testes incluídos.
- Duas fixtures usaram API durante edição concorrente do manager: `authorizedProjectRoot` passou a obrigatório; fonte estabilizada antes da execução final.
- Um teste inicial de fila fake não simulava heartbeat genérico; outro limite de espera era menor que a captura Git. Fixtures corrigidas sem relaxar assert de origem/ownership. Um guard exato desse teste terminado bloqueou testes seguintes por inode reciclado, conforme§18; nada foi “liberado” no coordinator para passar.
- Primeiro TypeScript detectou input incompleto em teste; fixture passou a construir ExecutionInput completo, sem cast para esconder erro.

## 17. Monorepo e projeções

Fonte final: **@orbit/core-source1.6.2**,185 mappings, integridade `e52f37334df622e4e014038ec301758ac367658d3501f914a05dbc30df583b3c`. UI permanece **@orbit/ui-source1.1.3**,74 mappings. Releases oficiais selecionadas: minor1.6.0 e patches1.6.1/1.6.2, sempre com plano anterior, atribuição de fontes e precondições; não houve edição manual de hashes para mascarar drift.

Quatro mappings novos:

- src/execution/isolated-checkout.ts → apps/api/src/execution/isolated-checkout.ts.
- src/execution/isolated-execution-policy.ts → apps/api/src/execution/isolated-execution-policy.ts.
- src/execution/isolated-execution-policy.spec.ts → apps/api/src/execution/isolated-execution-policy.spec.ts.
- sql/migrations/159_isolated_checkouts.sql → apps/api/sql/migrations/159_isolated_checkouts.sql.

Esses quatro e as seis fontes comuns alteradas de§7 estão projetados sob `dev/app`, `prod/app`, `safdoulas/app`, `suinda/app`. As três famílias não mapeadas (prompt-sessions, codex-provider, orbit-architecture) receberam deltas localizados nos quatro runtimes. Suas diferenças intencionais não foram substituídas por uma cópia integral DEV.

Conferência final exige zero drift core e zero locks pendentes. As nove divergências UI anteriores continuam exatamente nos mesmos caminhos; nenhuma projeção UI foi escrita pela release. A comparação com o preflight inicial confirmou os296 hashes de projeção UI e suas296 entradas de lock preservados. Publicação de fontes significa distribuição de arquivos versionáveis no checkout; não significa deploy, migration, npm publish ou ativação operacional.

## 18. Segurança operacional

Não houve Docker, restart de aplicações, deploy, chamada real ao Codex/modelos/embeddings pagos, banco de produto, Git mutável no repositório Orbit, commit/push/tag, worktree associada ao Git real ou limpeza operacional de checkouts. Nenhum segredo real foi aberto/copied em fixtures.

Testes Git mutáveis verificam que os alvos pertencem ao mkdtemp da própria execução. PG16 usa initdb próprio, usuário sintético, socket Unix exclusivo, sem TCP e env PG*/DATABASE_URL removido; prova data_directory/listen_addresses/usuário antes do DDL. Teardown para apenas o cluster criado. O teste das filas substitui quota e executores; o do provider usa caminho absoluto para binário fake e codexHome substituído por diretório sintético, verificando que a preparação real não foi chamada. O provider fake confere que DATABASE_URL/GIT_WORK_TREE sintéticos não chegam ao filho.

A ressalva histórica03A sobre primeira consulta de cotas real permanece registrada e não foi reclassificada. Nesta03B os caminhos de quota/HOME foram revisados antes dos testes; não se repetiu aquele caminho inseguro. Não se tentou apagar auth/sessões reais para “corrigir” o histórico.

**Incidente restrito a fixtures03B:** primeiras falhas de JSONB/heartbeat/tempo de espera deixaram alguns guards dos próprios fixtures. A exclusividade conservadora funcionou: um inode reciclado fez o guard antigo bloquear uma fixture nova. Corrigiu-se o teardown e removeu-se somente tokens exatos, associados aos UUIDs/raízes temporárias desses testes já encerrados, após comprovar término dos workers e filhos Git aguardados. O token93bef63a-5bd2-4cb5-b7eb-217f8b45a7c9, runb72b1154-0047-495d-9242-2d2fc27f2fa8, era da fixture orbit-isolated-workers-HKvVQf já encerrada; seu registro foi retido no log local antes da remoção. Nenhum marcador operacional ou de ownership desconhecido foi removido, nenhum TTL/PID foi usado como regra de recuperação do produto. Os testes finais passaram sem afrouxar quarentena.

Os agentes auxiliaram leitura histórica, manager e fixtures em arquivos delimitados. Houve limite de uso do agente de testes; o integrador assumiu a execução final e a redação. Não há medição que comprove economia de tokens/tempo, e não se apresenta projeção como ganho observado.

## 19. Inventário Git

Branch/HEAD finais são os mesmos do início; não há stage/commit/push/tag desta entrega. O diff contra HEAD contém as várias implementações locais e não deve ser atribuído integralmente à03B.

**Novos03B:** manager, política/spec, migration159, três ferramentas de teste, relatório03B e16 projeções dos quatro mappings novos. **Receberam delta03B:** seis fontes core existentes e suas24 projeções;12 arquivos das três famílias não mapeadas; AGENTS/experiência; manifestos pacote/workspace e quatro locks.

**Preexistentes preservados:** migrations157/158 e auxiliares de revisão/coordinator/supervisor; mudanças01/02/03A de file-scope/managed-process/registries etc (as fontes de§7 recebem delta adicional onde indicado); main.ts/card-dialog e lib/api/prompt-execution da02/03A; correção teacher-dashboard Suindá; ferramentas preflight/shared; relatórios históricos e ZIP. Não se fez stash/reset para separar a árvore.

O baseline de hashes de161 arquivos detectou51 deltas atribuídos (incluindo o esqueleto159 que já estava escrito quando o snapshot foi obtido), nenhuma exclusão e nenhuma mudança inesperada depois de reconhecer a159 como trabalho03B. Arquivos novos posteriores ao snapshot também foram revisados. Nove arquivos UI e migrations157/158 mantiveram hashes. O relatório final e os testes são arquivos de trabalho não rastreados quando assim aponta git status; distribuição local não significa envio ao remoto.

## 20. Limitações e riscos

- **Legado:** sem checkout_request continua escrevendo na origem sob03A; não afirmar isolamento por worktree desses runs.
- **Escritores externos:** editores humanos, APIs Git/Delivery independentes e ferramentas fora do contrato não são coordenados universalmente. Detectar mudança não desfaz efeitos externos.
- **Sandbox/rede:** CLI fake prova argv/env e encaminhamento; não prova contenção efetiva do CLI real. Plugins arbitrários no processo ou subprocessos com acesso direto não recebem sandbox SO pelo ALS. Homologação real é pré-requisito de ativação, não motivo para usar bypass silencioso.
- **Remotos/bancos/actions:** recusados no modo novo sem autoridade própria. Uma worktree não isola SSH, mail, DB, cloud, ferramentas MCP ou diretórios externos.
- **Árvore original suja/ignored:** bloqueio intencional inclui node_modules/env. O Orbit atual não pode ser isolado fingindo que HEAD contém suas mudanças locais. Preparação/provisioning depende de etapa autorizada, sem commits automáticos.
- **Contexto incompleto:** card revision+Git pin não são fingerprint de todos os linked cards/checklists/anexos/configuração/memória. Sem reconciliação semântica.
- **Common-dir:** worktrees relacionadas serializadas; nenhuma promessa de aceleração paralela por run.
- **Falhas/quarentenas:** sem recovery automático; DB pode ficar desatualizado em crash. É obrigatório investigar guard, supervisor, manifestos e arquivos antes de recuperar.
- **Dados preservados:** diffs privados podem conter informação sensível. Há checagem de nomes sensíveis conhecidos, não scanner universal; faltam política de retenção, criptografia/backup e API de revisão/discarte.
- **Limites técnicos:** Linux/local/mounts suportados/mesmo UID, Python3/flock/pidfd e PG de sessão. Hosts/UIDs distintos, transaction pooling, mounts especiais, submódulos, sparse/filters/includes/alternates/shallow e extensões Git não foram homologados. O tipo aceita SHA completo40/64, mas repos com extensions/object-format exigem revisão; testes usam SHA1.
- **Evidência:** limites de saída/tamanho/UTF8 e tipos de arquivos podem impedir coleta completa; falha preserva sem aprovar integração.64MiB livre não garante espaço suficiente para toda árvore.
- **Integração:** não implementada; nenhum diff/resultado tem aprovação semântica ou compatibilidade automática com cards independentes.

## 21. Pendências de ativação

1. Janela autorizada para inspecionar estado real e aplicar migrations157→158→159 na ordem necessária; nenhuma foi aplicada aos produtos nesta entrega.
2. Rollout coordenado de workers compatíveis, sem misturar writers antigos e anunciar proteção global. Reinícios não estão autorizados por este relatório.
3. Preparar storage físico privado0700 fora de cada checkout, volume/dados próprios por ambiente, espaço/backup/retenção e acesso autorizado. Nenhum ORBIT_WORKTREE_ROOT operacional foi configurado aqui.
4. Empacotar supervisor.py junto ao dist ou no fallback src, garantir Linux/Python3/flock/pidfd/UID/mounts e sessão PG dedicada. Arquivo ausente deve continuar bloqueando, sem fallback.
5. Homologar sandbox/rede/configuração do CLI real em workload sintético autorizado. Não habilitar modo bypass como alternativa a falha do sandbox.
6. Definir provisioning explícito para recursos necessários não versionados e autoridade de checks/actions externos. Atualmente esses casos bloqueiam.
7. Definir procedimentos de quarantine/recovery/discarte: propriedade, ausência comprovada de writers, evidência preservada e autorização específica. Nenhum cron/TTL/kill de PID ausente substitui isso.
8. Só então configurar `ORBIT_ISOLATED_RUNS=1` e storage no host autorizado e usar `workspace_mode: isolated` nas solicitações escolhidas. Não há toggle UI habilitado por padrão nem atualização operacional feita nos quatro ambientes.
9. Homologar filas implantadas, pausa/cancelamento/Q&A/retomada/eventos e confidencialidade dos artefatos. UI drift antigo é pendência separada; não sincronizar UI global para liberar este trabalho.
10. Integration Gate e política de integração serão etapa posterior; esta ativação não poderá aplicar resultados automaticamente à origem.

## 22. Preparação para a próxima etapa

| Capacidade futura | Ponto real disponível; ainda não implementado nesta etapa |
| --- | --- |
| Project Context Registry | ProjectRegistry/ContextBuilder e request/identity persistidos oferecem origem e base; falta manifesto completo versionado de seleção/autorização. |
| Manifesto/fingerprint de contexto | card_revision+baseCommit+resources e hashes existentes podem compor proveniência; fingerprint atual é de alteração, não de contexto. |
| Context Compiler | Builders atuais continuam separados; camada nova pode fixar fontes/precedência/tamanho por run sem alterar identidade do checkout. |
| Context Bridge | IDs run/card/projeto/workspace/base permitem validar futuras chamadas; nenhuma RPC/MCP novo foi criado. |
| RAG versionado | Há base para filtrar conhecimento por produto/revisão/commit; não foram criados índices, embeddings ou recuperação nova. Consumidores vetoriais anteriores não são negados. |
| Project Consistency Engine | Diffs por run, freshness e estado not_integrated são insumos; não há avaliação/reconciliação de regras entre cards. |
| Integration Gate | Base, checkout preservado, artifact hash e evidência técnica permitem verificar proposta futura. Nenhuma aprovação, merge ou aplicação foi implementada. |
| Desired State Reconciler | Registry+jobs+manifestos são estados observáveis; ainda não há laço que reconcilie intenção vigente com código/artefatos. |

O próximo implementador deve preservar a distinção entre fato técnico, requisito vigente e aprovação de integração. Não iniciar a etapa04 com base neste documento.

## 23. Handoff técnico

- Comece por AGENTS/skill orbit-environment, documentação01/02/03A/03B, Git e `node tools/orbit/cli.mjs preflight --format json` somente leitura. Preserve a árvore não commitada; main/HEAD acima não representam todo o trabalho local.
- Core canônico final1.6.2/185 arquivos; UI1.1.3/74. Use packages/orbit-core e `shared reconcile --packages @orbit/core-source --release patch --files <todas fontes atribuídas>` com plano antes de --write. Nunca altere só projeção nem publique UI para resolver os nove drifts.
- Manager: isolated-checkout.ts; policy: isolated-execution-policy.ts; migração159; consumidores execution.service/run-repository e quatro prompt-sessions/codex-provider. Inputs legacy sem request seguem03A.
- Toda chamada manager precisa de authorizedProjectRoot obtida da autorização atual, não apenas sourceRoot da request. Antes de entrar, valide acesso ao card/layout/projeto/workspace e revisão capturada; use o diretório aprovado até o adaptador. Não construa permissões a partir do prompt.
- Host opt-in é ORBIT_ISOLATED_RUNS exatamente1 mais storage físico ORBIT_WORKTREE_ROOT já preparado. API opcional: workspace_mode isolated e request_key estável. Nada habilitado operacionalmente por este trabalho.
- Reuse deferForAnswer/continuation apenas para o mesmo run awaiting_answer com CAS e evidência idêntica. Nova worktree não herda sessão anterior. Não recrie checkout para um run já associado nem faça fallback em erro.
- Evidências ficam no ledger e diretório privado fila-UUID/tree, identity.json/lifecycle.json e changes-UUID.json. Nunca publique artefato bruto; revalide hashes, identidade física e autorização antes de consumir. Preservação não é integração.
- Execute os testes seguros§15–16; T1 exige PG16 nativo local, sem Docker e sem DATABASE_URL. T2/T3 isolam quota/HOME/provider. Não rode npm test integral herdado sem revisar efeitos reais de CLI/cotas/auth.
- Se fixture falhar, espere seus workers/filhos e encerre só seu PG; cleanup deve reconhecer tokens/UUIDs/diretórios exatos. A quarentena não é lixo: nunca varrer/remover marcadores operacionais nem recuperar por TTL/PID.
- Migrations/bancos reais, serviços e sandbox real continuam não homologados. Autorização de código/teste não permite restart/migration/deploy. Pacote Python precisa acompanhar a aplicação.
- Limites bloqueantes para ativação: origem atual pode estar suja/ignored; provisioning ausente; effects externos recusados; storage/policy/data lifecycle não configurados; CLI real não testado. Nenhum desses pontos autoriza contorno inseguro.
- Próxima etapa deve partir das evidências/limites reais de§22; Integration Gate e consistência semântica não existem. Nenhuma integração automática ou descarte foi criado.

## 24. Resultado final

**CONCLUÍDA no escopo de implementação e validação isolada da03B**, com serialização conservadora e restrições de efeitos explicitadas.

| Dimensão | Estado final |
| --- | --- |
| Código das duas filas/Core/policy/contratos/159 | IMPLEMENTADA E VERIFICADA nas fixtures descritas. |
| Testes automatizados distintos |144 PASS,0 FAIL finais,0 skipped. |
| Cenários H1–H14 |14 PASS no escopo explicitado;0 NOT_RUN/FAIL nesse conjunto. |
| Compilação API |4 PASS, versão final. |
| Distribuição de arquivos |Core1.6.2 nos quatro runtimes, drift core0/locks0; nove variantes UI preservadas. |
| Separação paralela de locks de worktrees relacionadas | NÃO IMPLEMENTADA; opção conservadora permitida e comprovada. |
| Bancos reais | NÃO MIGRADOS/NÃO CONSULTADOS. |
| Ativação/deploy/restarts | NÃO REALIZADOS; opt-in não habilitado nos ambientes. |
| Homologação CLI real/sandbox e workers implantados | NOT_RUN por restrição operacional. |
| Integração semântica/automática de resultados | NÃO IMPLEMENTADA e fora do escopo. |

Não há pendência de integração documental ou de código03B escondida como rascunho. Há pendências operacionais explícitas em§21 e limites de garantia em§20; o status acima não equivale à prontidão de produção. Não foi iniciada a Implementação04.
