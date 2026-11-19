# Implementação 03A — Coordenação segura das filas

Data: 2026-11-13. Raiz: `/home/meada/projetos/orbit`. Resultado de encerramento: **PARCIALMENTE CONCLUÍDA**, pela ressalva operacional/teste descrita abaixo; implementação e testes finais dos caminhos abrangidos foram entregues.

## 1. Resumo executivo

Foi implementada uma autoridade física compartilhada no Orbit Core para as execuções de `card_runs` e `card_ai_runs`. A identificação considera caminhos físicos, raiz Git, metadados Git comuns e sobreposição de diretórios. As duas filas adquirem a mesma proteção antes de executar alterações, snapshots, verificações e operações de restauração. Projetos independentes podem executar simultaneamente.

A autoridade combina locks de diretório Linux por descritor, advisory locks PostgreSQL de sessão e marcadores persistentes de ownership fora do projeto. A proteção física funciona também quando dois runtimes usam bancos distintos no mesmo host, usuário e filesystem suportado. Não há tomada automática de posse por TTL ou simples ausência do PID. Interrupções incertas deixam quarentena, bloqueando novas execuções sobre áreas sobrepostas.

Um supervisor Python Linux mantém os descritores e atua como subreaper: espera/recolhe descendentes, inclusive processos destacados que fecham descritores, antes de terminar. Captura de escopo continua sendo verificação, não isolamento. Restauração que não possui prova de autoria é recusada, preservando arquivos e registrando conflito.

Foram aprovados testes de PostgreSQL descartável, multiprocessos, classes reais dos dois workers com dependências simuladas, supervisão de descendentes, revisão/freshness, permissões e regressões anteriores. As oito compilações TypeScript API/Web passaram. O pacote fonte final é **@orbit/core-source 1.5.4**, coerente nas quatro projeções. Permanecem nove drifts anteriores de UI e a checagem textual anterior de tema; não foram sobrescritos.

**Ressalva que impede encerramento integral:** um teste herdado do DEV foi executado antes de se detectar que, apesar de simular o executor, ainda alcançava a função real de consulta de cotas. Essa função pode preparar o HOME do Codex e iniciar `codex app-server`. Não há evidência de chamada de modelo ou consumo de API paga, mas não foi demonstrada ausência de interação/efeito local do CLI nessa execução inicial. O caminho foi isolado nos testes seguintes. Portanto, o critério de ausência de operação real não é afirmado irrestritamente. Não houve scripts de migration, deploy, reinício de aplicação, acesso a banco de produto ou Git mutante no monorepo.

## 2. Base documental

Foram lidos integralmente os relatórios numerados00–20 de `docs/sondagem-arquitetural/`, `01-FUNDACAO-COMPATIBILIDADE.md` e `02-VERSIONAMENTO-CARDS.md`, incluindo a continuação§18; nenhum documento solicitado estava ausente. Uma frente auxiliar fez essa leitura histórica e cruzou os pontos relevantes com o código. Foram consultados AGENTS, a skill `orbit-environment`, mapa/pacotes/locks e convenções de projeção.

| Documentos | Consequência aplicada |
|---|---|
| 00,01,02 | Preservar monorepo com runtimes/bancos isolados e reaproveitar ferramentas/filas existentes. |
| 03,04,05 | Manter workers, estados, eventos, perguntas, sessões e multiagent existentes; não criar terceira fila. |
| 06,07,08,09 | Distinguir intenção de comprovação, preservar diferenças de produto e localizar contratos atuais. |
| 10,11 | Não equiparar snapshot de input, sessão, execução e commit; tratar edição/concorrência separadamente. |
| 12,13 | Coordenação não implementa Context Bridge, RAG ou contexto completo versionado. |
| 14,15,16 | Locks/checks antigos são parciais; aproveitar registries, builders, quota e histórico. |
| 17,18,19 | Assimetria das filas e restauração cruzada são problemas comprovados, não hipóteses. Usar testes descartáveis. |
| 20 | Autoridade de integridade pertence ao core; plugin IA consome contrato, sem dependência core→classe IA nova. |
| Implementação01 | Usar preflight sem escrita/cache; não mascarar drift ajustando hashes. |
| Implementação02 | Preservar migração157, revisão/captura/CAS/freshness e idempotência. Sua continuação já corrigiu a aspa do painel Suindá; esse bloqueio histórico não foi tratado como atual. |

## 3. Estado inicial

Branch `main`, HEAD `d9307b8e6a54316f802acbd7bcb96baa26116f16`. Nenhuma alteração de branch, stage, commit, push ou tag nesta entrega.

