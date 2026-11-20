# Validação operacional e fechamento de lacunas técnicas

**Data:** 2026-11-13  
**Escopo:** investigação complementar dos mecanismos para consistência entre cards, contexto, execução Codex e integração concorrente.  
**Classificação usada:** `CONFIRMADO POR TESTE ISOLADO`, `CONFIRMADO POR INSPEÇÃO ESTÁTICA`, `INFERIDO — NÃO TESTADO` e `NÃO DETERMINADO`.

## 1. Resumo executivo

Foi possível reproduzir, com a função real de captura de escopo e somente em diretório temporário, interferência destrutiva entre duas execuções concorrentes. A captura usa um snapshot do diretório inteiro por execução: a verificação de uma execução pode interpretar os arquivos da outra como alterações fora do escopo e restaurá-los; o rollback também restaura qualquer caminho alterado desde seu snapshot, sem atribuição ao executor. Este risco está **confirmado por teste isolado**.

A leitura do código também confirma que os prompts e runs guardam conteúdo capturado, mas não guardam uma revisão do card nem validam essa revisão ao concluir. A execução antiga pode persistir `success` depois de edição, e a interface apresenta o resultado da execução mais recente sem um indicador de obsolescência. A interação temporal com banco e workers não foi reproduzida.

Os workers têm mecanismos de coordenação diferentes. A fila de prompts mantém advisory locks por cartão e caminho de projeto durante a execução; a fila genérica usa `SKIP LOCKED` ao reivindicar trabalho, mas não mantém lock de projeto durante a execução. A fila genérica evita iniciar enquanto existe qualquer run de IA enfileirado/em execução; a fila de IA não verifica se já existe uma execução genérica ativa. Os efeitos entre instâncias e bancos compartilhados permanecem **inferidos — não testados**, pois não foi usada instância PostgreSQL descartável comprovada.

Há componentes aproveitáveis para contexto versionado: recursos `.orbit` são carregados com hash SHA-256, e o `ContextBuilder` reúne card, regras, skills, arquivos e cartões relacionados. Isso não é, por si só, uma revisão transacional do contexto: o hash não é vinculado ao run, ao HEAD ou a uma versão do card para validar compatibilidade na conclusão ou retomada.

O serviço vetorial recebe candidatos que o chamador deve autorizar, mas a busca de consumidores não encontrou chamada operacional de `rank()` nos fluxos de prompt em DEV/PROD. O mecanismo depende da API de embeddings quando faltam vetores e também para vetorizar a consulta. As ferramentas locais de conhecimento podem ser reutilizadas sem API quando explicitamente invocadas, mas não há evidência de injeção automática delas nos prompts de cartão.

**Parecer:** há evidência suficiente para iniciar o desenho técnico detalhado, desde que o desenho trate como riscos confirmados a falta de revisão/freshness dos runs e a restauração cruzada de arquivos. Garantias de concorrência entre workers precisam de validação posterior em PostgreSQL descartável. Não foi implementada nenhuma funcionalidade.

## 2. Ambiente e garantias de isolamento

- Repositório examinado: monorepo Orbit em `/home/meada/projetos/orbit`, branch única `main`, HEAD `d9307b8` no início da investigação.
- `git status --short` estava vazio antes da escrita autorizada deste relatório. Nenhum comando Git que alterasse metadados ou arquivos foi executado.
- Não foram iniciados, reiniciados ou interrompidos serviços; não houve acesso a bancos, Docker, APIs de modelos, Codex real, MCP real ou credenciais.
- Não foram executados builds, migrações ou a suíte de testes do projeto.
- O único teste executado importou `captureFileScope` real de `forge/app/apps/api/src/execution/file-scope.ts` com o `tsx` já instalado em DEV. O harness criou um diretório sintético sob `/tmp`, sem cópia ou acesso de escrita à árvore do Orbit, e removeu o diretório temporário em `finally`. O diretório descartável não permaneceu após o teste.
- O harness foi um script pontual e seus resultados são reproduzíveis a partir dos cenários descritos na seção C; não foi uma suíte do repositório.
- Não foi executado PostgreSQL descartável. Não foi executado Codex fake: o provider chama `prepareOrbitCodexHome()`, que cria diretório `.orbit/sessions` sob a aplicação e pode vincular o `auth.json` global se existir (`forge/app/apps/api/src/codex-home.ts:5-32`). Sem isolamento por injeção de diretórios/executor previamente demonstrado, o fake não foi iniciado.

## 3. Resultados dos experimentos A–F

### A — Edição e versionamento operacional

**Objetivo.** Determinar quando o texto do card é capturado, o que é persistido e se uma edição pode tornar um resultado obsoleto sem ser detectada.

