# Validação cruzada e lacunas críticas

## 1. Identificação da investigação

- **Data:** 2026-11-13.
- **Repositório:** `/home/meada/projetos/orbit`.
- **Branch observada:** `main`.
- **Commit HEAD:** `0ee35d5e440d6e7fc6c684a8263f9dcecd52b597`.
- **Árvore de trabalho:** modificada, com 388 entradas em `git status --short --untracked-files=all` no momento da leitura. Há alterações locais em fontes DEV/PROD e artefatos não rastreados. Elas foram preservadas; não foi atribuído seu conteúdo a este relatório.
- **Escopo:** relatórios existentes 00–16; implementação e testes existentes de cards, filas, prompts, executor, contexto, RAG, Git e referências ao CONTROL. DEV foi a referência principal; PROD foi comparado nos componentes diretamente envolvidos.
- **Método:** inspeção estática e operações Git somente de leitura. Não houve consulta ao banco, execução de serviços, testes, comandos Codex, Docker, escrita Git, instalação, nem leitura/exposição de credenciais.
- **Limitação importante:** conclusões descrevem os arquivos presentes na árvore de trabalho observada, não necessariamente apenas o snapshot de HEAD. Arquivos modificados localmente podem divergir do commit. `git status` foi usado para estabelecer essa limitação, sem inspecionar segredos.

Termos usados: **fato** = comportamento demonstrado pela implementação lida; **inferência/risco** = consequência possível que requer teste; **não comprovado** = não localizado ou impossível de concluir sem executar/testar. Nenhum teste é declarado aprovado neste documento.

## 2. Respostas técnicas confirmadas

### Identidade e edição do card

O schema de `cards` inclui `updated_at`, mas não contém uma coluna de revisão ou histórico de snapshots (`dev/app/apps/api/sql/schema.sql:103-114`). A rota `PATCH /cards/:id` chama `updateCard` (`dev/app/apps/api/src/main.ts:1303-1305`). A função carrega a linha atual e, em seguida, atualiza título, descrição, datas, lista, posição, tipo e outros campos operacionais no mesmo registro, atribuindo `updated_at=now()` (`main.ts:881-963`). Não há comparação de `updated_at`, hash/revisão ou recusa por status ativo nesse caminho.

Na interface, título é salvo por `PATCH` ao perder foco e o campo não é desabilitado pelo estado de execução (`dev/app/apps/web/components/card-dialog.tsx:335-358`). A descrição também pode ser salva durante execução: o botão **Salvar** não usa `aiLocked`; somente **Salvar e executar** usa esse bloqueio (`card-dialog.tsx:525-545`). Portanto, a UI não impede toda edição durante um run. A API tampouco verifica estado do run em `updateCard` (`main.ts:881-963`).

### Prompt e momento do snapshot

`POST /cards/:id/prompt-runs` chama `PromptSessionsService.execute` (`main.ts:1264-1267`). Antes de inserir a execução, o serviço lê o card, configurações, projeto, checklist, comentários quando aplicável, contexto de cards, skills, escopo, verificações e imagens; monta um prompt e insere a linha de `card_ai_runs` com status queued (`prompt-sessions.ts:413-485`).

Enquanto aguarda a vez, o worker conserva referências/valores capturados pelo fechamento. Depois dos locks, ele detecta a sessão anterior e remonta o texto usando `makePrompt()`, mas esse construtor ainda lê o objeto `card` e demais valores já carregados, não relê a descrição atual do banco (`prompt-sessions.ts:469-472,490-517`). Assim, **remontar a string não equivale a atualizar o snapshot do card**. Não se observou uma leitura de `updated_at` ou hash na transição queued→running.

Ao concluir, o worker persiste sucesso, output, resumo, arquivos, atividades e session ID sem comparar a versão atual do card ou o estado do Git (`prompt-sessions.ts:549-568`). A sessão retomada é escolhida pelo próprio card e projeto (`:506-507`), mas não é invalidada por edição do card, alteração de branch ou mudança de HEAD.

### Estados e apresentação

`card_runs` persiste `queued`, `running`, `success`, `failed` ou `cancelled`, além de stage, input, output, error, heartbeat, logs e pedido de cancelamento (`sql/migrations/001_executable_cards.sql:17-47`). O endpoint retorna as últimas 50 execuções genéricas e outputs (`execution.service.ts:46-52`); endpoint separado permite consultar detalhe/logs (`:52`). A fila genérica considera execução stale após dois minutos sem heartbeat e finaliza como failed, com instrução para revisar efeitos (`:143-148`).

`card_ai_runs` persiste `queued`, `running`, `waiting_answer`, `success`, `error` ou `cancelled`, prompt, sessão, output, resumo, arquivos alterados, atividades, sugestões de commit, worker e timestamps (`sql/schema.sql:426-462`). O endpoint de prompt retorna até 20 execuções recentes (`prompt-sessions.ts:378`). A interface acompanha eventos e faz polling enquanto há queued/running/waiting_answer (`apps/web/components/prompt-execution.tsx:88-120`). O resumo do card é derivado da execução ativa ou mais recente e de notificações (`main.ts:329-344`); não representa um estado de “revisão vigente”.

Cancelamento genérico é aceito em queued e pode solicitar cancelamento de running (`execution.service.ts:94-102`). Prompt pode ser cancelado em queued ou waiting_answer, mas não em running (`prompt-sessions.ts:390-395`). Prompt stale sem heartbeat por dois minutos é marcado error; no shutdown, queued/running pertencentes ao worker também são marcados error (`prompt-sessions.ts:76-88`). Essas transições recuperam jobs, mas não fazem controle de obsolescência do card.