A árvore já continha as implementações01/02 e a continuação, sem commit: AGENTS/documentação, ferramentas de preflight/reconcile, core1.4.0, migração157/helper/revisões e projeções, integrações de `main.ts`, prompt sessions, tipos/UI e a correção do painel docente. Relatórios18–20, relatórios de implementação e ZIP também já eram não rastreados. Esse trabalho foi preservado e não é integralmente atribuído à03A.

Antes das alterações, o preflight DEV somente de leitura retornou BLOCK pelas projeções `codex-limits.tsx` e `plugin-navigation.tsx`, além das ressalvas estáticas conhecidas. A conferência dos quatro runtimes confirmou nove variantes UI anteriores e core1.4.0 consistente. O banco real não foi consultado; o último registro disponível informa migração157 ainda não aplicada. Não se declarou seu estado operacional comprovado por leitura de banco.

## 4. Arquitetura anterior

A fila genérica reivindicava uma linha com `SKIP LOCKED`, mantinha flag local `active` e não possuía exclusividade física do projeto durante a execução. Seu claim bloqueava globalmente quando qualquer prompt estava queued/running, mesmo de outro projeto.

A fila IA mantinha advisory locks por card e caminho lógico de projeto, em conexões separadas. Não compartilhava autoridade com a fila genérica. Comentários, perguntas e retomadas possuíam mecanismos próprios. IDs distintos ou bancos diferentes podiam apontar para o mesmo diretório.

`captureFileScope` tirava snapshot e podia restaurar/remover qualquer mudança posterior relativa ao snapshot, sem saber qual escritor a produziu. Cancelamento/timeout de um processo imediato também não demonstrava que descendentes destacados tinham terminado.

## 5. Problema reproduzido

O relatório18 já comprovava C1/C3. O teste novo `tools/orbit/workspace-workers.test.mjs` voltou a reproduzir ambos **somente em diretório descartável sem coordenação**:

- Dois snapshots, escopos `a.txt`/`b.txt`, duas escritas: a verificação do primeiro remove o arquivo do segundo; a segunda remove o do primeiro.
- Um snapshot seguido de escrita não atribuída: `rollback()` legado remove o arquivo desse outro escritor.

A função legada não se tornou um isolador. O fluxo novo impede dois escritores coordenados simultâneos e, quando não há prova de autoria, não executa a restauração destrutiva. Testes separados demonstram preservação dos outputs sequenciais e recusa de rollback incerto.

## 6. Decisões arquiteturais

1. **PostgreSQL sozinho é insuficiente entre bancos distintos.** Foi mantido como coordenação de sessão/saúde, com exclusividade física adicional no host.
2. **Sem lease por tempo.** Um processo antigo pode sobreviver a heartbeat/TTL. Nenhuma expiração ou teste de PID concede automaticamente a área a outro proprietário.
3. **Locks hierárquicos:** ancestrais compartilhados e raízes exclusivas evitam sobreposição em árvores sem Git; raiz Git e common-dir unem caminhos que compartilham checkout/metadados. Aquisição não bloqueante, liberação integral e retry evitam upgrades/deadlocks de aquisição.
4. **Close, nunca unlock explícito no flock:** descritores mantêm a mesma open-file-description. Chamar unlock poderia liberar a proteção herdada por um supervisor ainda vivo.
5. **Supervisão além do filho direto:** herdar descritores apenas no Codex não basta, pois netos podem fechá-los. O supervisor retém os guards e adota órfãos com subreaper.
6. **Quarentena conservadora:** morte abrupta, perda da sessão ou drenagem não comprovada preservam ownership. Não há recuperação automática de marcador.
7. **Restauração por autoria, não apenas por diferença:** sob lease, arquivos sem atribuição comprovada são preservados e a operação falha. Não há reset/clean/restore Git genérico.
8. **Mesmas filas/status:** diagnósticos adicionais usam stage/metadata/eventos; freshness permanece independente.
9. **Escopo explícito:** APIs Git independentes, defaults de projeto e pipelines fora dessas filas não receberam uma promessa de exclusividade absoluta. Worktrees por execução não foram introduzidas.

## 7. Implementações realizadas

Fontes canônicas, relativas à raiz:

| Arquivo | Funções/efeitos |
|---|---|
| `packages/orbit-core/src/execution/workspace-coordinator.ts` | Novo contrato, identidade física/Git, locks, marcadores, heartbeat, ALS, cobertura, ownership, interrupção/quarentena e drenagem. |
| `packages/orbit-core/src/execution/workspace-coordinator.spec.ts` | Três testes de cobertura/contexto, rollback incerto e impossibilidade de retornar sucesso após perda de autorização. |
| `packages/orbit-core/src/execution/workspace-process.ts` | Adapter de spawn que seleciona supervisor sob lease, reserva FDs acima de stderr e preserva o ambiente explicitamente fornecido pelo caller. |
| `packages/orbit-core/src/execution/workspace-process.spec.ts` | Quatro testes do supervisor: saída/código, órfãos destacados, cancelamento e parent inválido. |
| `packages/orbit-core/src/execution/workspace-supervisor.py` | Guardian Linux sem dependências externas Python; subreaper, parent-death signal, pidfd para sinais e espera por descendentes. |
| `packages/orbit-core/src/execution/execution.service.ts` | Fronteira protegida do genérico, sinal combinado, metadados, checks sob lease, resultado após término do intervalo mutável e distinção de cancelamento/interrupção. |
| `packages/orbit-core/src/execution/run-repository.ts` | WorkerId, claim sem bloqueio global IA, fences de stage/finish, diagnósticos em metadata; revisão/idempotência/quota mantidas. |
| `packages/orbit-core/src/execution/codex-executor.ts` | Exige lease e usa supervisor; mantém executor/argv/permissões existentes. |
| `packages/orbit-core/src/execution/managed-process.ts` | Verifica cobertura, combina aborts, usa supervisor quando coordenado e espera close em vez de resolver logo após enviar SIGKILL. |
| `packages/orbit-core/src/execution/project-checks.ts` | Propaga AbortSignal; cada comando passa pelo processo gerenciado. |
| `packages/orbit-core/src/execution/project-checks.spec.ts` | Adapta testes ao contrato real: checks não são dispensados e alterações incertas são preservadas, não apagadas para simular rollback seguro. |
| `packages/orbit-core/src/execution/file-scope.ts` | Guarda captura/verificação/cobertura pelo lease; rollback sem autoria falha/quarentena. Mudanças vazias não provocam quarentena indevida. Sem lease, função legada permanece para callers não abrangidos e baseline. |
| `packages/orbit-core/src/execution/registries.ts` | Valida lease vigente antes/depois de action sob execução coordenada; preserva registry, schema, autorização e capabilities. |
| `packages/orbit-core/src/git/git.plugin.ts` | Dentro de uma execução coordenada, Git local valida cobertura e usa processo supervisionado. Rotas independentes mantêm limite explícito. |
| `packages/orbit-core/src/delivery/executors.ts` | Executor local herda a coordenação quando chamado dentro dela; SSH não recebe falsa garantia local e falha fechado nesse contexto. |
| `packages/orbit-core/sql/migrations/158_workspace_coordination.sql` | Coluna worker_id no genérico e JSON de diagnóstico no IA. Não altera157. |
| `packages/orbit-core/package.json`, `orbit.workspace.json` | Registra novos artefatos e versão final1.5.4. |

Arquivos não mapeados adaptados de modo localizado nos quatro prefixos `dev/app`, `prod/app`, `safdoulas/app`, `suinda/app`:

- `apps/api/src/plugins/ai/prompt-sessions.ts`: usa o contrato core, retira lock lógico de projeto redundante, mantém FIFO por card, persiste diagnóstico, aborta ownership perdido, fence de resultado e quota isolável nos testes.
- `apps/api/src/plugins/ai/codex-provider.ts`: exige proteção para execução mutável, usa supervisor/checks sinalizados, não resolve timeout antes da drenagem, supervisiona revisão Git e permite HOME sintético nos testes. Geração textual read-only permanece separada.
- `apps/api/src/prompt-question.spec.ts`: workspace/HOME/binary sintéticos, lease na integração fake, quota substituída no teste e regressões de revisão preservadas.
- `apps/api/src/orbit-architecture.ts`: sincroniza a instrução persistente de coordenação.
- `apps/web/lib/api.ts` e `apps/web/components/prompt-execution.tsx`: expõem diagnóstico opcional e identificam espera pelo workspace, sem novo tema/menu.

Também foram criados `tools/orbit/workspace-coordinator.postgres.test.mjs`, `tools/orbit/workspace-workers.test.mjs` e este relatório; AGENTS e documento de experiência foram atualizados.

## 8. Coordenador compartilhado

### Identidade

`realpath(projectRoot)` e o diretório efetivo são verificados. O segundo deve pertencer à raiz física declarada. Consultas Git somente de leitura, com configuração global/variáveis Git sanitizadas, obtêm top-level e common-dir. Alvos redundantes contidos em outro alvo são eliminados.

A identidade usa caminhos físicos e pares device/inode. Projeto/card ID não é chave de exclusão. A raiz e os diretórios efetivos são revalidados antes/depois das operações críticas. Symlinks equivalentes e subdiretórios Git foram testados. Worktrees Git ligadas compartilham proteção do common-dir; esta etapa não entrega paralelismo de worktrees.