**Arquivos e símbolos.** `forge/app/apps/api/sql/schema.sql` (tabelas `cards` e `card_ai_runs`); `forge/app/apps/api/src/main.ts` (`Service.updateCard`, rota `PATCH /cards/:id`); `forge/app/apps/api/src/execution/run-repository.ts` (`enqueue`, `finish`); `forge/app/apps/api/src/plugins/ai/prompt-sessions.ts` (`execute`, construção de prompt e persistência); `forge/app/apps/web/components/card-dialog.tsx` (`aiLocked`, edição de título/descrição e `CardPromptSummary`).

**Método e isolamento.** Inspeção estática. A1–A3 não foram reproduzidos com executor fake e banco, porque não havia PostgreSQL descartável comprovado e a execução de serviços/testes em banco real está proibida.

**Resultado e evidência.**

- **A1 — card enfileirado e depois editado:** a fila genérica grava `config` e `{id,title,description}` no `input` de `card_runs` no enqueue (`run-repository.ts:10-15`); o worker executa usando esse snapshot (`execution.service.ts:104-115`). Para prompts, a rota constrói o prompt e insere `card_ai_runs` como `queued` em `prompt-sessions.ts:413-485`; o callback posterior usa valores capturados por `execute` (`:490-517`). Não há reconsulta/comparação da revisão do card antes da execução. Portanto, o texto que entra é o capturado no momento da criação do run/prompt, não necessariamente o texto atual no momento em que o worker começa.
- **A2 — edição durante execução:** `PATCH /cards/:id` atualiza a linha do card e `updated_at`, sem compare-and-swap de revisão ou bloqueio baseado em run ativo (`main.ts:881-963,1303-1305`; schema `schema.sql:103-114`). A interface mantém edição do título via `onBlur` (`card-dialog.tsx:335-358`); o botão comum de salvar descrição não é bloqueado por `aiLocked`, embora “Salvar e executar” seja (`:525-545`). A proteção visual de execução não impede todas as edições.
- **A3 — execução antiga termina após edição:** `card_ai_runs` persiste prompt, estado, sessão e resultados, sem campo de revisão do card ou HEAD no schema (`schema.sql:426-462`). O caminho de sucesso grava `status='success'` sem verificar se o texto/revisão mudou (`prompt-sessions.ts:549-568`). A fila genérica também conclui por status do run sem validar revisão (`run-repository.ts:20-40`). Assim, uma execução obsoleta pode ser persistida como `success`.
- **Interface:** `CardPromptSummary` seleciona o run não relacionado a comentário mais recente e mostra “Resultado do último prompt” (`card-dialog.tsx:89-140`), sem rótulo de resultado desatualizado ligado a edição. “Mais recente” descreve a ordem do run, não prova que o resultado corresponde à revisão atual nem que foi integrado ao HEAD.
- **Pontos de extensão para revisão:** `cards.updated_at` já é atualizado, mas não é capturado/checado pelo run; `card_runs.input` e `card_ai_runs` são pontos de persistência onde uma revisão poderia ser registrada; a transição terminal de sucesso em `RunRepository.finish` e em `PromptSessionsService` são pontos onde a compatibilidade poderia ser decidida. A política não foi implementada.

**Classificação.** `CONFIRMADO POR INSPEÇÃO ESTÁTICA` para captura, falta de revisão, possibilidade de sucesso obsoleto e apresentação sem freshness; `INFERIDO — NÃO TESTADO` para a ordem temporal observada em execução real.

**Limitações e implicação.** Não se mediu corrida real entre PATCH e worker. A especificação deverá definir se editar cancela, invalida, permite terminar com selo de revisão antiga ou gera nova execução; também deverá distinguir sucesso do executor de integração/atualidade do código.

### B — Coordenação das filas

**Objetivo.** Analisar locks de `card_runs` e `card_ai_runs`, concorrência por projeto e coordenação entre os dois caminhos.

**Arquivos e símbolos.** `forge/app/apps/api/src/execution/run-repository.ts` (`enqueue`, `claim`); `forge/app/apps/api/src/execution/execution.service.ts` (poller, `tick`); `forge/app/apps/api/src/plugins/ai/prompt-sessions.ts` (enqueue e worker de prompts).

**Método e isolamento.** Rastreamento estático das consultas SQL e do ciclo de worker. Não houve execução com duas instâncias nem PostgreSQL descartável; portanto, nenhum resultado de ordem temporal é apresentado como teste.

**Resultado e evidência.**

