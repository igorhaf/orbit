# Fechamento de concorrência, MCP e compatibilidade de versões

**Data:** 2026-11-13
**Escopo:** fechamento direcionado das lacunas para Context Bridge, Project Consistency Engine e execução de cards versionados.
**Classificações:** `CONFIRMADO POR TESTE ISOLADO`, `CONFIRMADO POR INSPEÇÃO ESTÁTICA`, `INFERIDO — NÃO TESTADO` e `NÃO DETERMINADO`.

## 1. Resumo executivo

Os dois snapshots solicitados estão presentes. O HEAD atual é exatamente o commit posterior `d9307b8e6a54316f802acbd7bcb96baa26116f16`; os arquivos rastreados da árvore de trabalho correspondem ao HEAD. A única alteração local já existente antes deste relatório é o relatório 18, não rastreado. A referência é reproduzível como snapshot Git, embora não represente uma sincronização limpa entre fontes compartilhadas e projeções dos ambientes.

A comparação compreende **389 arquivos** (31.112 inserções e 411 remoções), em grande parte a consolidação do monorepo e a adição dos pacotes canônicos `packages/orbit-core` e `packages/orbit-ui`. Nos caminhos da aplicação DEV que implementam filas, captura de escopo, Codex e HOME, não houve alteração entre os commits comparados. O risco concorrente identificado no relatório 18 continua aplicável à implementação que roda nos ambientes.

Há uma nuance importante: a nova fonte canônica de `file-scope` contém regras adicionais para ignorar estado operacional do monorepo, mas essa fonte não está projetada nos quatro ambientes. O inspector compartilhado, executado em modo somente leitura, aponta essas projeções desatualizadas, versão do pacote core sem incremento e divergências independentes em alguns componentes de UI. Portanto, a conclusão do relatório 18 sobre execução DEV continua válida para o runtime atual; o resultado testado não pode ser atribuído como teste da fonte canônica divergente. A fonte canônica mantém a restauração global por snapshot, então o mesmo risco concorrente permanece por inspeção estática.

Uma execução controlada com executável Codex fake e ambiente sanitizado confirmou os argumentos que cada integração entrega ao processo. O provider de prompt não inclui configuração MCP explícita nem `--ignore-user-config`; o executor genérico passa `--ignore-user-config` e `mcp_servers={}`, desabilitando a descoberta. O fake confirmou o HOME preparado inteiramente sob `/tmp`, sem autenticação real. Isso demonstra o comando que o Orbit monta, não que um Codex real carregaria um servidor MCP.

Não foi encontrada infraestrutura PostgreSQL descartável que pudesse ser comprovada sem ler configuração sensível ou arriscar um banco existente. Os testes de integração encontrados carregam `dotenv/config` e usam `DATABASE_URL` ambiente, criando e removendo schemas. Nenhum cenário de filas foi executado.

**Parecer:** sabemos o suficiente para iniciar a implementação incremental do Context Bridge e da camada de consistência, mas não para ativá-los com garantias operacionais. Antes de sincronizar mudanças comuns, é necessário reconciliar as fontes/projeções do snapshot sem perder diferenças intencionais. Antes da ativação, devem ser testadas concorrência em PostgreSQL isolado e interoperabilidade MCP com a versão real do Codex, usando ferramentas e credenciais sintéticas.

## 2. Identificação do repositório e snapshots