A versão suporta Linux, mesmo UID proprietário da raiz e filesystems locais explicitamente reconhecidos. Bind subtrees, mounts aninhados, filesystem desconhecido e identidade indeterminada falham de modo controlado. Não há fallback de segurança menor. Namespaces/hosts/UIDs diferentes sem uma identidade compartilhada comprovada não recebem garantia global.

### Aquisição e manutenção

`withWorkspaceWriteLease(db,request,callback)` recebe fila/run/card/projeto, raiz/diretório, sinal e callback de estado. Retorna somente após o callback e a drenagem. `currentWorkspaceWriteLease()` transporta o contrato por AsyncLocalStorage. A interface fornece owner/resource/signal, assertActive, descritores, rastreamento de processos e poison. `assertWorkspaceWriteCoverage` impede usar uma proteção de outra área.

Ancestors recebem flock compartilhado; alvos, exclusivo. Tentativas não bloqueantes fecham todos os descritores quando há contenção e repetem respeitando cancelamento. Não existe upgrade de lock. A conexão PostgreSQL é mantida pelo período ativo, com advisory locks derivados dos inodes e heartbeat de500ms com prazo de1500ms.

O pooling suportado é de sessão dedicada (`pg.PoolClient` retido); transaction pooling/proxies que trocam backend durante a sessão não foram homologados. A autoridade física local continua necessária, inclusive entre bancos diferentes.

### Ownership e recuperação

Marcadores ficam em `/tmp/orbit-write-coordination-<uid>`, modo700, fora do snapshot. Contêm token aleatório, fila/run/card/projeto, PID e raízes/inodes. Arquivos são escritos/sincronizados em temporário e publicados por hardlink exclusivo, sem sobrescrita ou leitura de JSON parcial por outra execução. Não seguem symlinks e não expiram. Outros marcadores sobrepostos impedem takeover mesmo se o flock ficou livre após crash.

Em término comprovadamente limpo, remove-se o marcador e fecham-se os descritores. Não se chama flock unlock. Perda/poison conserva o marcador. Cancelamento com drenagem não comprovada também pode deixar quarentena.

**Não foi implementado um botão de recuperação automática.** A recuperação exige janela autorizada, verificação de ausência de escritores/órfãos, revisão do workspace e do ownership específico. Não basta PID ausente ou marcador antigo. Nenhum comando de remoção indiscriminada é recomendado.

## 9. Integração com as filas

### card_runs

Enqueue continua capturando a revisão e preservando request-key. Claim mantém quota e pausa por usuário, mas não consulta globalmente todos os prompts. Passa a gravar worker_id. Stage/finish não podem avançar uma execução de outro worker.

Depois de resolver contexto/diretório em leitura, `processRun` entra no coordenador antes de snapshot/preparação mutável/executor. O input recebe sinal combinado; integrações, verificações e tentativas de rollback permanecem dentro. Saída/progresso/histórico são preservados. O resultado é persistido depois de encerrar o intervalo mutável com sucesso. Interrupção de comunicação é falha; cancelamento solicitado conserva a semântica própria.

Recovery de heartbeat antigo altera o estado do job, mas não concede o filesystem a outro escritor. O worker anterior perde autorização e a autoridade física/quarentena impede sobreposição. Nenhum recovery usa restauração de arquivos.

### card_ai_runs

Enqueue, revisão, Q&A e busca de sessão por revisão continuam existentes. FIFO/lock por card é mantido. O antigo lock de projeto por string é substituído pela proteção física compartilhada. Há abort por mudança de status/worker e por erro da conexão de card.

Enquanto espera o recurso, o run continua queued e publica mensagem de espera. Depois de adquirir, grava owner/resource e entra no executor. O provider/checks usam o mesmo lease; conclusão de pergunta/resultado ocorre após encerrar o intervalo mutável. Resultado/error são fenced por worker_id. Perguntas antigas não são silenciosamente revinculadas a revisão nova.

Testes com as classes reais, dois cards e executores simulados demonstraram ambas as ordens: genérico→IA e IA→genérico, com máximo observado de um escritor por workspace.

## 10. Compatibilidade de plugins

Não foi criado registry, worker ou sistema de dependências novo. Actions/capabilities e validações permanecem. O core não importa classe concreta da IA para decidir exclusividade. O plugin de IA importa o contrato core.

O registry revalida proteção antes/depois da action quando há lease. Git local e comandos de Delivery chamados dentro desse contexto usam a supervisão. Remotos SSH não são apresentados como cobertos pelo lock local; nesse contexto a operação é recusada antes de abrir conexão remota.