### Associação card/run e projeto/commit

Ambas as tabelas de execução apontam ao card por FK. A execução genérica armazena snapshot de título/descrição e configuração em `input`, mais recursos posteriormente carregados (`run-repository.ts:10-17`; `execution.service.ts:109-114`). Prompt guarda o texto compilado no campo `prompt`. Nenhum caminho observado armazena uma revisão formal do card ou SHA/branch inicial do projeto.

Projetos armazenam `local_path`; configurações de repositório guardam projeto, subcaminho relativo e branches permitidas (`schema.sql:408-419,519-533`). O plugin Git resolve o repositório no mesmo diretório local do projeto e consulta a branch atual nas operações Git (`git.plugin.ts:35-57`). Esse mecanismo não injeta automaticamente um repositório/branch/HEAD em um run.

O provider de prompt reporta eventos de `file_change`, normaliza caminhos e revisa diffs Git após o processo (`codex-provider.ts:72-94,186-216,250-271`). `card_ai_runs.file_changes` persiste a lista (`schema.sql:439-440`). Isso não compara a árvore pré-run com pós-run para provar autoria exclusiva; eventos da CLI são a fonte da lista de mudanças apresentada. Na execução genérica, `captureFileScope` compara snapshots da árvore e pode reverter paths fora do escopo (`execution/file-scope.ts:11-59`), mas também não atribui autoria individual quando há outro escritor.

Commit associado ao card é criado pelo plugin Git na ação de commit ou link (`git.plugin.ts:189-199,244`), não pela conclusão do Codex. `commitDraft` sugere arquivos a partir da interseção entre arquivos sujos e eventos de runs recentes do próprio card (`:97-120`); é heurística, não prova de quem escreveu. O commit é uma etapa explícita posterior à execução.

### Locks, claims e custo

`card_runs` tem uma restrição única por card para status queued/running (`001_executable_cards.sql:37-40`). Enqueue adquire advisory xact lock pelo ID do card e recusa se já existe `card_runs` queued/running ou `card_ai_runs` running; não inclui card_ai queued nessa consulta (`run-repository.ts:10-15`). Claim usa `FOR UPDATE SKIP LOCKED`, mas só um `active` boolean local limita concorrência por instância do serviço; múltiplos processos poderiam claimar runs diferentes (`run-repository.ts:18`; `execution.service.ts:24-38,143-149`).

Antes de claimar um `card_run`, a consulta exige que **não exista qualquer** `card_ai_run` queued/running no banco (`run-repository.ts:18`). Isso bloqueia novos claims genéricos enquanto houver prompt ativo em qualquer projeto/usuário, sem filtro de projeto.

O worker de prompt adquire um advisory lock por card e outro pelo `localPath` do projeto (`prompt-sessions.ts:490-507`), serializando prompts que chegam a essa região dentro da mesma base PostgreSQL e caminho. Porém, seu caminho normal de `execute` não consulta `card_runs` ativos antes de inserir ou claimar o prompt (`:413-485,490-517`). O advisory lock por card na criação do prompt e o usado por `card_runs.enqueue` têm a mesma chave baseada no card, mas esse lock é transacional, não mantido durante a execução; não fornece exclusão mútua entre os workers.

Há uma assimetria importante: a fila genérica espera prompts queued/running, mas um prompt comum pode começar enquanto `card_run` já está running. A fila de respostas automáticas a comentários é diferente: verifica `card_runs` queued/running antes de processar um comentário (`prompt-sessions.ts:297-315`). Essa verificação não deve ser generalizada para todo `card_ai_runs`.

O serviço genérico usa `captureFileScope` e checks; se há checks e falha, `rollback()` restaura mudanças observadas (`execution.service.ts:118-133`). Como o snapshot é da árvore inteira relevante, ele não tem propriedade/lock por escritor. Um segundo run concorrente pode alterar um path entre snapshot e validação; o primeiro pode classificar a alteração do outro como fora de escopo ou incluí-la em rollback. Esse é um risco de filesystem concorrente, não uma constatação de dano já ocorrido.

Existe proteção de quota/custo chamada em ambos os caminhos de execução (`run-repository.ts:18,20-22`; `prompt-sessions.ts:71-72,291-306,533`). Isso é uma salvaguarda relevante a preservar. Quota compartilhada não equivale a lock, isolamento nem correção de dupla execução.

### Codex e retomada de contexto

O prompt inclui instruções Orbit, descrição atual carregada, checklist, contexto vinculado, skills e demais fontes anteriormente listadas (`prompt-sessions.ts:426-471`). O processo recebe `orbitArchitecturePrompt` e a instrução por stdin, em diretório local do projeto, iniciando ou retomando pelo session ID (`codex-provider.ts:118-130`). A orientação pede que o agente confira arquivos e verificações; a execução tem acesso ao diretório, mas não fixa nem compara HEAD.

Há retorno de JSONL de progresso, mensagem, comandos, mudanças e erro, persistência de outputs/activities e Socket.IO (`codex-provider.ts:72-94,172-216`; `prompt-sessions.ts:520-568`). O modo de pergunta permite `waiting_answer`, resposta REST pelo autor e retomada da sessão (`prompt-sessions.ts:397-405,538-546`). Não foi encontrado RPC genérico para o Codex pedir contexto ao Orbit durante o run.