- Repositório: `/home/meada/projetos/orbit`.
- Branch atual: `main` (não foi alterada).
- Snapshot anterior confirmado: `0ee35d5e440d6e7fc6c684a8263f9dcecd52b597`.
- Snapshot posterior confirmado: `d9307b8e6a54316f802acbd7bcb96baa26116f16`.
- O commit posterior tem como pai direto o commit anterior; o posterior é o HEAD atual.
- `git diff --quiet HEAD --` retornou sucesso: não há diferença em arquivos rastreados em relação ao HEAD. `git status --short` mostrou somente o relatório 18 preexistente, não rastreado, antes da criação deste arquivo.
- A comparação entre os commits usou apenas comandos Git de leitura (`rev-parse`, `show`, `diff` e consulta de status). Nenhum comando Git alterou branch ou metadados.
- A inspeção de sincronização chamou `inspectShared` de `tools/orbit/shared.mjs`, que calcula hashes e diagnósticos lendo fontes, projeções e locks; não persiste plano nem altera arquivos.
- O teste Codex fake copiou `forge/app/apps/api/src` para diretório temporário `/tmp/orbit-codex-fake-*`, ligou ali as dependências existentes apenas para resolução de módulos e usou um processo com ambiente limpo. O executável fake somente capturou argumentos/`CODEX_HOME` e escreveu resposta fixa. O HOME global sintético estava vazio; nenhum arquivo de credencial foi aberto. O harness e diretórios temporários do provider foram removidos ao final. O teste não acessou banco nem rede.
- O teste PostgreSQL não foi executado. Nenhum banco, serviço ativo, container ou credencial foi consultado.

## 3. Diferenças relevantes entre os commits

### Dimensão da consolidação

`git diff --stat` entre as referências informa 389 arquivos, 31.112 linhas inseridas e 411 removidas. Por diretório superior, são 249 arquivos em `packages/`, 29 em `docs/`, 14 em `tools/`, além de projeções/ajustes de runtimes e arquivos de workspace. A mudança é principalmente a consolidação e registro de fontes compartilhadas, não uma revisão pontual da fila.

### Cards, filas, executores e sessões

- `forge/app/apps/api/src/execution/run-repository.ts`, `file-scope.ts`, `execution.service.ts`, `codex-provider.ts` e `codex-home.ts` não mudaram entre os snapshots. O `RunRepository` da nova fonte `packages/orbit-core/src/execution/run-repository.ts` é byte a byte igual à projeção DEV; `context-builder.ts` também é igual.
- `forge/app/apps/api/src/plugins/ai/prompt-sessions.ts` mudou: inclui orientação de desenvolvimento Orbit por meio de `orbitDevelopmentGuidance` (`forge/app/apps/api/src/plugins/ai/prompt-sessions.ts:2,468-471`). Isso altera o contexto textual das execuções que reconhecem projetos Orbit. Não adiciona revisão do card, fingerprint de contexto, coordenação entre filas ou MCP.
- O módulo compartilhado inclui projeções das implementações de execução e sessões. `packages/orbit-core/src/codex-ai.ts` e `src/prompt-sessions.ts` são exports de compatibilidade para os módulos de IA, não implementações alternativas dessas filas (`packages/orbit-core/src/codex-ai.ts:1-2`; `packages/orbit-core/src/prompt-sessions.ts:1`).

### Contexto, Git e plugins

- O `ContextBuilder` e o `RunRepository` foram adicionados ao pacote compartilhado com conteúdo igual ao código DEV examinado. Recursos de execução existentes continuam sendo os mesmos nos arquivos DEV referidos neste relatório.
- Módulos Git e outros módulos Orbit foram incorporados ao pacote compartilhado e mapeados como projeções. O fluxo de execução de cards analisado não passou a capturar commit-base ou criar worktree nesse diff. O plugin Git já tem consultas de HEAD/branch/commit (`packages/orbit-core/src/git/git.plugin.ts:54,57,198,215,245`), mas elas pertencem ao fluxo Git do produto e não são ligadas automaticamente a cada run.
- Foram acrescentados contratos e verificadores de compatibilidade de plugins e de fontes compartilhadas: `packages/orbit-core/src/plugins/core-compatibility.ts:4-8`, `scripts/verify-plugin-compatibility.mjs:8-15,17-48` e `tools/orbit/shared.mjs:85-120`. O verificador de compatibilidade requer integração de contrato nas quatro projeções; o inspector confere hashes de fontes, projeções e locks.
- Os runtimes receberam também mudanças de simulação de perfil, ajustes de shell e orientações de desenvolvimento. Exemplos no DEV: `forge/app/apps/api/src/access/profile-simulation-context.ts:5-50` e `forge/app/apps/api/src/main.ts:1235,1399-1405`. São mudanças funcionais incluídas no snapshot, mas não alteram a mecânica de versão/concorrência de runs.