O teste de registry com IA desligada passou; o coordenador e o executor genérico com action/executor sem IA também foram exercitados. Não se afirma homologação de todas as combinações possíveis de plugins nem sandbox contra código de plugin não cooperante.

## 11. Proteção de arquivos

O snapshot só começa depois da aquisição; a raiz deve estar coberta. Validação e rollback checam o mesmo lease/identidade. Escritores e checks supervisionados são drenados antes de liberar a área.

Sob lease, uma diferença de snapshot não é usada como prova de autoria. Se haveria restauração/remover arquivo, a função recusa, preserva os arquivos e coloca o recurso em revisão/quarentena. Isso muda deliberadamente a expectativa dos testes antigos de rollback automático: apagar um arquivo criado por outro autor seria inseguro.

Nada foi resolvido com Git reset/clean/restore/revert. Trabalho preexistente e untracked dos fixtures foi preservado nos testes protegidos. A função legada sem lease continua capaz de restaurar; o teste C1/C3 a usa apenas como baseline descartável. Novos caminhos mutáveis não devem chamá-la como se fosse isolamento.

## 12. Concorrência e cenários F1–F10

| Cenário | Resultado e evidência |
|---|---|
| F1 | Aprovado isoladamente: dois processos/cards/projetos lógicos na mesma árvore, sem overlap. |
| F2 | Aprovado: duas filas nos dois sentidos em processos PG; também as duas classes reais com executores/cotas simulados. |
| F3 | Aprovado: raízes independentes adquiriram simultaneamente sem aguardar o término uma da outra. |
| F4 | Aprovado: symlink, subdiretório Git, nested não Git e common-dir de worktrees. Bind/mounts não homologados são recusados por código, sem montagem privilegiada em teste. |
| F5 | Aprovado: processos Node independentes, FDs/PG reais em fixture, IPC para barreiras. |
| F6 | Aprovado: cancelamento de waiter não libera predecessor; término de backend PG interrompe proprietário e bloqueia sucessor; SIGKILL do proprietário deixa quarentena. Supervisor drena netos destacados em testes próprios. Não se afirma encerramento de toda ferramenta externa após morte simultânea de supervisor/host. |
| F7 | C1/C3 reproduzidos no baseline; fluxo serializado preserva os dois outputs. Rollback protegido incerto é recusado, sem apagar arquivos preexistentes ou não atribuídos. |
| F8 | Aprovado em PG sintético:157 preservada, vínculos/legados/freshness corretos após edição e sucesso. Lock de workspace não altera revisão. |
| F9 | Aprovado: coordenador sem imports IA; registry com IA desabilitada e executor não IA continuam funcionais. |
| F10 | Aprovado no escopo isolado: RunRepository real com quota substituída, claim/ownership/stage/history/idempotência; perguntas/multiagent/revisões/eventos em quatro runtimes; regressões de schemas/permissões. Consulta real de cotas e workers implantados não são homologados por esses fakes. |

Teste entre bancos diferentes no mesmo cluster confirmou que a exclusividade física não depende de estarem no mesmo banco. Isso não é uma promessa entre hosts diferentes ou mounts não suportados.

## 13. Banco e migrations

Nova migração canônica `158_workspace_coordination.sql`:

- `card_runs.worker_id text`.
- `card_ai_runs.write_coordination jsonb NOT NULL DEFAULT '{}'::jsonb`.

Logs/stage/metadata genéricos existentes são reaproveitados. Não há terceira fila, tabela de lease por TTL ou alteração dos enums de status. A migração157 não foi editada.

157 e158 foram aplicadas apenas no cluster PG16 sintético, após confirmar data_directory exclusivo, socket Unix, usuário fixture e ausência de TCP. O código novo exige esses schemas na ativação. Estado dos bancos reais não foi consultado/aplicado nesta entrega; a pendência da157 no último relatório continua referência histórica, não medição atual.

## 14. Fonte canônica e projeções

Pacote final core1.5.4; UI1.1.3 preservado. O plano selecionado de core foi inspecionado antes de aplicar a distribuição em arquivos. Houve release minor1.5.0 e patches1.5.1/1.5.2/1.5.3/1.5.4 durante integração/correções; não se manteve uma versão com conteúdo diferente.

Seis mappings novos: coordinator/spec, process/spec, supervisor.py e migração158. Dez fontes existentes foram adaptadas, conforme seção7. Esses16 artefatos estão projetados em `apps/api/src/...` ou `apps/api/sql/migrations/...` sob cada um dos quatro runtimes. Metadados/workspace e quatro locks foram atualizados pelo mecanismo oficial, nunca por cópia indiscriminada.