O executor genérico passa `--ignore-user-config` e `-c mcp_servers={}`, portanto não carrega MCP do usuário nesse caminho (`execution/codex-executor.ts:22-34`). O provider de prompts chama `prepareOrbitCodexHome`, que prepara diretório `.orbit/sessions` e, se necessário, link simbólico para autenticação; não configura nem descarta MCP explicitamente (`codex-home.ts:5-32`; `codex-provider.ts:97,128`). A ausência de MCP explícito no provider de prompts não prova se alguma configuração efetiva de servidor MCP é carregada pelo CLI; requer inspeção controlada do comando/config resultante, sem ler credenciais.

### RAG e memória

- **BM25 local:** ferramenta em `tools/orbit/knowledge.mjs` indexa arquivos Git e allowlist explícita, persiste cache `.orbit/cache/knowledge/index.json`, calcula SHA de documento e, na consulta, compara com fonte atual e marca `stale`; `--fresh` filtra conteúdo stale (`:156-178,181-235`). A busca é lexical. `context` escreve um Markdown, mas requer ação explícita (`:238-245`). Isso não injeta automaticamente conhecimento no fluxo normal de prompt.
- **Contexto local de desenvolvimento:** regras em `execution/development-policy.ts` instruem o agente a consultar o CLI em tarefas internas Orbit; isso é instrução disponível, não execução automática em todo run. Os comandos podem gerar artefatos se chamados (`:8-9`). Não foi localizado chamador automático do BM25 nos builders/runtime.
- **Recuperação vetorial:** `OrbitKnowledgeRetrievalService.rank` recebe explicitamente candidatos do plugin host, os limita, gera/recupera embeddings por conteúdo e retorna ranking (`knowledge-retrieval.ts:24-93`). O módulo AI exporta a classe como serviço simples e documenta que o host fornece candidatos autorizados (`ai.plugin.ts:13-15`). Busca estática não encontrou consumidor não-test de `.rank()` no API; portanto há mecanismo, mas seu uso operacional por uma funcionalidade de produto não foi comprovado.
- **Embeddings:** integração fixa `text-embedding-3-small`, depende de flag e chave e envia requisições a `https://api.openai.com/v1/embeddings` (`embeddings.ts:3-24`). Não há implementação local de embedding encontrada nesse serviço. BM25 lexical local pode funcionar sem essa API, após indexação explícita.
- **Isolamento:** serviço vetorial particiona por workspace/plugin/coleção e só vê candidatos passados pelo host (`knowledge-retrieval.ts:12-15,35-53`). Índice BM25 filtra runtime/path antes de ranking/deduplicação, conforme implementação da ferramenta (`tools/orbit/knowledge.mjs:181-203`). Nenhum dos mecanismos observados vincula um resultado ao SHA do projeto, revisão do card ou execução.
- **Contradição/conhecimento:** não foi localizado resolvedor de contraditórios. Hash/stale indica diferença de arquivo, não validade semântica, precedência entre fontes ou concordância com código.

### Exclusão, rastreabilidade e rollback

Arquivar e restaurar card alteram apenas `archived_at` (`main.ts:668-682`). Hard delete exige arquivamento, cancela execuções ainda queued/waiting, recusa se algum run está running e então apaga o card (`main.ts:965-986`). FK cascades removem `card_runs`, logs ligados ao run, `card_ai_runs`, jobs de comentário e `git_card_commits`; algumas atividades usam `SET NULL`, enquanto notificações ligadas ao card usam cascade (`001_executable_cards.sql:17-47`; `schema.sql:259-280,426-477,562-576`). O código/commits locais não são revertidos pelo hard delete.

Undo/redo pelo Git exige que o card ainda seja resolvido, que branch atual seja a branch original, worktree limpa e commit original ancestral; usa `git revert` e registra SHA de ação e alvo (`git.plugin.ts:201-216`). Os testes `src/git/workflow.spec.ts` cobrem o fluxo básico em repositório temporário/mocks, mas **não foram executados** e não cobrem associação após hard delete nem todas as dependências semânticas posteriores. Uma vez apagado o card, a rota normal de histórico/undo não consegue selecionar os SHAs daquela associação porque o registro em `git_card_commits` foi removido. O commit permanece recuperável no histórico do repositório se seu SHA ou referência for conhecido, porém a atribuição automática ao card foi perdida.

## 3. Matriz das duas filas