### Divergência detectada entre fonte e projeções

`packages/orbit-core/src/execution/file-scope.ts` difere da projeção DEV. A fonte canônica agora exclui diretórios operacionais do monorepo e qualquer diretório `.next*` da captura (`packages/orbit-core/src/execution/file-scope.ts:5-12,27-38`). A projeção DEV ainda usa as exclusões anteriores (`forge/app/apps/api/src/execution/file-scope.ts:5-8,22-35`). As projeções dos quatro ambientes e seus locks mantêm o hash da versão antiga (`{dev,prod,safdoulas,suinda}/app/orbit.shared-lock.json:79`).

O inspector somente leitura confirmou:

- `version-not-bumped` para `@orbit/core-source` em DEV, PROD, Safdoulas e Suindá;
- `file-scope.ts` e seu spec desatualizados em todos os quatro ambientes;
- `local-drift` em `codex-limits.tsx` e `plugin-navigation.tsx` nos quatro ambientes e em `access-shell.tsx` no Safdoulas;
- locks compartilhados desatualizados nos quatro ambientes.

Também foram listadas projeções pendentes para esses mesmos arquivos. Nenhuma sincronização foi feita. A discrepância não é uma hipótese: o cálculo de hashes do inspector comparou as cópias em disco sem alterá-las. O ponto exato da política nova de exclusão é melhoria do escopo de captura; ela **não** muda o fato de que o snapshot/rollback ainda restaura caminhos alterados desde o snapshot sem autoria (`packages/orbit-core/src/execution/file-scope.ts:49-63`).

### Conclusões dos relatórios 17 e 18

- As conclusões de A/B/D/E do relatório 18 continuam compatíveis com a implementação DEV: os arquivos que sustentam aquelas conclusões não mudaram entre os commits.
- C1/C3 foram reproduzidos contra o `captureFileScope` da projeção DEV, que está no HEAD atual. O resultado continua válido para os ambientes atuais. Não repetimos o teste na fonte canônica do pacote; a semântica de restauração por snapshot permanece equivalente por inspeção estática, com diferenças de paths excluídos.
- F permanece compatível: a exportação de serviço vetorial e as referências do pipeline não foram substituídas por um consumidor operacional no diff; o pacote não prova consumo automático.
- A conclusão nova que precisa ser acrescentada é a deriva de fonte/projeções. O HEAD é reproduzível como conjunto de arquivos, mas as projeções não correspondem integralmente às fontes compartilhadas/locks registradas.
- A busca e o diff direcionados não identificaram mudança funcional entre os snapshots em filas, revisão de card, retomada de sessão ou integração de MCP. Foram identificadas as adições de contexto de desenvolvimento Orbit, simulação de perfil e política de captura canônica descritas acima. Não se afirma que todos os 31 mil acréscimos tenham sido auditados semanticamente linha a linha.

**Classificação.** `CONFIRMADO POR INSPEÇÃO ESTÁTICA` para os identificadores, contagens, diffs dos caminhos citados, estado rastreado do HEAD e diagnósticos do inspector. `INFERIDO — NÃO TESTADO` para compatibilidade semântica completa dos 389 arquivos como conjunto executável.

## 4. Resultados da investigação PostgreSQL/filas

### Disponibilidade de infraestrutura segura

Não foi possível demonstrar uma instância PostgreSQL descartável sem recorrer à configuração ativa do Orbit. Há testes de integração que importam `dotenv/config`, criam schema via `process.env.DATABASE_URL` e depois removem o schema. Por exemplo, `forge/app/apps/api/src/execution/execution.integration.spec.ts:1-2,21-27` usa URL ambiente e cria `execution_test_*`; outras suítes repetem o padrão. Esse desenho não comprova que a URL aponte para um banco descartável, e algumas verificações consultam configurações/contêineres existentes. Por segurança, não executamos esses testes nem inspecionamos `.env`, variáveis do processo ou serviços.