Conferência final: core1.5.4, **zero drift core e zero locks desatualizados**; pacotes registrados contêm181 arquivos core e74 UI. Continuam nove projeções UI divergentes (limits/navigation nos quatro, access-shell Safdoulas). Hashes das projeções UI e valores de suas entradas de lock foram preservados na publicação selecionada.

A correção da aspa do painel docente Suindá permaneceu intacta. O checker global ainda acusa diferenças UI e o padrão textual antigo de tema; não foi afrouxado nesta etapa.

O supervisor.py deve acompanhar a aplicação: o adapter procura o arquivo ao lado do módulo ou no src/execution correspondente. Empacotar somente dist sem o artefato Python fará a operação falhar fechada; não há fallback de execução mutável sem guard.

## 15. Testes executados

| Comando/conjunto | Resultado final |
|---|---|
| `node --test tools/orbit/workspace-coordinator.postgres.test.mjs` |14 testes reportados, incluindo pai/subtests, aprovados; PG16 descartável. |
| `node --test tools/orbit/workspace-workers.test.mjs` |3 aprovados: dois sentidos dos workers reais com dependências simuladas e baseline destrutivo C1/C3. |
| Testes DEV execution/file-scope/managed-process/project-checks/workspace-coordinator/workspace-process |29 aprovados. |
| prompt-question selecionados nos quatro runtimes, com fakes de executor/HOME/cota |21 aprovados (6 DEV,5 nos demais); modos próprios de cada runtime preservados. |
| Ferramentas/regressões etapas01/02: shared,preflight,catalog,registry-foundation,card-revision-ui,card-version-enqueue,card-revisions.postgres |58 aprovados. |
| TypeScript `--noEmit --incremental false` API/Web dos quatro runtimes |8 verificações aprovadas. APIs foram reconferidas após as últimas alterações. |
| Checker global/preflight |Continua BLOCK/exit1 pelos drifts UI anteriores e verificação textual de tema; core está coerente. |

Comandos seguros principais:

```sh
node --test tools/orbit/workspace-coordinator.postgres.test.mjs tools/orbit/workspace-workers.test.mjs
TSX_DISABLE_CACHE=1 TSX_TSCONFIG_PATH=dev/app/apps/api/tsconfig.json node --import ./dev/app/node_modules/tsx/dist/loader.mjs --test dev/app/apps/api/src/execution/workspace-coordinator.spec.ts dev/app/apps/api/src/execution/workspace-process.spec.ts dev/app/apps/api/src/execution/managed-process.spec.ts dev/app/apps/api/src/execution/project-checks.spec.ts dev/app/apps/api/src/execution/file-scope.spec.ts dev/app/apps/api/src/execution/execution.spec.ts
TSX_DISABLE_CACHE=1 TSX_TSCONFIG_PATH=dev/app/apps/api/tsconfig.json node --import ./dev/app/node_modules/tsx/dist/loader.mjs --test --test-name-pattern='prompt queue|revision|disabled AI startup|Questionar|multi_agent' dev/app/apps/api/src/prompt-question.spec.ts
node dev/app/node_modules/typescript/bin/tsc --noEmit --incremental false -p dev/app/apps/api/tsconfig.json
```

O comando de prompt aplica-se aos demais prefixos/tsconfigs **na versão já corrigida dos testes**. Não extrapolar para toda suíte herdada sem revisar efeitos de HOME/CLI/DB.

Falhas intermediárias registradas:

- Tipagem estrutural do listener `PoolClient.on` e variáveis de projeto removidas ainda presentes no finally; corrigidas sem casts de aplicação para esconder incompatibilidade.
- F10 carregou inicialmente uma projeção anterior ao ajuste de fence; passou a exercitar a fonte vigente e depois sua distribuição foi conferida.
- Dois testes antigos esperavam execução sem lease/rollback automático; foram adaptados ao novo contrato real, com preservação de autoria, não eliminados.
- Três agentes auxiliares foram interrompidos por limite de uso. O integrador revisou os artefatos salvos e concluiu sequencialmente; nenhum resultado incompleto foi contado como aprovado.
- Incidente de consulta de cotas real do teste herdado, detalhado nas seções1/16. As execuções posteriores usam quota/HOME/executável sintéticos.

## 16. Segurança operacional e ressalva de teste

Não foram executados deploy, restart de aplicações, Docker, migration em banco real, seed, reset/clean/restore Git ou publicação Git. Comandos Git mutantes em testes pertenciam exclusivamente a repositórios temporários gerados para equivalência/common-dir; ambiente Git foi sanitizado. Nenhum conteúdo de credencial foi aberto ou exposto.