| Aspecto | `card_runs` — execução genérica | `card_ai_runs` — sessão de prompt |
|---|---|---|
| Entrada | `POST /cards/:id/runs`; valida configuração e armazena card/config snapshot (`execution.controller.ts:12`; `execution.service.ts:82-92`; `run-repository.ts:10-17`) | `POST /cards/:id/prompt-runs`; monta prompt e persiste antes de retornar (`main.ts:1264-1267`; `prompt-sessions.ts:413-485`) |
| Worker | Poller por instância a cada 2 segundos; claim DB com SKIP LOCKED (`execution.service.ts:35-38,143-149`; `run-repository.ts:18`) | IIFE iniciado pelo processo que aceitou execução; locks DB por card/projeto e heartbeat; stale/restart vira erro (`prompt-sessions.ts:70-88,486-517`) |
| Status | queued/running/success/failed/cancelled | queued/running/waiting_answer/success/error/cancelled |
| Concorrência interna | Um run ativo por card na tabela; `active` é local à instância; instâncias diferentes podem claimar cards diferentes. Nenhum lock por projeto/worktree visto | Um prompt por vez por card e um por caminho de projeto entre workers que compartilham o mesmo DB; filas podem acumular queued |
| Coordenação cruzada | Claim global para e enquanto existir AI prompt queued/running; enqueue por card considera AI running, não queued | Caminho normal não consulta card_runs na entrada nem claim. Fluxo de comentário tem verificação separada, não aplicável à fila normal |
| FS/escrita | Diretório/config do projeto, escopo opcional e verificações; `captureFileScope` snapshot/restore | Diretório compartilhado de projeto; escopo opcional/checks também no provider; sem worktree isolada identificada |
| Cancelamento/retomada | queued cancela; running recebe cancel signal; stale falha. Reexecução é nova execução | queued/waiting_answer cancela; running não cancela pela rota observada; answer retoma o mesmo run/sessão; restart/stale registra error |
| Falha | Run termina failed/cancelled; com checks o snapshot inteiro pode ser restaurado | Run termina error; não há comparação de versão ao fechar nem rollback geral do projeto por mudança concorrente |
| Proteção de custo | `enforceCodexQuota` durante claim/finalização | `enforceCodexQuota` durante controle da fila/execução |
| Isolamento real | Não provado: claim sem duplicidade não cria diretório exclusivo; worktree não localizado | Não provado: advisory locks reduzem concorrência somente entre prompts usando esse protocolo, não isolamento filesystem nem lock compartilhado com `card_runs` |

**Conclusão da matriz:** há prevenção parcial de concorrência, e a fila genérica é globalmente bloqueada por prompts ativos; não existe exclusão mútua simétrica e atômica entre as duas filas. Portanto é possível cenário em que um run genérico já iniciado continue enquanto um prompt começa, ambos no mesmo diretório. Também é possível concorrência entre múltiplos `card_runs` em instâncias de API diferentes. Não há evidência de worktrees/diretórios exclusivos.

## 4. Matriz de identidade e versionamento

| Objeto | Identificador/estado atual | Relação de versão comprovada | Lacuna |
|---|---|---|---|
| Card | UUID, campos atuais, `updated_at` | Atualização in-place; não há revisão numerada | Não identifica qual texto estava vigente em cada run |
| Revisão de card | Não localizada | — | Sem snapshot/versionamento first-class |
| Prompt | Texto em `card_ai_runs.prompt` | Persiste o prompt compilado daquele run; genérico armazena prompt dentro de contexto? somente card/config + recursos | Não garante que o prompt reflete edição feita depois do enqueue |
| Sessão Codex | `codex_session_id` | Associada a execução e retomada pelo card/projeto | Sem invalidar por revisão de card, contexto ou HEAD |
| Execução | Run ID, status, timestamps e outputs | FKs card/run; histórico consultável enquanto card existe | Sem card revision, commit base ou branch snapshot |
| Projeto | `project_id`, `local_path`, recursos | Recursos selecionados podem ter SHA256 em `context.resources` | Sem identidade completa do estado Git usado |
| Branch | Consultada pelo Git no momento da operação manual | Registrada no commit associado | Não está no run ao iniciar |
| Commit base | Nenhum campo de base no run observado | Git pode consultar HEAD para revisão do diff e commit | Não há reprodutibilidade da base executada |
| Arquivos alterados | `file_changes`/eventos ou snapshot de escopo | Associados ao run | Atribuição ambígua com escritores concorrentes; eventos não distinguem alterações preexistentes do escritor em todos os casos |
| Commit atribuído | `git_card_commits` registra card, repository, SHA, branch e arquivos | Criado em commit/link explicitamente associado | Não é criado por sucesso do Codex; some via cascade com card |
| Estado integrado | Branch atual/repositório, fora de run | Commit registrado somente pelo fluxo Git/Link do Orbit | Não demonstra que o código foi testado contra requisito vigente ou outros cards |

## 5. Resultados dos oito cenários

### S1 — Card alterado após entrar na fila e antes de iniciar

- **Caminho:** prompt lê card e compila prompt antes de inserir queued; execução genérica congela card/config em `input` no enqueue (`prompt-sessions.ts:413-485`; `run-repository.ts:10-15`).
- **Comportamento esperado pelo código:** o run conserva a entrada anterior. O prompt worker reconstrói a string com closure, não com re-leitura do registro (`prompt-sessions.ts:490-517`).
- **Risco:** executar intenção antiga enquanto UI mostra descrição nova. Não há stale check.
- **Não comprovado:** efeito end-to-end sob API/worker real e valor exato exibido na UI após a edição.
- **Teste mínimo futuro:** em fixture isolada, enqueue, editar via PATCH, liberar worker e inspecionar prompt enviado, snapshot e status. Sem executar neste levantamento.

### S2 — Card alterado enquanto Codex está executando

- **Caminho:** interface permite editar título e salvar descrição; API update altera a mesma linha sem checar status (`card-dialog.tsx:335-358,525-545`; `main.ts:881-963`). Worker já está com prompt e closure antigo (`prompt-sessions.ts:490-532`).
- **Comportamento esperado pelo código:** execução segue com instrução já enviada; conclusão persiste sucesso sem comparar alteração feita durante o run (`:549-568`).
- **Risco:** card modificado aparece como concluído pela execução antiga; resumo usa título capturado.
- **Não comprovado:** se uma mudança externa de arquivo é observada pelo Codex em tempo real; não há protocolo que envie a nova descrição ao processo.
- **Teste mínimo futuro:** executor fake bloqueável, PATCH enquanto bloqueado, liberar, verificar que run não é implicitamente migrado para novo texto e estado final sinaliza revisão antiga ou não.