**Classificação:** `CONFIRMADO POR INSPEÇÃO ESTÁTICA` para a dependência dos testes de URL ambiente; `NÃO DETERMINADO` para a existência de infraestrutura descartável já preparada fora dos arquivos públicos do repositório.

### Conclusões estáticas que permanecem

- `card_runs.enqueue` usa lock transacional por `card.id` e verifica `card_runs` queued/running e `card_ai_runs` running, mas não `card_ai_runs` queued (`forge/app/apps/api/src/execution/run-repository.ts:10-15`). Esse lock termina com a transação de enqueue.
- A reivindicação genérica usa `FOR UPDATE SKIP LOCKED`, mas bloqueia a seleção enquanto houver qualquer run de IA queued/running no banco (`run-repository.ts:18`). O serviço genérico tem um marcador `active` local ao processo e poll a cada 2 segundos (`execution.service.ts:22-38`).
- O worker de IA usa advisory locks de sessão por cartão e projeto/caminho, mantendo as conexões durante o trabalho (`prompt-sessions.ts:490-507`). A fila de IA não verifica generic `card_runs` já running nesse ponto; existe assimetria no sentido contrário.
- Não há lock comum mantido pelas duas filas para impedir que elas escrevam no mesmo diretório. O `SKIP LOCKED` protege reivindicação de linha, não acesso ao workspace do projeto.
- Advisory locks PostgreSQL de sessão normalmente são associados à sessão de conexão, mas o efeito de falha, cancelamento, perda de conexão e workers em múltiplas instâncias deve ser comprovado na versão/configuração real; este relatório não alega execução desses casos.

**Classificação:** `CONFIRMADO POR INSPEÇÃO ESTÁTICA` para SQL, chaves e lifecycle implementado; `INFERIDO — NÃO TESTADO` para interleavings, concorrência real, liberação após falha e efeitos entre instâncias.

### Cenário mínimo para teste futuro

Somente em ambiente explicitamente provisionado para teste:

1. Subir uma instância PostgreSQL efêmera independente, com porta e credencial próprias, sem `.env` herdado e sem valores de `DATABASE_URL` do Orbit. Antes de qualquer DDL, validar a identidade da instância/DB e rejeitar host/porta iguais a qualquer serviço compartilhado conhecido. Se não for possível provar isso, não executar.
2. Criar schema descartável e aplicar apenas o schema/migrações necessárias dentro dele; não usar credenciais de DEV, PROD, Safdoulas, Suindá ou CONTROL.
3. Usar dois processos de worker e executores fake com barreiras de sincronização para manter um run genérico ativo enquanto o run de prompt tenta iniciar, e vice-versa. Registrar timestamps, status e quais locks cada sessão detém.
4. Repetir com dois cards apontando para o mesmo diretório temporário sintético; interromper um worker controladamente e observar liberação/expiração sem matar processos de serviço Orbit.
5. Verificar lock por projeto e por cartão com caminhos equivalentes, dois workers, queda de conexão, cancelamento e restart do processo fake. Limpar schema e diretórios somente depois de comprovar que pertencem ao ambiente descartável.

Nada dessa infraestrutura foi criado nesta investigação.

## 5. Resultados da investigação Codex/MCP

### Executor genérico

`CodexExecutor.execute` copia um pequeno conjunto de variáveis permitidas, prepara `CODEX_HOME` e inicia o comando com `--ignore-user-config` e `-c mcp_servers={}` (`forge/app/apps/api/src/execution/codex-executor.ts:18-27`). Portanto, o executor genérico desabilita explicitamente configuração externa e servidores MCP. O prompt é enviado por stdin, e a resposta final é lida do arquivo indicado por `--output-last-message` (`:33,39-41`). Não há canal RPC MCP implementado neste executor.

### Provider de prompt sessions

O provider monta `codex exec`, seleciona modo de sandbox, pode incluir retomada de sessão, modelo, esforço, imagens, `--json` e `--output-last-message`; o comando não inclui `--ignore-user-config` nem argumento `mcp_servers=...` (`forge/app/apps/api/src/plugins/ai/codex-provider.ts:95-130`). O teste fake confirmou essa lista de argumentos no código atual. O provider não oferece parâmetro público para configurar ferramentas MCP.