Os testes PG criam cluster independente, usuário/senha sintéticos, socket exclusivo e `listen_addresses=''`, sanitizando PG*/DATABASE_URL. O teardown encerra apenas seu cluster e remove seus diretórios. Marcadores de guard em tmp são removidos pelo teste apenas quando o token/run corresponde ao próprio fixture; não há limpeza global de marcadores.

**Desvio encontrado:** a primeira execução selecionada do teste de fila DEV ainda podia chamar `enforceCodexQuota` real depois do executor fake. O código desse helper prepara `.orbit/sessions` e tenta iniciar o executável configurado para consultar `account/rateLimits/read`. Não foi obtida evidência do subprocesso efetivamente iniciado ou de todos os efeitos locais dessa execução. Não é uma chamada de inferência, e nenhuma API paga/modelo foi intencionalmente chamada, mas não é correto certificar “Codex real nunca foi alcançado”.

A correção introduz fronteiras privadas de quota/HOME com o comportamento de produção original, substituídas somente nas fixtures. O harness das classes reais intercepta exclusivamente a função de quota; o executor é fake. O binário CLI dos testes de protocolo é gerado no temporário, assim como o HOME; as próximas execuções não acessam o login real. Não se apagou estado de sessão/credencial para tentar desfazer um efeito que não foi atribuído com segurança.

Essa ressalva mantém a entrega parcial na certificação operacional, apesar dos testes finais aprovados. As afirmações históricas dos relatórios anteriores não foram reescritas para ocultá-la.

## 17. Inventário Git

Novos nesta etapa: seis fontes/mappings novos citados na seção14, quatro conjuntos de suas projeções, dois arquivos de testes em tools e este relatório. Alterados nesta etapa: dez fontes canônicas existentes da seção7, metadados/locks, seis famílias não mapeadas dos quatro runtimes, AGENTS e documento de experiência.

Já existiam antes: todas as mudanças01/02/continuação; relatórios18–20, ZIP, testes de preflight e de revisão, helper157 e alterações de main/card-dialog. O diff contra HEAD contém essas etapas somadas; não representa isoladamente a03A. Não foi feito stash/reset para separá-las.

A revisão verificou plano selecionado, patches de integração e estado Git. Nenhum arquivo UI mapeado foi usado como destino para apagar variantes. `git diff --check` foi usado na revisão; arquivos novos também devem ser inspecionados antes de eventual commit autorizado.

## 18. Regressões e limitações

- Linux local, mesmo UID e filesystem suportado são precondições; outros casos bloqueiam, não fazem fallback.
- Transação pooling, hosts diferentes, montagens especiais e aliases físicos não comprovados não foram homologados.
- Código arbitrário em processo, editores humanos, ferramentas externas e plugins que escrevem depois de resolver sua Promise não são sandboxed. Callers integrados devem aguardar operações e usar os helpers; não há garantia absoluta contra código não cooperante.
- Rotas independentes de GitPlugin (stageHunks/stageFiles/commit/toggle/revert), DeliveryGitService/pipelines fora das duas filas e `ProjectRegistry.saveExecutionDefaults` não receberam um lease global envolvendo toda a operação. Suas chamadas internas supervisionadas dentro de um lease existente são cobertas; suas entradas independentes continuam fora da garantia. Remoto SSH requer autoridade remota, não um lock local.
- Supressão violenta simultânea do owner/supervisor pode deixar estado incerto. A resposta é quarentena sem takeover, não alegação de que todo processo externo morreu.
- Rollback por autoria não foi implementado: a operação destrutiva incerta é recusada. Isso preserva dados e exige revisão de workspace, podendo reduzir disponibilidade.
- Sem worker real de produção/modelo, sem navegador e sem homologação implantada. Os testes não comprovam integração semântica do código ou aprovação de resultado.
- Resource root substituída/movida durante execução é tratada como erro; não se tenta seguir/reapropriar uma árvore incerta.

## 19. Relação com a Implementação 02

157 não foi alterada. Baseline/histórico/hash, vínculos de ambas as filas e `finished_card_revision` continuam geridos pelo banco. Não se grava manualmente uma revisão nova para reaproveitar um input antigo.

Idempotência antecede revalidação no enqueue, preservando o run original mesmo após edição. CAS409 do PATCH permanece. Sessão anterior continua filtrada por revisão. Espera por workspace não atualiza a revisão capturada, e `freshness` mantém `pending/current/stale/unversioned`, independentemente do stage de coordenação. Regressões PG/GUI/helpers da02 passaram.