### S3 — Card concluído/integrado, depois editado para evolução

- **Caminho:** descrição atual e sessão anterior são fornecidas ao Codex; provider retoma o session ID. Git separa sucesso de run e commit explícito (`prompt-sessions.ts:469-471,506-507`; `git.plugin.ts:189-199`).
- **Comportamento esperado pelo código:** nova execução pode reutilizar sessão e prompt menciona descrição atual e conferência dos arquivos; execução genérica usa contexto e instrução para ler projeto. Existe heurística de `commitDraft` usando lista de arquivos de runs recentes (`git.plugin.ts:97-120`).
- **Risco:** sessão pode conservar conversa anterior incompatível; nenhuma classificação criar/alterar nem pin de HEAD garante a atualização correta. Associação de arquivos é indicativa, não exclusiva.
- **Não comprovado:** qualidade do reaproveitamento de implementação, relação entre merge externo e card, nem se o Codex evita refazer funcionalidade.
- **Teste mínimo futuro:** integrar uma tarefa via workflow em repo fixture, editar card e retomar após nova mudança de branch/código; verificar prompt, diff e commit atribuível.

### S4 — Dois cards paralelos, arquivos diferentes, mesma regra de negócio

- **Caminho:** prompt sessions do mesmo `localPath` serializam entre si; instâncias do worker genérico podem executar cards distintos em paralelo e não usam esse lock (`prompt-sessions.ts:504-507`; `run-repository.ts:18`; `execution.service.ts:24-38`).
- **Comportamento esperado pelo código:** diffs podem não colidir e ambos concluir; checks existentes são comandos de projeto, não reconciliação semântica.
- **Risco:** divergência de regra sem conflito textual ou ordem de conclusão alterando estado observado.
- **Não comprovado:** teste funcional que detecte regra inconsistente, contexto atualizado do segundo run ou integração automática.
- **Teste mínimo futuro:** fixture com regra compartilhada em dois arquivos e duas tarefas concorrentes; comparar checks e resultado contra expectativa explícita.

### S5 — Dois cards modificando o mesmo arquivo

- **Caminho:** prompts no mesmo caminho de projeto se serializam; `card_runs` em múltiplas instâncias podem rodar simultaneamente e não há lock com Git. Prompt que comece após um generic já running não consulta esse run. Tudo pode compartilhar worktree (`prompt-sessions.ts:490-507`; `run-repository.ts:18`).
- **Comportamento esperado pelo código:** segundo escritor vê o filesystem tal como estiver quando abrir/ler; não há branch/worktree por tarefa nem detecção de conflito de arquivo pré-commit pelo run.
- **Risco:** lost update, diffs misturados, rollback do escopo removendo mudança concorrente, atribuição errada de files.
- **Não comprovado:** resultado de conflito real sob multiprocessos; não se executou teste que escreva Git/projeto.
- **Teste mínimo futuro:** harness de filesystem descartável com writers sincronizados e checks controlados; incluir caso de rollback de um writer enquanto outro grava.

### S6 — Retomada Codex após mudanças de outro card

- **Caminho:** retomada passa session ID e prompt novo, no mesmo `localPath` atual; sessão é selecionada pela execução anterior do mesmo card/projeto. Projeto do filesystem é compartilhado (`prompt-sessions.ts:506-507`; `codex-provider.ts:120-130`).
- **Comportamento esperado pelo código:** o prompt orienta a conferir arquivos atuais, e o Codex pode ler o estado visível no diretório; Orbit não calcula diff desde a sessão nem compara commit.
- **Risco:** memória antiga da sessão pode prevalecer apesar do novo estado de código; dependência de outra execução não aparece como relação formal.
- **Não comprovado:** quais arquivos foram vistos pelo modelo e como o estado da conversa é reconciliado.
- **Teste mínimo futuro:** serviço CLI fake registra diretório/instrução e fixture de sessão alterada; para comportamento do modelo, homologação controlada separada, sem credenciais reais.

### S7 — Card excluído após commits, depois pedido rollback

- **Caminho:** hard delete remove associação `git_card_commits` por cascade; commits permanecem no repositório. Undo/redo requer card acessível e consulta commits pelo card (`main.ts:965-986`; `schema.sql:562-576`; `git.plugin.ts:201-216`).
- **Comportamento esperado pelo código:** exclusão não altera código; após hard delete, fluxo de rollback por card não encontra o vínculo original.
- **Risco:** perda de rastreabilidade e impossibilidade de selecionar rollback pelo próprio card. SHA ainda pode estar no `git log`, mas associação não sobrevive.
- **Não comprovado:** se há outra auditoria externa ou backup do banco que preserve associação recuperável; isso depende de operação/dados não examinados.
- **Teste mínimo futuro:** teste de integração DB isolado: criar commit associado, excluir card, comprovar cascades e tentativa de history/undo; proibido fazê-lo em banco real.

### S8 — Conhecimento indexado recuperado após alteração da fonte