`prepareOrbitCodexHome` resolve o HOME de sessões relativamente ao diretório do próprio módulo, cria `.orbit/sessions` e pode criar nesse diretório um symlink para o `auth.json` do HOME global (`forge/app/apps/api/src/codex-home.ts:5-32`). Não copia nem cria configuração MCP. Assim, o CLI recebe um HOME dedicado do Orbit; qualquer configuração efetiva adicional dependeria de arquivo já presente nesse HOME ou de configuração explícita na linha de comando, não demonstrada no código. O conteúdo de configuração/credenciais não foi aberto.

No teste com cópia temporária, o provider encaminhou `CODEX_HOME` para dentro do diretório descartável; o comando não continha flags MCP. O executor genérico recebeu `CODEX_HOME` sob o mesmo temporário, além de `--ignore-user-config` e `mcp_servers={}`. O teste executou somente um binário fake que gravou resposta fixa.

**Classificação:** `CONFIRMADO POR TESTE ISOLADO` para argumentos montados, filtro do comando observado e localização sintética de HOME nos dois caminhos; `CONFIRMADO POR INSPEÇÃO ESTÁTICA` para implementação dos comandos e lógica de HOME; `NÃO DETERMINADO` para o comportamento do Codex CLI real carregando/rodando um servidor MCP.

### Eventos e identidade disponíveis

O provider interpreta eventos JSONL de mensagem, atividade de comando, alterações de arquivo, raciocínio e lifecycle da conversa (`codex-provider.ts:72-94,172-216`). Persiste session id, output, alterações e atividades; publica progresso no Orbit (`prompt-sessions.ts:519-568`). Há fluxo de pergunta/resposta de usuário no lifecycle de sessões (`prompt-sessions.ts:397-405,538-546`). Isso é um canal de progresso e interação limitado, não uma API bidirecional de ferramentas.

Há uma diferença de contexto de identidade entre os caminhos. O executor genérico recebe `runId`, `cardId`, `userId`, `projectId` e `permissions` em `ExecutionInput` (`forge/app/apps/api/src/execution/types.ts:11-13`), mas não os transforma em ferramenta MCP. Já a chamada atual do provider de prompts passa prompt, caminho, modelo, esforço, callbacks, modo e parâmetros de execução, sem encaminhar um objeto de autorização com identidade de projeto/card/run (`forge/app/apps/api/src/plugins/ai/prompt-sessions.ts:529-532`; assinatura `codex-provider.ts:51`). Logo, o provider precisaria receber contexto de execução autenticado pelo host antes de poder emitir capacidades limitadas a essas identidades.

### O que seria necessário para o Context Bridge

O encaixe de menor impacto é acrescentar a configuração por execução no limite já existente entre host e provider: construir uma definição MCP sintética/temporária para o run, associar cada chamada à identidade do usuário, projeto, card e run validada pelo servidor, e então passar a configuração/transport explicitamente ao subprocesso. O canal de retorno deve aceitar resultados estruturados com identificador da operação, ferramenta, argumentos validados, resultado, erro e trilha de auditoria. O host deve revalidar permissões a cada chamada; um prompt contendo nomes de ferramentas não é autorização.

É possível especificar o contrato sem reconstruir o processo de prompt, eventos, sessão ou autorização existente. Não há bloqueio arquitetural evidente. Antes de habilitar a integração real, será preciso testar configuração e ciclo MCP com a versão exata do Codex CLI em ambiente isolado, servidor fake, ferramentas sintéticas e sem credenciais reais. O teste fake executado aqui não comprova compatibilidade de protocolo, discovery, handshake ou invocação de ferramenta no Codex real.

## 6. Matriz dos pontos de integração existentes