- `card_runs.enqueue` usa `pg_advisory_xact_lock(hashtext(card.id))`; é lock transacional durante enqueue, não lock de execução. A verificação do enqueue bloqueia runs genéricos queued/running e runs de IA running, mas não runs de IA queued (`run-repository.ts:10-15`).
- O worker genérico reivindica com `FOR UPDATE SKIP LOCKED`; o `NOT EXISTS` da consulta impede reivindicar qualquer run genérico enquanto houver algum `card_ai_runs` em `queued` ou `running`, sem limitar a consulta ao mesmo cartão/projeto/usuário (`run-repository.ts:18`). O serviço tem flag `active` apenas local ao processo e polling a cada 2 s (`execution.service.ts:22-38`). `SKIP LOCKED` separa reivindicações de linhas entre workers, mas a consulta não demonstra exclusão por projeto nem impede duas instâncias de executar runs diferentes no mesmo diretório.
- A fila de IA cria o run queued em `prompt-sessions.ts:475-485`. O worker mantém advisory lock por `orbit-ai-card:${cardId}` e outro por `orbit-ai-project:${localPath}` durante a execução (`:490-507`), ordenando runs de IA do mesmo cartão e serializando projetos cujo caminho coincida entre processos que compartilham o mesmo PostgreSQL.
- A fila de IA não verifica generic `card_runs` running antes de adquirir locks e iniciar. Logo, é possível pelo código que um run de IA comece enquanto um genérico já está ativo. O lock transacional de enqueue não persiste até a execução e não fecha essa janela.
- Os dois caminhos têm escopos de lock diferentes. Não existe no código analisado um lock comum de execução que faça ambos aguardarem um ao outro. Os processos podem gravar no mesmo diretório se configurados para o mesmo projeto/caminho.
- A fila genérica possui quota Codex no claim e conclusão (`run-repository.ts:18,20-22`); a coordenação futura deve preservar essas verificações.

**Classificação.** `CONFIRMADO POR INSPEÇÃO ESTÁTICA` para escopo/uso dos locks e assimetria entre filas; `INFERIDO — NÃO TESTADO` para corrida efetivamente ocorrida entre múltiplas instâncias, escrita simultânea e ordem temporal.

**Limitações e implicação.** O banco é parte do mecanismo de coordenação; sem PostgreSQL descartável, não se comprovou o comportamento operacional de advisory locks nem o efeito de perda de conexão durante a execução. A especificação pode partir de um coordenador comum por projeto/cartão, mas a escolha entre exclusão, worktree por run ou serialização precisa considerar throughput e isolamento.

### C — Isolamento de arquivos e rollback

**Objetivo.** Verificar snapshot, captura de escopo e restauração em C1–C4.

**Arquivos e símbolos.** `forge/app/apps/api/src/execution/file-scope.ts` (`validateWriteScope`, `captureFileScope`, `snapshot`, `changes`, `restore`, `verify`, `rollback`).

**Método e isolamento.** Teste isolado da função real importada do código, contra dois harnesses em diretórios sintéticos temporários distintos. Apenas arquivos sintéticos foram escritos. Nenhum arquivo do repositório foi objeto da captura; cleanup executado em `finally`.

**Resultado observado.**

- **C1 — dois executores em arquivos diferentes:** ambos tiraram snapshot do mesmo estado-base e cada um escreveu em arquivo autorizado distinto. A verificação do primeiro tratou o arquivo do segundo como inesperado, restaurou-o e lançou erro; a verificação do segundo passou então a tratar o arquivo do primeiro da mesma forma. Os dois perderam suas alterações e ambos falharam.
- **C2 — mesmo arquivo:** com ambos autorizando o mesmo caminho, cada verificação aceitou a alteração do caminho como pertencente ao escopo. A função não consegue atribuir qual escrita prevaleceu ou qual executor produziu o conteúdo final.
- **C3 — rollback concorrente:** A tirou snapshot; B criou/alterou arquivo fora do escopo de A; o rollback de A calculou todos os caminhos diferentes do snapshot e removeu/restaurou também o arquivo de B.
- **C4 — estado preexistente:** arquivo sujo já existente e não tocado durante a captura não é reportado como alteração. Se esse mesmo arquivo é modificado durante a execução, `changes()` reporta o caminho inteiro, mas não separa o delta anterior da alteração nova. O snapshot é relativo ao início da execução, não ao HEAD ou ao estado limpo do Git.

Esses resultados decorrem do snapshot completo (`file-scope.ts:22-43`), da restauração de cada caminho inesperado ao snapshot privado (`:45-59`) e do rollback de todos os caminhos que diferem do snapshot (`:59`).

**Classificação.** `CONFIRMADO POR TESTE ISOLADO` para C1–C4 conforme os cenários acima.

**Limitações e implicação.** O teste comprova o algoritmo em diretórios descartáveis; não exercitou dois processos Codex reais nem o executor que o chama. O mecanismo funciona para validar escopo com escritor exclusivo, mas não é isolamento por execução. Um coordenador não deve permitir que múltiplos agentes compartilhem o mesmo diretório mutável enquanto snapshot/rollback global forem usados. As opções arquiteturais incluem exclusividade por projeto ou workspace isolado por run; a decisão não foi tomada.