## 20. Pendências de ativação

1. Rever este relatório externamente, incluindo a ressalva do teste de cota; auditar eventuais efeitos locais com escopo apropriado, sem ler/expor credenciais ou apagar estado não atribuído.
2. Confirmar estado real das migrations em janela autorizada. A referência disponível informa157 pendente;158 também não foi aplicada nesta entrega.
3. Preparar implantação coordenada dos writers: não misturar workers antigos sem guard com os novos e afirmar garantia equivalente. Encerrar/quiescer writers antigos exige autorização própria.
4. Confirmar Python3/Linux/pidfd/flock, artefato supervisor, UID/filesystem e sessão PG dedicada no alvo; testar fallback de indisponibilidade como erro controlado.
5. Definir procedimento operacional de quarentena: investigar proprietário/descendentes/arquivos, só recuperar após exclusividade comprovada e autorização. Não fazer limpeza por idade/PID/TTL.
6. Homologar cancelamento, restart controlado, múltiplas instâncias, UI de espera e arquivo protegido com dados de exemplo no ambiente preparado, sem modelos pagos.
7. Manter nove drifts UI e checagem de tema como pendências independentes; não promover UI global para “consertar” este gate.

## 21. Preparação para a Implementação 03B

O contrato core já identifica o recurso e envolve um callback; uma worktree futura poderá fornecer outra raiz física/snapshot por run. Não foi criada worktree de execução nesta etapa. Worktrees usadas pelos testes eram apenas fixtures de equivalência/metadados.

A futura etapa terá de distinguir locks de escrita da worktree de locks de metadados Git comuns, definir integração/limpeza, revisão/contexto/HEAD e preservação de alterações anteriores. O lock de common-dir atual é conservador e serializa worktrees relacionadas durante todo o intervalo. Não foi relaxado para antecipar uma arquitetura não especificada.

## 22. Handoff técnico

- Comece por Git/preflight somente leitura e preserve a árvore não commitada. Consulte os relatórios01/02/03A e os20 históricos; não confunda pendências antigas com o estado atual do core.
- Fontes são `packages/orbit-core`; projeções usam `shared reconcile --packages @orbit/core-source` com todos os caminhos atribuídos, plano inspecionado e precondições. Versão final1.5.4; UI não é parte dessa release.
- Envolva novos caminhos mutáveis com `withWorkspaceWriteLease` antes de preparação/snapshot. Reuse contexto aninhado somente sem ampliar área. Use assert/cobertura e supervisor; não exponha os FDs para código que os feche/desbloqueie.
- Nunca libere flock por unlock enquanto um supervisor possa retê-lo. Nunca conceda ownership por TTL/PID ausente. Marcador incerto bloqueia; não é lixo para um cron.
- Preserve todos os resultados e diagnósticos; falha/cancelamento/espera/freshness são conceitos distintos. Recovery de job não é autorização para filesystem.
- Para testes, use os comandos seguros da seção15. Não herde DATABASE_URL de produto. O teste de classes usa cota/executor fake; protocolo CLI usa executável e HOME sintéticos.
- Não rode indiscriminadamente npm test ou um teste herdado de CLI sem examinar prepareOrbitCodexHome/cotas. A execução inicial revelou essa lacuna e o relatório a registra.
- Não aplique157/158 nem reinicie apps com base em testes. A autorização desta etapa excluiu essas operações.
- Git/Delivery/API independentes e callbacks não cooperantes precisam de escopo adicional se o objetivo futuro for exclusividade total de todos os escritores Orbit. Não transforme a cobertura atual em alegação global.
- Instruções foram sincronizadas em AGENTS, experiência de produto e prompt dos quatro runtimes. Não iniciar03B, Context Bridge, RAG, Consistency Engine ou Gate com base nesta entrega.

## 23. Resultado final

**PARCIALMENTE CONCLUÍDA.** O coordenador, a supervisão, as duas integrações de fila, as guardas de arquivo, as projeções e os testes finais dos caminhos abrangidos estão implementados/aprovados. Os cenários F1–F10 possuem evidências descritas, com distinção entre classes reais simuladas, PG/processos reais descartáveis e inspeção estática.

Entretanto, a execução inicial do teste herdado impede certificar integralmente a ausência de interação operacional com o CLI/HOME real. Soma-se a ausência de homologação operacional e o escopo explicitamente limitado a writers integrados. Não há migração/implantação autorizada nem promessa de exclusividade contra todo editor/ferramenta.

A entrega disponibiliza funcionalidade implementada e testes isolados aprovados, registra funcionalidade não testada e separa pendência de migration, pendência de implantação e homologação. A Implementação03B não foi iniciada.