| Capacidade desejada | Arquivo e ponto existente | Responsabilidade atual e reaproveitamento | Lacuna atual |
|---|---|---|---|
| Revisão imutável do card | `forge/app/apps/api/sql/schema.sql:103-114`; `forge/app/apps/api/src/main.ts:881-963` (`updateCard`) | Linha do card e `updated_at` são persistidos; `updateCard` centraliza a mutação de título/descrição e demais campos. | Não há revisão monotônica nem compare-and-swap ligado a run. |
| Capturar revisão do run | `forge/app/apps/api/src/execution/run-repository.ts:10-15`; `forge/app/apps/api/src/plugins/ai/prompt-sessions.ts:413-485` | Enfileiram inputs e persistem conteúdo/prompt capturado. São pontos diretos para registrar revision id/hash. | Nenhuma revisão do card é guardada/checado em terminal. |
| Fingerprint do contexto | `forge/app/apps/api/src/execution/context-builder.ts:26-51`; `project-registry.ts:68-79` | Compõem recursos selecionados e calculam SHA-256 para documentos. Reutilizáveis para fingerprint do conjunto autorizado. | Fingerprint não é vinculado à sessão/run nem validado ao retomar/terminar. |
| Commit-base/worktree | `forge/app/apps/api/src/execution/execution.service.ts:104-125`; `forge/app/apps/api/src/plugins/ai/prompt-sessions.ts:421-423,529-532`; plugin Git compartilhado `packages/orbit-core/src/git/git.plugin.ts:54,57,198,215` | Execução seleciona raiz/caminho e plugin Git conhece branch e SHA em seus próprios fluxos. | O fluxo do run não captura SHA inicial nem cria worktree isolada por execução. Não há evidência de ligação transacional do commit Git ao run. |
| Detecção de execução obsoleta | `forge/app/apps/api/src/execution/run-repository.ts:20-40`; `prompt-sessions.ts:549-568` | Os dois locais concentram transições de sucesso/falha e são pontos de verificação de revisão/fingerprint. | Sucesso significa execução concluída, sem prova de atualidade ou integração. |
| Coordenador compartilhado das filas | `run-repository.ts:10-18`; `prompt-sessions.ts:490-517` | Repositório genérico e worker de prompt já guardam estados e usam advisory locks. | Contratos de lock diferentes; verificar ambos sob um coordenador comum exige extensão, não substituição completa. |
| Comunicação bidirecional | `forge/app/apps/api/src/plugins/ai/codex-provider.ts:51,95-130,172-216`; `prompt-sessions.ts:519-568` | Spawn, stdin, JSONL, callbacks, persistência e eventos existentes formam transporte/process lifecycle. | Falta protocolo de chamada de ferramenta estruturada e identidade/permissão injetada no provider. |
| Recuperação de conhecimento | `forge/app/apps/api/src/plugins/ai/knowledge-retrieval.ts:24-93`; `ai.plugin.ts:13-15`; `tools/orbit/knowledge.mjs` | Serviço vetorial aceita candidatos autorizados pelo host; ferramenta lexical local; contexto `.orbit` selecionado. | Nenhum consumidor operacional de `rank()` localizado; falta vincular fonte/hash ao contexto do run. |
| Consistência antes de aceitar alterações | `codex-provider.ts:51-70`; `execution.service.ts:118-130`; `runProjectChecks` | Escopo de escrita e project checks já ocorrem antes do retorno terminal. `Integration Gate` pode compor essas verificações com revisão/fingerprint/estado Git. | Snapshot pode restaurar alterações de outro escritor; verificações não provam compatibilidade global de plugins ou integração no branch. |
| Compatibilidade de fontes/plugins | `tools/orbit/shared.mjs:85-120`; `scripts/verify-plugin-compatibility.mjs:8-15,17-48`; `packages/orbit-core/src/plugins/core-compatibility.ts:4-8` | Inspector de hash/lock e assertions de versão/contratos já existem e devem compor o gate. | Inspector atual detecta drift nesta referência; não declarou os ambientes sincronizados. |

## 7. Evidências verificáveis