### D — Continuidade de sessão Codex

**Objetivo.** Determinar compatibilidade verificada antes de retomar uma sessão após mudanças no card, arquivos, branch/HEAD ou contexto.

**Arquivos e símbolos.** `forge/app/apps/api/src/plugins/ai/prompt-sessions.ts` (seleção de sessão e construção de prompt); `forge/app/apps/api/src/plugins/ai/codex-provider.ts` (argumento `resume`); `forge/app/apps/api/src/execution/context-builder.ts`; `forge/app/apps/api/src/execution/project-registry.ts`.

**Método e isolamento.** Inspeção estática. O Codex CLI fake solicitado não foi iniciado: a preparação atual de HOME pode escrever `.orbit/sessions` no projeto e criar link para armazenamento global. Não foi feita cópia funcional ou injeção isolada que demonstrasse previamente ausência de efeitos no repositório e no estado global.

**Resultado e evidência.** O fluxo seleciona sessão anterior pelo cartão e projeto, ou a sessão salva na resposta a uma pergunta (`prompt-sessions.ts:402-405,506-507`); o provider passa `resume <sessionId>` ao CLI (`codex-provider.ts:118-128`). Não foi encontrada comparação de revisão do card, hash do prompt/contexto, branch ou HEAD antes da retomada. A construção do contexto lê recursos atuais selecionados, calcula hashes dos recursos e os coloca no conjunto `resources` (`context-builder.ts:26-51`; `project-registry.ts:68-79`), mas essa informação não é usada para rejeitar ou reiniciar uma sessão anterior. O prompt também orienta conferir arquivos e verificações atuais (`prompt-sessions.ts:447-448`), o que é instrução textual, não uma garantia técnica de compatibilidade.

**Classificação.** `CONFIRMADO POR INSPEÇÃO ESTÁTICA` para o identificador usado na retomada e ausência das comparações citadas; `NÃO DETERMINADO` para os argumentos/saída de um CLI fake e comportamento observado com mudança real de branch/HEAD.

**Limitações e implicação.** Não se deve tratar a sessão como memória consistente de uma revisão. Um desenho pode incorporar uma política de compatibilidade no ponto em que `previousSessionId` é selecionado e antes do provider executar, associando a sessão a revisão do card, fingerprint dos recursos/contexto e identidade do checkout. A decisão entre rejeitar, reiniciar ou permitir retomada com aviso é de produto.

### E — MCP e comunicação bidirecional

**Objetivo.** Comparar executor genérico e provider de prompt quanto a HOME, MCP, eventos e consulta ao contexto.

**Arquivos e símbolos.** `forge/app/apps/api/src/execution/codex-executor.ts`; `forge/app/apps/api/src/plugins/ai/codex-provider.ts`; `forge/app/apps/api/src/codex-home.ts`; `forge/app/apps/api/src/plugins/ai/prompt-sessions.ts` e `prompt-question.ts`.

**Método e isolamento.** Inspeção estática; nenhuma configuração MCP real, arquivo de usuário, token, modelo ou executor foi carregado. Nenhum fake foi executado pelas razões explicadas em D.

**Resultado e evidência.**

- **Executor genérico:** monta processo Codex com `CODEX_HOME` preparado e passa `--ignore-user-config` e `-c mcp_servers={}` (`execution/codex-executor.ts:22-34`). O caminho desabilita explicitamente a configuração do usuário e servidores MCP.
- **Prompt sessions:** o provider chama `prepareOrbitCodexHome()` e passa `CODEX_HOME`, mas o comando apresentado não inclui `--ignore-user-config` nem `mcp_servers={}` (`codex-provider.ts:95-130`). O helper prepara `.orbit/sessions` e pode vincular o `auth.json` do Codex global (`codex-home.ts:5-32`). Não foi possível confirmar se o HOME resultante contém ou carrega definição MCP; configuração efetiva não foi inspecionada por segurança e não há teste sanitizado.
- Portanto, o provider de prompt tem processo e HOME configuráveis em algum grau, mas o caminho verificável para carregar uma configuração MCP personalizada não está comprovado pelo código/teste aqui. O caminho genérico confirma desabilitação intencional. Não se deve inferir que ambos oferecem as mesmas ferramentas.
- Retorno ao Orbit no provider inclui eventos JSONL processados como progresso, `thread_id`/session id, atividades de comando, deltas de saída e alterações de arquivo (`codex-provider.ts:172-216,228-239`); `PromptSessionsService` persiste saída, atividades, arquivo alterado e estado e publica eventos de progresso (`prompt-sessions.ts:519-568`). Pergunta/resposta humana usa estados de execução e resposta via rota específica (`prompt-question.ts:4-15`; `prompt-sessions.ts:397-405,538-546`).
- No executor genérico, MCP não é a consulta ao contexto: o `ContextBuilder` monta e envia como instrução textual os recursos autorizados selecionados antes de executar (`execution/context-builder.ts:26-51`). Na sessão de prompt, o contexto é igualmente montado no prompt; não foi achada uma ferramenta estruturada de Context Bridge que deixe o Codex consultar dinamicamente contexto versionado do Orbit durante a execução.