- **Caminho:** BM25 compara SHA do index com o arquivo atual na consulta e rotula stale; `--fresh` descarta stale (`tools/orbit/knowledge.mjs:218-235`). Retrieval vetorial recebe candidatos atuais do host, compara hashes de conteúdo e remove vetores não presentes na coleção (`knowledge-retrieval.ts:35-89`).
- **Comportamento esperado pelo código:** BM25 identifica alteração se a consulta for feita; vetorial usa o texto de candidatos passado naquele momento e embedding por conteúdo. O retriever sozinho não relê fonte original.
- **Risco:** se host passar candidato stale ou omitir proveniência, o retriever não sabe; conhecimento contraditório não é reconciliado. BM25 stale pode ser retornado sem `--fresh` e vem apenas marcado.
- **Não comprovado:** integração de retrieval a um fluxo de prompt de produto; busca de consumidor runtime `.rank()` não encontrou uso fora de specs.
- **Teste mínimo futuro:** testes isolados já existentes para BM25/retrieval verificam suas unidades; para operação, host fixture deve atualizar fonte, gerar candidatos autorizados e comprovar que prompt recebe hash/proveniência correta. Não executado.

## 6. RAG e contexto existentes

| Componente | Existe | Consumidor operacional comprovado | Validade/proveniência | Custos/provedores |
|---|---|---|---|---|
| `.orbit/orbit.yaml` e recursos de agente/skill/rule/knowledge | Sim; ProjectRegistry lê, valida referências e calcula hash por documento (`project-registry.ts:26-79`) | Sim no ContextBuilder genérico e skills de prompt quando selecionados | Hash local do recurso; não pin de commit nem snapshot de conjunto total | Local, sem embedding obrigatório |
| ContextBuilder de execução genérica | Sim; inclui prompt de arquitetura, card, agente, skills, rules/knowledge, files, cards vinculados e write scope (`context-builder.ts:11-51`) | Sim para `card_runs` (`execution.service.ts:109-114`) | `context.resources` tem hashes dos recursos selecionados; sem revisão global/HEAD | Leitura local/DB |
| Compilação em prompt sessions | Sim; card, checklist, comentários, contextos, skills, anexos, escopo/checks (`prompt-sessions.ts:426-471`) | Sim para `card_ai_runs` | Texto prompt é salvo, porém contexto carregado prequeue e sem revisão/HEAD | Execução Codex sujeita à quota configurada |
| BM25 local | Sim; index/query/context na CLI, hash/stale e escopo (arquivo `tools/orbit/knowledge.mjs:156-245`) | Disponível por chamada explícita/instrução de development policy; nenhum injection automático geral encontrado | SHA de documento, stale apenas na consulta; `fresh` é escolha explícita | Lexical local, sem API de embeddings |
| Índice vetorial runtime | Sim; tabela com workspace/plugin/coleção/model/hash/vector (`schema.sql:927-940`; migration 144) | Serviço exportado, mas nenhum chamador de `.rank()` fora dos testes foi encontrado | Hash de conteúdo; sem origem/commit/card/run | OpenAI embeddings externo se `ORBIT_AI_EMBEDDINGS_ENABLED=true` e chave presente (`embeddings.ts:8-24`) |
| Memória de sessão Codex | Session IDs e outputs persistidos | Sim em resume | Sem invalidação por card/contexto/HEAD; transcript não aparece como mensagens tipadas em Orbit | Uso do Codex CLI; quota aplicada por Orbit |

BM25 pode fornecer busca lexical local e evitar dependência externa de embeddings, mas só quando executado/indexado explicitamente. O vetor compartilhado já tem isolamento por escopo e cache por conteúdo, porém não é um RAG comprovadamente injetado em todos os cartões. “Embedding armazenado” não prova “conhecimento recuperado no prompt”.

## 7. Contradições resolvidas

1. **Edição durante execução:** resolvida. A descrição pode ser salva pelo botão normal; o campo título também persiste por blur. `aiLocked` bloqueia “Salvar e executar” e ações de prompt, não todo `PATCH` (`card-dialog.tsx:335-358,525-545`). API não recusa edição ativa (`main.ts:881-963`).
2. **Snapshot do prompt enfileirado:** resolvida. Prompt é criado antes do enqueue; o worker remonta o prompt depois de obter lock, mas usa os valores capturados antes. A edição queued não é relida (`prompt-sessions.ts:413-485,490-517`).
3. **Duas filas:** resolvida em parte. `card_runs.claim` pausa se qualquer prompt queued/running; `card_ai_runs.execute` normal não consulta `card_runs`. Há uma janela assimétrica, portanto não se pode afirmar coordenação compartilhada total (`run-repository.ts:18`; `prompt-sessions.ts:413-517`). A fila de comentário tem guarda própria.
4. **Locks de prompt:** resolvida. Advisory lock por card/projeto serializa prompts no mesmo DB/projeto path; não é isolamento do filesystem nem lock universal entre fila generic, Git e prompt.
5. **Execução vs integração:** resolvida. Run success persiste output; commit associado ocorre por ação Git explícita, logo sucesso não prova commit/merge (`prompt-sessions.ts:564-568`; `git.plugin.ts:189-199`).
6. **Exclusão vs rollback:** resolvida. Arquivar/restaurar não mudam código; hard delete remove linhas associadas por cascade; rollback é ação Git independente e precisa da associação/card existente (`main.ts:668-682,965-986`; `schema.sql:562-576`).
7. **RAG disponível vs operacional:** resolvida em nível de código inspecionado. BM25 é explícito/local; vetor tem API de ranking mas não foi encontrado consumidor de runtime fora de testes; injeção automática em todo prompt não existe como fato demonstrado.
8. **MCP:** resolvida para executor genérico: configuração do usuário é ignorada e MCP zerado. Para prompt provider, configuração específica não foi observada, então sua carga efetiva continua não resolvida (`codex-executor.ts:22-34`; `codex-home.ts:5-32`).