| Afirmação | Evidência | Classificação |
|---|---|---|
| Os commits são exatamente os snapshots solicitados e HEAD é o posterior. | `git rev-parse --verify` para ambos; `git rev-parse HEAD`; saída do commit contém SHA completo e pai direto. | `CONFIRMADO POR INSPEÇÃO ESTÁTICA` |
| Arquivos rastreados coincidem com HEAD; relatório 18 já existia como untracked. | `git diff --quiet HEAD --` sucesso; `git status --short` antes da tarefa. | `CONFIRMADO POR INSPEÇÃO ESTÁTICA` |
| Queue, provider, HOME e escopo DEV não mudaram no diff entre os commits. | `git diff --quiet <anterior> <posterior> --` nos caminhos citados; código atual e report 18. | `CONFIRMADO POR INSPEÇÃO ESTÁTICA` |
| Pacote canônico `file-scope` diverge da projeção nos quatro ambientes. | Hash SHA-256, `packages/orbit-core/src/execution/file-scope.ts:5-12,27-38`, projeção DEV `:5-8,22-35`, locks `:79`; saída somente leitura de `inspectShared`. | `CONFIRMADO POR INSPEÇÃO ESTÁTICA` |
| Inspector encontrou versão do core sem bump e drift em projeções/locks. | Saída JSON de `inspectShared`; regra em `tools/orbit/shared.mjs:101-118`. | `CONFIRMADO POR INSPEÇÃO ESTÁTICA` |
| Não há prova de PostgreSQL descartável; suítes usam URL ambiente. | `execution.integration.spec.ts:1-2,21-27`; inspeção de referências sem ler valores de ambiente. | `CONFIRMADO POR INSPEÇÃO ESTÁTICA` para o padrão da suíte; `NÃO DETERMINADO` para infra externa disponível. |
| Provider prompt não passa config MCP; genérico desabilita. | Captura de args no fake isolado; também `codex-provider.ts:118-128` e `codex-executor.ts:22-27`. | `CONFIRMADO POR TESTE ISOLADO` para args; `CONFIRMADO POR INSPEÇÃO ESTÁTICA` para o código. |
| Ambos os caminhos podem receber HOME localizado na cópia temporária. | Captura de `CODEX_HOME` do executável fake em `/tmp`; helper `codex-home.ts:5-32`. | `CONFIRMADO POR TESTE ISOLADO` para cópia/execução fake; não prova o HOME de uma instância real. |
| Codex real carregará ou executará ferramenta MCP configurada. | Nenhum teste real ou fake de protocolo MCP executado. | `NÃO DETERMINADO` |
| Corridas PostgreSQL e liberação de locks após queda. | Consultas `run-repository.ts:10-18`, `prompt-sessions.ts:490-517`; teste não executado. | `INFERIDO — NÃO TESTADO` |

## 8. Questões resolvidas

1. **As referências Git existem?** Sim, ambas foram identificadas por SHA integral, e a posterior é o HEAD atual.
2. **O snapshot é reproduzível?** Sim, os arquivos rastreados correspondem ao HEAD. Porém, esse snapshot reproduz também o drift canônico/projeções; reproduzibilidade não equivale a consistência entre runtimes.
3. **O provider de prompts tem MCP explicitamente configurável?** Não no comando ou assinatura atuais. O fake confirmou ausência de flags/config MCP. Qualquer config efetiva seria externa/preexistente no HOME ou exigiria mudança futura.
4. **O executor genérico descobre MCP?** Não: ele ignora user config e passa configuração vazia de servidores MCP.
5. **É possível um HOME sintético?** Sim para teste: copiando o código para diretório temporário, o helper fixo por `__dirname` criou/retornou HOME dentro da cópia; a execução fake não teve autenticação nem rede.
6. **O risco de snapshot é eliminado pela fonte compartilhada mais recente?** Não. A fonte adiciona exclusões operacionais úteis, mas continua restaurando caminhos alterados desde o snapshot inteiro, sem identidade de autor.
7. **As projeções compartilhadas estão consistentes?** Não nesta referência: o inspector reportou drift e versão não incrementada. Nenhum reparo foi feito.

## 9. Questões não resolvidas e motivos

### Teste operacional necessário antes da implementação