**Classificação.** `CONFIRMADO POR INSPEÇÃO ESTÁTICA` para as flags do executor genérico e os eventos/canais explicitamente implementados; `NÃO DETERMINADO` para carregamento efetivo de MCP customizado pelo provider de prompt e para a configuração real de HOME sem teste sintético.

**Limitações e implicação.** Não há bloqueio físico demonstrado ao Context Bridge; falta um contrato/protocolo Orbit explícito e comprovável para chamadas estruturadas de consulta/ação durante a execução. Antes de especificar o bridge, é preciso escolher descoberta de ferramentas, autenticação por execução, escopo de permissões, versionamento de contexto, timeout/auditoria e como desativá-lo no caminho genérico.

### F — Uso operacional do RAG

**Objetivo.** Localizar consumidores lexicais/vetoriais, autorização de candidatos, injeção e dependência de API.

**Arquivos e símbolos.** DEV/PROD: `apps/api/src/plugins/ai/knowledge-retrieval.ts`, `ai.plugin.ts`, `embeddings.ts`, specs; `apps/api/src/execution/development-policy.ts`; `apps/api/src/execution/project-registry.ts`; `apps/api/src/execution/context-builder.ts`; raiz do monorepo `tools/orbit/knowledge.mjs` e seus testes.

**Método e isolamento.** Busca estática de símbolos/referências em DEV, PROD, Safdoulas e Suindá; leitura dos serviços e do pipeline de contexto. Nenhum embedding foi chamado e nenhuma API remota foi acessada.

**Resultado e evidência.**

- O `OrbitKnowledgeRetrievalService.rank(scope, query, candidates)` é exportado pelo plugin, recebe candidatos fornecidos pelo chamador e não busca nem autoriza conteúdo do host por conta própria (`forge/app/apps/api/src/plugins/ai/knowledge-retrieval.ts:24-35`; `ai.plugin.ts:13-15`). Isso oferece um ponto reutilizável se o host montar candidatos já autorizados. A busca não encontrou consumidor operacional de `.rank()` nos códigos de API de DEV/PROD; referências encontradas no runtime foram a exportação/definição e testes, não injeção do resultado em prompt.
- O serviço mantém vetores por escopo workspace/plugin/collection/model, usa hash SHA-256 do conteúdo e apaga vetores que saem da lista atual (`knowledge-retrieval.ts:47-89`). Isso invalida conteúdo ausente do conjunto fornecido, mas não associa resultado a card, commit ou revisão de execução.
- O serviço vetorial só fica disponível com `ORBIT_AI_EMBEDDINGS_ENABLED=true` e chave configurada; embeddings ausentes e a consulta são enviados a `https://api.openai.com/v1/embeddings` (`embeddings.ts:3-24`; `knowledge-retrieval.ts:67-93`). Cache de vetor de documento pode evitar re-embedding daquele documento, mas não elimina a chamada para vetorizar a query. Não é uma opção sem custo de API para uso operacional.
- `ProjectRegistry` carrega documentos `.orbit` selecionados e lhes calcula hash SHA-256 (`project-registry.ts:45-79`); `ContextBuilder` injeta regras/knowledge, arquivos e cartões relacionados no prompt com seus identificadores/hashes (`context-builder.ts:26-51`). Isso é seleção explícita de recursos de contexto, não recuperação semântica automática nem prova de que os recursos foram buscados por relevância.
- `development-policy.ts` orienta a execução a usar `knowledge query/context` filtrado pelo produto, e as ferramentas locais estão em `tools/orbit/knowledge.mjs`. Sua indexação/consulta lexical local pode ser executada sem API de embeddings quando explicitamente chamada. A busca não encontrou consumidor automático no pipeline de prompt; a política escrita é orientação para o agente, não integração invocada pelo host. O fluxo local não cria por si só vínculo transacional entre resultado, card e commit.

**Classificação.** `CONFIRMADO POR INSPEÇÃO ESTÁTICA` para interfaces, dependência de API, composição do contexto e ausência de consumidor localizado na busca indicada; `NÃO DETERMINADO` para consumidores dinâmicos que possam existir fora dos caminhos/símbolos pesquisados.