## 8. Contradições não resolvidas

- Se existem consumidores vetoriais carregados dinamicamente, plugins externos ou configurações de host fora de `dev/app/apps/api/src`; busca estática local não encontrou `.rank()` produtivo.
- Se o provider de prompt carrega MCP via configuração do diretório `.orbit/sessions`/CLI; `prepareOrbitCodexHome` só permite estabelecer o HOME/auth observado, não configuração efetiva.
- O teste `git.workflow.spec.ts` demonstra undo/redo básico na fixture, mas não o caso com commits dependentes, worktree dirty, card excluído e histórico de backup.
- A consulta de branch/HEAD antes de commit Git não prova qual branch/HEAD o Codex usou desde o início do run.
- Testes unitários de `captureFileScope`, queue e retrieval existem, mas sem execução não se sabe se passam na árvore atual. Testes de integração podem envolver PostgreSQL local; não foram iniciados.
- **CONTROL — Compose:** `compose.yml:189-197` aponta build context `./dev/app` e Dockerfile `tools/orbit-control/Dockerfile`; o caminho resultante `dev/app/tools/orbit-control/Dockerfile` não existe na árvore. `control/Dockerfile` existe, mas é outro caminho. Inspeção estática não prova qual imagem está atualmente em execução ou se foi construída de fonte anterior.
- **CONTROL — escopo de ambientes:** `control/environments.json` descreve DEV, PROD, Safdoulas e Suindá (`:1-105`), mas o script Python implementa operações nomeadas somente para dev/prod (`control/bin/orbit-env.py:14-16,41-44,149-197`). A documentação esclarece que Suindá usa Compose próprio, mas não reconcilia integralmente Safdoulas nem a divergência do arquivo de build (`README-ARCHITECTURE.md:91-123`). Não se inferiu que o script atende todas as entradas JSON.
- **CONTROL — serviço health:** Compose define healthcheck HTTP na porta 8787 (`compose.yml:213-215`), enquanto `control/Dockerfile` mostrado apenas instala CLI e fica em loop (`control/Dockerfile:1-6`); não se encontrou servidor HTTP nesse Dockerfile. Pode haver fonte antiga ou arquivo fora do escopo. O healthcheck declarado não é comprovado pela imagem presente.
- **Configuração/pastas operacionais:** `orbit.workspace.json` e `control/environments.json` guardam paths locais absolutos; monorepo diz que controle operacional não é versionado em parte e `README-ARCHITECTURE.md` traz caminhos absolutos de host. O uso em outro host/checkout não é portátil por definição. A árvore `.env` real, bancos, estado CONTROL e serviços não foi consultada.
- **Divergência DEV/PROD:** os `run-repository.ts`, `execution.service.ts` e `context-builder.ts` observados não mostraram diff funcional relevante na comparação atual. `prompt-sessions.ts` diverge: helpers/typing e forma das instruções multiagente; PROD também não carrega `multiAgents` no fallback ao reiniciar sessão inexistente (`codex-provider.ts:236-239` em PROD versus DEV). As cópias estão localmente modificadas. A equivalência geral de todas as capacidades entre runtimes permanece não comprovada; não se estendeu comparação completa a Safdoulas/Suindá.

## 9. Perguntas que exigem decisão humana

As premissas de consistência global, edição como evolução, independência da fila, contexto atual, exclusão sem rollback e preservação de custo foram tratadas como requisitos, não são perguntadas novamente.

1. **Card queued editado:** o Orbit deve executar a revisão mais recente automaticamente, cancelar e exigir novo acionamento, ou manter snapshot e avisar? O requisito pede intenção vigente, mas o comportamento operacional exato e a possibilidade de custo/execução duplicada não vêm do código.
2. **Card editado enquanto running:** devemos interromper o Codex, deixar a revisão antiga terminar marcada como obsoleta, ou suspender integração e exigir uma nova revisão? Cada opção afeta cancelamento, cobrança e trabalho parcial.
3. **Resultado concluído após edição concorrente:** pode ser integrado se checks passarem, ou sempre precisa de validação contra a revisão vigente e base atual? Código atual não fixa política.
4. **Limite de paralelismo seguro:** qual prioridade deve prevalecer quando tarefas compartilham projeto/arquivos: diretórios isolados por execução, serialização por projeto, ou paralelismo com integração posterior? Premissa de independência não define a estratégia física nem capacidade disponível.
5. **Gate de integração:** quais verificações devem ser obrigatórias para aceitar alterações concorrentes (testes, compatibilidade de plugin, revisão humana, comparação semântica)? Código oferece checks configuráveis, mas o limiar é decisão do responsável.
6. **Memória de sessão:** em que circunstâncias deve ser descartada quando card ou código muda? Código não pode determinar tolerância a reaproveitamento versus custo de sessão nova.
7. **Retenção após hard delete:** que evidência de execução/commit deve permanecer e por quanto tempo, preservando privacidade? Atual cascata remove links e runs, mas a política de retenção é produto/governança.
8. **RAG compartilhado:** quais fontes podem ser compartilhadas entre workspaces/produtos, quem autoriza candidatos e qual fonte vence conflitos? O serviço exige candidatos do host e não define política global.

## 10. Evidências adicionais necessárias