- Interleavings reais entre filas, lock duration, múltiplas instâncias e falha de conexão, pois o comportamento depende de PostgreSQL e do ciclo real de conexões.
- O harness deve primeiro provar que a instância é descartável. Os testes existentes dependem de `DATABASE_URL` e criam/removem schemas; não são seguros para executar sem ambiente explícito isolado.
- Compatibilidade entre fontes canônicas e projeções precisa ser reconciliada antes de distribuir mudanças comuns. A árvore atual possui diferenças independentes por ambiente e `@orbit/core-source` com versão registrada insuficiente para o conteúdo da fonte.

### Teste operacional necessário apenas antes da ativação em produção

- Compatibilidade de MCP com a versão exata do Codex CLI e do protocolo/transport escolhido, usando servidor fake isolado e ferramentas sintéticas.
- Verificação end-to-end de autenticação/identidade e revogação por usuário, projeto, cartão e run em staging estritamente isolado; nunca reutilizar credenciais reais no fake ou compartilhar acesso com outro ambiente.
- Confirmação de que output estruturado, erros, cancellation e timeout do bridge são registrados corretamente sem transformar progresso textual em autorização.

### Dependências de decisão do responsável

- Se edição do card invalida/cancela o run ou mantém um resultado marcado como revisão antiga.
- Quais campos e anexos formam revisão imutável; quais fontes entram no fingerprint e como conflitos de revisão são apresentados.
- Se execução concorrente deve serializar por projeto, usar worktree isolada ou ambos; política de recuperação e retenção do workspace.
- Ferramentas que o Context Bridge pode oferecer, níveis de leitura/escrita, confirmação de ações e duração dos tokens de autorização.
- Política de sessão Codex após alteração de card, contexto, branch ou HEAD.
- Política de RAG: escopo por produto, origem/validade, busca lexical/vetorial e eventual consumo de API.

### Bloqueios arquiteturais

Não foi identificado bloqueio arquitetural que impeça o Context Bridge ou o Project Consistency Engine. Os limites encontrados são ausência de contrato e binding de identidade no provider, necessidade de coordenação consistente, isolamento de arquivos e reconciliação do estado de fontes/projeções. Todos podem ser abordados incrementalmente reaproveitando os pontos listados na seção 6.

## 10. Parecer final de prontidão

| Tema | Prontidão | Condição |
|---|---|---|
| Contrato de revisão imutável e freshness de cards | **Pronto para especificação** | Decisões de produto determinam política, não impedem o desenho técnico. |
| Fingerprint versionado de contexto e sessão | **Pronto para especificação** | Reaproveitar hashes atuais; definir fontes e política de retomada. |
| Coordenação global das filas | **Condicionada** | SQL permite desenhar o coordenador, mas validar com PostgreSQL isolado antes de confiar em concorrência real. |
| Worktree e isolamento por run | **Condicionada** | Risco de restauração cruzada já confirmado no relatório 18; definir exclusividade/worktree e reconciliar projeções. |
| Context Bridge bidirecional | **Pronto para especificação; ativação condicionada** | A fronteira provider/eventos existe; falta config explícita, contexto de identidade/permissão e teste real do protocolo antes da ativação. |
| RAG e contexto recuperado | **Condicionada** | Ferramentas locais e serviço vetorial podem ser ligados ao builder; autorização e vínculo a revisão ainda precisam contrato/consumidor. |
| Gate de consistência entre plugins/runtimes | **Condicionada** | Verificador já existe, mas a execução somente leitura acusa drift atual; reconciliar e verificar versões antes de liberar. |

**Resposta objetiva:** sim, já sabemos o suficiente sobre o funcionamento atual para implementar incrementalmente o Context Bridge e a camada de consistência global, sem reconstruir filas, contexto, autorização, eventos ou integração Git existentes. Não sabemos ainda o suficiente para declarar a implementação segura em concorrência real ou ativar MCP em produção. A primeira etapa de integração deve reconciliar fontes canônicas, projeções e versões; testes PostgreSQL isolados são necessários antes de confiar nas garantias das filas, enquanto um smoke test MCP com o Codex real e servidor sintético é necessário apenas antes de ativar essa integração.