**Limitações e implicação.** Ausência de referência encontrada não prova inexistência global em todo sistema externo. Para RAG compartilhado local, a ferramenta lexical e o catálogo de recursos `.orbit` são reutilizáveis, mas é preciso definir autorização, filtro por produto, proveniência/hash, data de validade e comportamento quando não houver resultado. O serviço vetorial precisa de decisão de custo/provedor e um consumidor explícito.

## 4. Matriz de evidências

| Experimento | Classificação principal | Executado nesta investigação? | Evidência principal |
|---|---|---:|---|
| A — revisão do card | `CONFIRMADO POR INSPEÇÃO ESTÁTICA`; corrida temporal `INFERIDO — NÃO TESTADO` | Não | Snapshot de enqueue e sucesso sem revisão; resultado sem freshness. |
| B — coordenação de filas | `CONFIRMADO POR INSPEÇÃO ESTÁTICA`; corrida entre instâncias `INFERIDO — NÃO TESTADO` | Não | Locks e consultas SQL de `run-repository.ts` e `prompt-sessions.ts`. |
| C — arquivos/rollback | `CONFIRMADO POR TESTE ISOLADO` | Sim | Harness com a função real `captureFileScope` e arquivos temporários C1–C4. |
| D — continuidade de sessão | `CONFIRMADO POR INSPEÇÃO ESTÁTICA`; resposta do CLI fake `NÃO DETERMINADO` | Não | Busca de session id sem validação de revisão/fingerprint/HEAD. |
| E — MCP/bridge | `CONFIRMADO POR INSPEÇÃO ESTÁTICA`; configuração efetiva no provider `NÃO DETERMINADO` | Não | Flags do executor genérico, HOME/comando do provider e eventos publicados. |
| F — RAG | `CONFIRMADO POR INSPEÇÃO ESTÁTICA`; possíveis consumidores externos `NÃO DETERMINADO` | Não | Busca de usos e leitura da recuperação vetorial, índice lexical e pipeline. |

## 5. Riscos confirmados e não reproduzidos

### Confirmados

1. **Perda cruzada de arquivos por snapshot/rollback concorrente**: reproduzida em C1 e C3 com a função real.
2. **Ausência de revisão vinculada ao conteúdo capturado pelo run**: código captura texto, mas não valida se ainda é atual na conclusão.
3. **Resultado antigo apresentado como último resultado sem indicador de obsolescência**: confirmado no seletor/renderização da interface.
4. **Assimetria de coordenação entre filas**: confirmada por SQL; a fila de IA não consulta generic run ativo enquanto o generic worker consulta globalmente status de IA.
5. **Retomada sem verificação de compatibilidade da sessão**: não compara o identificador da sessão a revision/hash/branch/HEAD/contexto no código analisado.
6. **Busca vetorial sem consumidor do fluxo de prompt localizado** e dependente de embedding externo para query e novos conteúdos.

### Não reproduzidos operacionalmente

- Corrida entre atualização de card e claim/conclusão real de execução.
- Interleaving de filas com duas ou mais instâncias e advisory locks no PostgreSQL.
- Escrita simultânea no projeto por dois workers reais.
- Retomada Codex após mudança de branch, HEAD ou documentos de contexto.
- Carregamento de configuração MCP sintética e sanitizada no provider de prompt.
- Injeção de recuperação lexical ou vetorial em uma execução real/fake controlada.

Os riscos de A, B, D e parte de E/F são sustentados por código, mas não devem ser descritos como resultados de execução operacional.

## 6. Componentes existentes que podem ser reutilizados

- `cards.updated_at` é um sinal existente de mudança, embora uma revisão monotônica explícita seja mais adequada para compare-and-swap e snapshots.
- `card_runs.input` e `card_ai_runs.prompt` preservam parte do input usado; podem receber metadados de versão/fingerprint no futuro, com migração e política de retenção.
- `ProjectRegistry` calcula hashes de recursos `.orbit`; `ContextBuilder.resources` já reúne recursos e hashes. São bons pontos de partida para fingerprint de contexto, desde que a lista completa e sua versão sejam persistidas por execução.
- Advisory locks PostgreSQL já são usados pela fila de prompts para serializar por cartão/projeto. São mecanismos existentes possíveis para uma coordenação comum, mas o lock de arquivo/snapshot precisa também considerar diretórios/caminhos e lifecycle de workers.
- `captureFileScope` valida paths, exclui diretórios gerados, detecta alterações no working tree e aplica escopo. É reutilizável como **verificador de escopo sob escritor exclusivo**; teste C demonstra que não pode ser tratado como isolamento concorrente ou rollback por autor.
- Há retorno persistido de progresso, arquivo alterado, atividades, sessão e estado na execução de prompts. Isso pode ser mantido como telemetria/eventos do futuro bridge, sem confundir progresso com autorização ou integração.
- O índice lexical `tools/orbit/knowledge.mjs` e os documentos selecionados de `.orbit` são alternativas locais sem chamada de embeddings, se forem chamados explicitamente e filtrados por autorização/produto.
- `OrbitKnowledgeRetrievalService` pode ser reutilizado como ranking vetorial quando um host fornecer candidatos já autorizados; no estado examinado, exige decisão de API/custo para embeddings.