| Dúvida residual | Evidência segura específica para responder |
|---|---|
| Comportamento de edição/S1/S2 | Testes API/UI isolados com DB descartável e executor Codex fake bloqueável; registrar prompt, `updated_at`, status e retorno à UI. Não usar banco/serviço real. |
| Locks cruzados e filesystem S4/S5 | Harness de dois processos com raiz `mkdtemp` descartável e DB PostgreSQL efêmero, instrumentando aquisição de advisory locks e snapshots antes/depois. Não executar Git commit no repositório de trabalho. |
| Versão base/branch atribuída ao run | Inspecionar schema de run e eventuais writers em todos os runtimes; prova definitiva requer fixture que registra `git rev-parse HEAD` antes/depois sem tocar checkout real. |
| Continuidade de sessão/MCP | Rodar CLI substituta/fake com `CODEX_BIN` em sandbox que capture argv/env/stdin e HOME temporário, omitindo token/arquivo auth. Para MCP real, consultar apenas configuração sanitizada/nomes, nunca valores secretos. |
| RAG produtivo | Busca de dependências/imports em todos plugins/runtimes e teste host consumer isolado que capture prompt resultante; não basta validar tabela ou export. |
| Freshness e isolamento do BM25 | Specs `tools/orbit/knowledge.test.mjs` em fixture `tmpdir` com config fake e sem escrita Git; confirmar que os comandos de teste não resolvem raiz real. Se essa pré-condição não for demonstrada, não executar. |
| Cascades e rollback após exclusão | Integração com banco descartável confirmado por URL/container isolado; fixtures de Git somente em diretório temporário. Não utilizar `git.workflow.spec.ts` no workspace real, pois o teste faz commits/reverts no fixture e testes de integração do pacote dependem de DB. |
| Estado real do CONTROL | Confirmar arquivo Compose resolvido e serviço/container atual somente por leitura; inspecionar labels/image digest e build metadata sem `docker compose up/build/restart`. Confirmar qual arquivo foi usado na última criação. |
| Portabilidade de caminhos | Inventariar JSON/YAML e scripts com paths absolutos sem abrir `.env`, auth, secrets ou DB; comparar caminhos resolvidos no Compose, workspace e documentação. |
| Equivalência DEV/PROD/Safdoulas/Suindá | Comparar hashes/diffs apenas dos componentes relevantes e sua configuração de testes; separar diferença intencional de divergência acidental. A análise atual só aprofundou DEV/PROD. |

## 11. Conclusão técnica

| Tema | Classificação | Motivo |
|---|---|---|
| Versionamento de cards | **NECESSITA DECISÃO DO RESPONSÁVEL** | A lacuna técnica está confirmada (edição in-place, sem revision guard). Falta política de queued/running, obsolescência e impacto de custo. |
| Contexto atualizado e versionado | **SUFICIENTE PARA PROJETAR** | Os dois builders e as fontes/fingerprints estão mapeados; não existe pin de card revision/HEAD. Uma especificação de manifesto de contexto e freshness pode ser desenhada sem reconstruir registries/builders. Política de sessão e stale ainda pede decisão humana. |
| Comunicação Orbit ↔ Codex | **NECESSITA MAIS EVIDÊNCIA TÉCNICA** | JSONL, sessão, eventos e pergunta/resposta estão claros; a configuração MCP efetiva no prompt provider e todo canal de tool call não estão comprovados. |
| Consistência entre cards | **NECESSITA MAIS EVIDÊNCIA TÉCNICA** | A assimetria entre filas e falta de worktree são claras estaticamente, mas concurrency multiprocessos e efeito de snapshot/rollback requerem harness isolado antes de desenhar garantias. |
| Reconciliação estado desejado/observado | **SUFICIENTE PARA PROJETAR** | Builders, hashes, checks e ausência de reconciliador foram identificados. Não há mecanismo existente equivalente a reconstruir; requisitos do responsável definem a direção, embora critérios de gate dependam de decisão humana. |
| RAG compartilhado | **NECESSITA MAIS EVIDÊNCIA TÉCNICA** | Serviço vetorial e busca BM25 existem; consumidor operacional de `.rank()` não foi localizado. Precisa comprovar usos em todos plugins e definir escopos de autorização. |
| Integração de alterações concorrentes | **NECESSITA MAIS EVIDÊNCIA TÉCNICA** | O gate Git cobre diff/stage/commit, mas não as duas filas nem writer concorrente. Falta teste seguro e confirmação de estados do CONTROL/árvore para caracterizar a execução real. |
| Rollback com rastreabilidade | **SUFICIENTE PARA PROJETAR** | Undo/redo, condições e cascades estão identificados. Hard delete remove vínculo de card; a necessidade de retenção/correlação pode ser projetada, sujeita à decisão sobre política de auditoria. |

**Conclusão:** os relatórios, acrescidos desta validação estática, já permitem desenhar um modelo-alvo sem recriar o que existe: executar cada demanda com identidade versionada; reutilizar Project Registry, builders, checks, quota, eventos e revisão Git; fechar a coordenação entre filas e estado do projeto; e manter exclusão administrativa separada de rollback. Antes de prometer garantias de concorrência ou integração, é necessário validar os cenários S4/S5 com infraestrutura descartável e resolver a assimetria observada. As escolhas sobre tratamento de edição ativa, custo e retenção permanecem com o responsável. Nenhum teste ou comportamento de runtime foi afirmado como aprovado.