## 7. Pontos de integração identificados no código

| Necessidade | Ponto existente para especificação futura | Limite atual |
|---|---|---|
| Revisão do card | `Service.updateCard`; `RunRepository.enqueue`; `PromptSessionsService.execute`; transições de sucesso de ambos workers | Sem revisão CAS nem freshness terminal. |
| Coordenador comum | `RunRepository.claim`; worker de `PromptSessionsService` antes de `status='running'`; locks já usados por projeto/cartão | Lock genérico não é mantido durante execução; sem contrato comum entre filas. |
| Isolamento do checkout | `captureFileScope` na fronteira de execução e seleção de `workingDirectory` | Snapshot global e restauração não identificam o autor; concorrência destrutiva demonstrada. |
| Sessão/contexto versionados | seleção de `previousSessionId`; callback de persistência da sessão; `ProjectRegistry.document`; retorno `ContextBuilder.resources` | Não há fingerprint vinculado/validado antes de `resume`. |
| Context Bridge/MCP | montagem do comando em `CodexExecutor` e `CodexAiService`; `progress`/eventos de `PromptSessionsService` | Generic desabilita MCP; provider não comprova uma configuração isolada/customizada; eventos não equivalem a RPC de contexto. |
| RAG | serviço vetorial exportado, montagem dos candidatos pelo host, `tools/orbit/knowledge.mjs`, `ContextBuilder` | Não foi localizado consumidor de ranking no caminho operacional de prompt; vínculo a card/commit ausente. |
| Integration Gate | estado terminal em `RunRepository.finish`/`PromptSessionsService` e evidências de checks/arquivos | `success` do run não significa compatibilidade, merge ou validação do conjunto de mudanças. |
| Reconciliação desejado/observado | estado persistido de run/card e hashes de recursos | Não foi encontrado reconciliador que invalide contexto/resultados quando fontes mudam. |

## 8. Questões técnicas ainda abertas

1. Qual unidade deve ser exclusiva: cartão, projeto, diretório de trabalho ou worktree por execução? Como garantir a mesma regra para os dois workers e suas instâncias?
2. Ao editar card durante execução, o sistema cancela, marca a execução como obsoleta, aceita conclusão identificada por revisão ou cria nova execução automaticamente?
3. Que fontes entram no fingerprint: título/descrição/checklists/comentários, configurações, skills/regras, arquivos selecionados, permissões, branch/HEAD, diff inicial e versões de plugins?
4. A sessão Codex continua válida se somente arquivos externos forem alterados? E se houver mudança de branch/HEAD que depois retorne ao mesmo hash de contexto?
5. O rollback precisa restaurar um worktree exclusivo ou criar commit/checkpoint rastreável? Quem pode autorizar reaplicação de alterações?
6. O provider de prompt deve permitir MCP por allowlist versionada por projeto, ou usar exclusivamente ferramentas internas do Context Bridge? Como diferenciar permissões do usuário de permissões do agente?
7. RAG compartilhado será lexical local, vetorial externo, ou híbrido com fallback? Qual origem/produto, validade e licença do conhecimento entram na busca?
8. Que condição estabelece `Integration Gate` aprovado: checks obrigatórios, revisão de compatibilidade de plugins, estado limpo do checkout, revisão de card vigente, execução independente e ausência de conflitos?
9. Qual política reconcilia o estado desejado do cartão com o estado observado do workspace sem sobrescrever edições humanas?
10. Quais dados de sessão, prompts, embeddings, snapshots e auditoria têm retenção e descarte por ambiente?

## 9. Decisões que dependem do responsável e infraestrutura

### Decisões do responsável do produto

- Política de edição durante run e semântica de `success`, `stale`, integração e reexecução.
- Unidade de exclusão e experiência de usuário quando uma execução concorrente já ocupa cartão/projeto.
- Política de retomada de sessões incompatíveis e apresentação de resultados antigos.
- Nível de interação bidirecional permitido ao Codex (consulta somente leitura, ações autorizadas, ou ambos) e escopo das permissões.
- Retenção e trilha de auditoria de snapshots, sessões, artefatos e rollback.
- Política de RAG: fontes permitidas entre produtos, prioridade lexical/vetorial e autorização para embeddings externos.

### Infraestrutura necessária para fechar as lacunas operacionais

- Uma instância PostgreSQL efêmera comprovadamente isolada, com schema mínimo/migrations controladas e descarte verificável, para testar interleavings A/B e múltiplas instâncias sem tocar bancos reais.
- Executor fake com injeção explícita de `CODEX_HOME`, diretório de sessão, executável e configuração MCP temporária; o fake deve registrar argumentos sem carregar auth nem chamar modelos.
- Harness multiprocesso para testar lock/heartbeat/queda de worker e contenção entre filas.
- Checkout temporário independente por execução, se a arquitetura for validada com worktrees/diretórios paralelos.

## 10. Parecer de prontidão arquitetural

| Capacidade | Estado | Motivo |
|---|---|---|
| Versionamento de cards | **CONDICIONADA** | Lacuna e pontos de integração estão claros; precisa de decisão sobre edição, revisão obsoleta e significado de sucesso. |
| Contexto e memória versionados | **PRONTA PARA ESPECIFICAÇÃO** | Hashes e composição de recursos existem; é possível especificar fingerprint e vínculo por run. A implementação/validação ainda dependerá de decisões sobre fontes e validade. |
| Comunicação bidirecional Orbit ↔ Codex | **CONDICIONADA** | Há eventos/progresso e pergunta/resposta, mas não Context Bridge estruturado nem configuração MCP customizada comprovada. Não há bloqueio técnico físico demonstrado. |
| Coordenação das filas | **CONDICIONADA** | A assimetria estática foi encontrada e permite desenhar contrato comum; garantias reais entre instâncias requerem PostgreSQL descartável e política de exclusão. |
| Isolamento de execução | **CONDICIONADA** | A validação de escopo é reaproveitável, mas o teste confirmou perda cruzada com concorrência. O desenho precisa escolher escritor exclusivo ou checkout isolado por run. |
| Reconciliação de estado desejado/observado | **PRONTA PARA ESPECIFICAÇÃO** | Não foi localizado reconciliador; os estados e fontes que precisam ser comparados são identificáveis. Definir política de conflito continua decisão de produto. |
| RAG compartilhado | **CONDICIONADA** | Índice lexical local e seleção de recursos podem ser reaproveitados; falta consumidor operacional e decisão de autorização, proveniência e custo vetorial. |
| Integration Gate | **CONDICIONADA** | Os pontos de terminação e evidências de execução existem; `success` atual não comprova integração. Critérios e orquestração ainda precisam ser definidos. |
| Rollback rastreável | **CONDICIONADA** | Há restauração por snapshot, mas sem autoria e segura somente sob exclusividade; teste confirmou risco concorrente. Retenção, checkpoints e auditoria precisam de decisão. |

### Respostas aos critérios de fechamento

1. **Versionamento de cards:** há evidência suficiente para especificar o mecanismo e seus pontos de integração, mas a política de edição e resultado obsoleto depende de decisão do responsável.
2. **Concorrência das filas:** a divergência de coordenação foi confirmada estaticamente; a concorrência operacional entre workers ainda não foi reproduzida e permanece inferida.
3. **Coordenação central:** `RunRepository` é o ponto comum natural para a fila genérica, mas a fila AI precisa compartilhar contrato/coordenador; advisory locks já existentes oferecem uma base, não uma solução completa comprovada.
4. **Isolamento por execução:** há base suficiente para especificar, mas não para declarar seguro o mecanismo atual. C1/C3 demonstram que snapshot/rollback no diretório compartilhado não isolam autores.
5. **MCP personalizado:** não há caminho verificável comprovado no provider de prompt. O comando do executor genérico desabilita config/MCP; a capacidade efetiva do provider é não determinada sem HOME e CLI fake isolados.
6. **RAG sem API adicional:** consulta lexical local explícita e composição de documentos locais `.orbit` são reaproveitáveis sem embeddings remotos. O serviço vetorial não satisfaz esse critério em consultas novas porque vetoriza a query por API.
7. **Context Bridge:** nenhum bloqueio técnico real foi demonstrado. O gap é de protocolo, permissões, lifecycle e teste isolado; o canal atual é prompt textual mais eventos e Q&A limitado.
8. **Sem decisão humana/infraestrutura:** política de edição/freshness, conflitos e retenção dependem do responsável. Corridas de PostgreSQL e carregamento MCP verificável dependem de infraestrutura fake/descartável isolada.

**Conclusão objetiva:** podemos iniciar o desenho técnico detalhado da nova arquitetura. O desenho deve assumir o risco de rollback concorrente como confirmado e planejar revisão de card/contexto, coordenação compartilhada e isolamento por execução. Antes de declarar garantias operacionais de filas, MCP ou retomada de sessão, será necessária uma rodada posterior de validação com PostgreSQL efêmero e executor Codex fake isolado. Nenhuma implementação foi feita nesta investigação.
