# Implementação 06 — Context Bridge bidirecional

Referência final de código e validação isolada. Data: **2026-11-15**. Branch **main**, HEAD **d9307b8e6a54316f802acbd7bcb96baa26116f16**, sem publicação Git ou implantação.

## 1. Resumo executivo

**PARCIALMENTE CONCLUÍDA.** Foram implementados e testados o broker determinístico, cinco consultas read-only, autorização do host por chamada, orçamento concorrente, auditoria própria, adapter JSON-RPC/NDJSON local e integração das duas filas com executores simulados. O Core fonte final é **1.9.3**, com **206 mappings**; API Core1.0.0 e Plugin API1 foram preservadas.

**A integração MCP/Codex real permanece bloqueada e não homologada.** O protocolo local chama-se orbit-context-bridge/1 e não é apresentado como MCP. Os adapters Codex reais recusam o Bridge antes de preparar HOME ou iniciar CLI. MCP vazio, sandbox e rede desligada do modo isolado permanecem intactos. Não houve fallback para execução com permissões maiores.

Resultado: **323 testes distintos aprovados,0 falhas finais,0 ignorados**, contando separadamente12 cenários filhos do harness Bridge e17 do compiler, sem contar reexecuções. As quatro APIs passaram TypeScript. B19 tem PASS no protocolo/IPC local demonstrado e BLOCKED na integração MCP/Codex/sandbox real. Nenhum teste com modelo pago, credencial real, banco de produto ou servidor MCP externo foi executado.

Nova migration **207_context_bridge_audit.sql**, somente em arquivos.157–160 e migrations específicas dos produtos foram preservadas; nenhuma migration real foi aplicada. Flags continuam desativadas por padrão. Esta entrega não autoriza ativação operacional nem início da07.

## 2. Base documental

Foram considerados os21 relatórios de sondagem00–20 e os seis relatórios01/02/03A/03Bfinal/04/05, incluindo decisões e limites históricos. As leituras integrais anteriores dos documentos inalterados foram reaproveitadas mediante conferência de hashes; as frentes releram os contratos atuais e os documentos de comunicação, contexto, auditoria e isolamento necessários à06. A05 final foi confrontada com código e preflight:1.8.2/197 mappings/257 testes/sem migration adicional correspondiam ao estado inicial.

| Base | Decisão mantida |
| --- | --- |
|00–09 | Preservar arquitetura real, dados por ambiente e distinção entre documentação histórica e prova operacional. |
|10–17 | Revisão da demanda não é versão integral do projeto; consulta é nova observação, não aprovação semântica ou memória universal. |
|18/19 | Testes isolados, quota/CLI/HOME sintéticos e nenhuma liberação de sandbox para forçar integração. |
|20 | PluginRegistry/PluginDefinition/RBAC existentes; host/Core mantém autoridade e IA consome contratos. |
|01 | Publicação selecionada por plano/precondições e variantes UI preservadas. |
|02 | Revisão monotônica, snapshots/CAS/freshness e idempotência preservados. |
|03A | Coordinator/supervisor/ownership/quarentena não relaxados. |
|03Bfinal | Worktree opt-in/common-dir conservador, MCP vazio e network-off preservados. |
|04 | ContextSource/Manifest/Repository/ledger160 e consulta autorizada reaproveitados. |
|05 | Compiler opt-in, hashes separados, material entregue e reservas de contexto preservados. |

AGENTS.md, skill orbit-environment, docs/product-experience.md, docs/acceleration/README.md, orbit.workspace.json, manifestos, registry/contratos e ferramentas shared/preflight foram consultados. Trabalho direto no IDE, sem execução por card ou write_scope fornecido para esta tarefa. Nenhuma autorização de serviço/Git/deploy foi inferida.

## 3. Estado inicial

Branch main, HEAD d9307b8e6a54316f802acbd7bcb96baa26116f16, preservados. A árvore já continha alterações locais das etapas anteriores e de produto. O baseline desta etapa registrou hashes de **1453 arquivos** e status completo; diff contra HEAD não é atribuição exclusiva à06.

Core fonte1.8.2/197, UI1.1.3/74, Core API1.0.0, Plugin API1. Core sem drift e locks sem atualização pendente. Preflight inicial BLOCK pelas mesmas nove variantes UI: codex-limits e plugin-navigation nos quatro runtimes e access-shell em Safdoulas. Condições operacionais continuavam não verificadas.

Migrations157–160 existentes, sem presumir instalação real. A inspeção global encontrou161–182 e184–206 específicas de Suindá;161 já era notification_web_push. Optou-se por207, após o maior número existente, sem preencher o intervalo histórico183 nem colidir com produto.

## 4. Arquitetura existente

card_runs usa CardExecutionService, ContextBuilder, ProjectRegistry, RunRepository, ContextManifestRepository e ExecutorRegistry. card_ai_runs usa PromptSessionsService, compiler/manifestos, CodexAiService e os fluxos existentes de modelo, quota, sessões e perguntas.

As duas filas já compartilham Workspace Coordinator e supervisão de processos; a03B acrescentou checkout isolado/pin/evidências. A04 vincula fontes/contexto/revisão/Git/material a manifestos imutáveis e verificações posteriores. A05 compila material e verifica o envelope dos adapters.

Faltava uma capacidade de consulta dinâmica autorizada durante o run. O Bridge foi acrescentado a esses pontos, sem nova fila, memória, provider, PluginRegistry, RAG ou supervisor.

## 5. Investigação MCP/IPC

Constatações do código real:

- CodexExecutor monta comando exec, usa spawnWorkspaceProcess, proteção do lease e receipt da05. Já passa mcp_servers={} e não foi convertido em servidor MCP.
- CodexAiService.execute aplica escopo de escrita, chama run, acompanha eventos JSONL, sessão e heartbeat. O modo isolado usa isolatedCodexPolicy; o compartilhado legado conserva suas diferenças anteriores de configuração.
- isolatedCodexPolicy pede --ignore-user-config, sandbox workspace-write/read-only, approval_policy=never, mcp_servers={}, network_access=false e exclusão de/tmp. Esses argumentos continuam byte a byte preservados.
- isolatedProcessEnvironment restringe HOME/env; prepararCodexHome continua sendo responsabilidade existente do adapter. O Bridge novo não lê auth, não muda config global nem adiciona servidores herdados.
- O pacote local @openai/codex foi identificado por leitura do package.json como0.160.0. Isso foi apenas inspeção de metadados: nenhuma execução do CLI real, consulta autenticada ou prova de suporte a MCP/sandbox.

Pipes anônimos permitem testar comunicação local sem portas e sem pressupor suporte a Unix socket sob network-off. Um teste real com subprocesso Node sintético atravessou stdin/stdout. Nenhum TCP/UDS/listener público foi aberto pelo adapter.

Isso **não prova** que o Codex0.160.0 abriria esse canal, aceitaria configuração MCP por run ou respeitaria o sandbox. Não foi implementada negociação MCP initialize/tools/resources do padrão oficial; adotou-se protocolo próprio explicitamente nomeado. Configuração automática de MCP foi mantida bloqueada.

## 6. Decisões arquiteturais

| Decisão | Razão/limite |
| --- | --- |
| Broker puro no Core | Determinismo, limites e contratos independem da IA. Nenhum Pool/FS/provider importado no broker. |
| Host adapter separado | Reutiliza ProjectRegistry/RBAC/lease/manifesto para observar e autorizar; dados do agente não escolhem identidade. |
| Capacidade como referência privada/pipe vinculado | Não há endpoint de consulta por UUID, socket descobrível ou token compartilhado global. IDs e hashes não autenticam. |
| SourceIds HMAC opacos por binding | Caminhos/IDs internos não viram parâmetros de filesystem; fontes de outro vínculo não são reutilizáveis. |
| Protocolo local próprio | Testável sem relaxar MCP/sandbox; integração real fica parcial explicitamente. |
| Opt-in hostenv | Mesmo padrão03B/05; sem sistema paralelo de flags por usuário ou plugin. |
| Auditoria SQL própria207 | Consultas não são observações genéricas de compatibilidade; não se usa verifications160 como depósito de eventos. |
| Respostas integrais limitadas/paginação | Sem truncar regras/código ou gerar resumo por LLM; oversized é recusado. |
| Recibo separado de preparação | response_prepared não equivale a adapter intake/modelo ter recebido/usado dados. |
| Git verificado sem subprocesso por consulta | Captura nativa inicial e selo limitado de HEAD/ref/inode durante as chamadas, preservando supervisão e prazo. |

## 7. Contratos do Bridge

Core: packages/orbit-core/src/execution/context-bridge.ts.

```ts
new ContextBridge({
  record, ownerId, limits, readableSourceIds, signal,
  authorize, observe, read, audit,
});
bridge.query(request);
bridge.descriptor();
bridge.summary();
bridge.close(reason);
bridge.revoke(reason);
```

Binding schema1: protocol, bridgeId, manifestId, fila/run/turno, runtime/projeto/workspace/card/revisão/ator/owner/executor, fingerprint do contexto, compiledHash, checkoutHash e base Git. A binding completa pertence ao host; descriptor público exclui owner e raízes físicas. O descriptor do handle é snapshot inicial; sinal/consultas determinam validade posterior.

Request schema1: id ASCII único no vínculo, capability e parameters tipados. Fontes usam sourceId opaco. sources.read aceita maxBytes; sources.list aceita offset/limit inteiros limitados. Identidade/runId/caminho/credenciais/configuração MCP não são parâmetros aceitos.

Response schema1: protocolo, bridgeId/requestId/capability, status ok/refused, observedAt, data autorizada, contentHash canônico dos dados, returnedBytes, limitações e código de erro quando aplicável. Conteúdo é representação data, preservando trust da fonte; não é developerInstructions.

ContextBridgeError identifica erros fechados. Requests inválidos/replay/timeout/orçamento/auditoria ou autorização perdida revogam a capacidade quando indicado. Recusas normais de fonte/tamanho permanecem estruturadas e contabilizadas. Não há fallback irrestrito.

## 8. Broker

O broker clona/valida o manifesto e verifica identidade, integridade, material e metadata do compiler: schema/status ready/policy e compiledHash iguais aos hashes de material da04. Runs legados não recebem binding fabricada.

As fontes selecionadas ficam em mapa privado. IDs públicos são HMAC-SHA256 com segredo aleatório por binding; o segredo não é persistido nem enviado ao agente. O mapa privado autoriza somente identificadores já selecionados; readableSourceIds vem do host e, por padrão, é vazio.

Cada pedido passa schema/volume/replay/limites antes de I/O. Reservas de orçamento e concorrência são atualizadas sincronicamente antes dos awaits. authorize é chamado antes/depois de observações/leituras e antes do retorno. Abort/timeout/close suprimem resultados tardios, inclusive se callbacks ignorarem o sinal.

O broker não possui Pool, comando Git, método de escrita de card/regra, e-mail/Delivery ou execução de ferramenta. Callbacks internos de host não são objetos aceitos pelo protocolo.

## 9. Capacidades de consulta

| Capacidade | Resposta e restrição |
| --- | --- |
| context.describe | Identidade/revisão/manifesto/fingerprints/política e estado verificado. Sem owner privado ou caminho físico. |
| sources.list | Só fontes selecionadas, opacas, com tipo/trust/versão/hash e disponibilidade atual; paginação por fontes inteiras e indicação de limite/nextOffset. |
| sources.read | Só fonte legível escolhida pelo host; revalida escopo/identidade/hash/versão e retorna texto redigido limitado ou recusa. Nunca aceita path. |
| context.compatibility | Estados por fonte e complete; observação parcial nunca produz compatible global. |
| sources.dependencies | Somente vínculos declarados do manifesto, opacos e com profundidade/quantidade limitadas; marca historical:true. Não descobre relações semânticas. |

Primeiros leitores do host: arquivos explicitamente selecionados, documentos agents/skills/rules/knowledge e cards autorizados de origem card/linked_card. Configuração, contratos de plugin e políticas técnicas podem ser listados como metadados, mas não ganham leitura irrestrita de seus corpos. Fontes de seleção-only não viram conteúdo legível.

Fontes alteradas/removidas/ambíguas/inacessíveis não retornam corpo novo como se fosse o capturado. O read atual não busca arquivo histórico por hash nem faz fallback para cópia antiga. Arquivo maior que o limite é recusado; esta versão não oferece offsets arbitrários de corpo ou resumos automáticos.

## 10. Integração com Codex

No genérico, ExecutionInput ganha contextBridge opcional interno. O worker captura a política no manifesto, verifica contexto, abre o binding dentro do lease, entrega o handle ao executor e o encerra no finally. A integração simulada usa o executor de fixture registrado no registry atual.

Em prompts, CodexAiService.execute recebe um último argumento opcional interno. PromptSessionsService cria/fecha o binding ao redor da chamada, com manifesto/turno atuais e callbacks existentes. O fake consome o mesmo handle e usa o adapter real.

**CodexExecutor e CodexAiService reais recusam contextBridge**, antes de HOME/spawn/provider, com motivo de integração não homologada. Não se iniciou processo real nem se alterou mcp_servers={} para completar o teste. A aplicação não tenta fallback para outro provider/checkout/sandbox.

Modo legado e compiler sem Bridge permanecem os anteriores. Nenhuma sessão antiga é ativada retroativamente. Perguntas podem gerar novo binding por turno somente após revalidar política, sessão/revisão/manifesto; o vínculo anterior está encerrado enquanto waiting_answer.

## 11. Transporte local

ContextBridgeAdapter implementa **JSON-RPC2.0/NDJSON local**, protocolVersion exato orbit-context-bridge/1. Métodos: initialize, notifications/initialized, ping, capabilities/list, capabilities/call. Cinco capacidades read-only; métodos/params desconhecidos são recusados.

API: handleJsonRpc(input); attach(readable,writable,signal); close(reason). Attach aceita streams/pipes fornecidos pelo host e não abre porta, socket ou subprocesso. Writes são serializados, com backpressure e limites de frames/filas/pendências. ID JSON-RPC é inteiro seguro ou ASCII limitado, para limitar overhead.

O total transportado inclui init/list/ping/errors e envelopes NDJSON. A instanciação pelo host usa o mesmo teto dinâmico do binding, maxMessages=maxRequests+2, pending<=maxConcurrent e limite de resposta coerente com a reserva256 bytes.

Close remove o vínculo e listeners operacionais, cancela aceitação e espera sua rotina de fechamento. Streams/processos são de quem os forneceu: o adapter não assume autoridade para matar um executor externo; isso continua pertencendo à supervisão03A. Erros tardios/EPIPE após detach são tratados sem derrubar o host.

Sinal de cancelamento/revogação e fechamento do canal são os mecanismos locais de invalidação. Não foi implementado um sistema geral de notificações push/MCP. O teste de pipes usou cliente Node sintético; não foi empacotado daemon/server global para o Codex.

## 12. Integração com contexto versionado

A política capturada reside em configuration.contextBridge, adicionada antes de persistir o manifesto. Inclui protocolo/transporte/limites e codexIntegration:not_homologated. Nenhum bridgeId/HMAC/credencial efêmera modifica o fingerprint de contexto original.

Manifesto continua imutável. Consulta acrescenta evidência em207; não reescreve sources/material/compiledHash/promptHash/fingerprint/integrityHash. Conteúdo opcional omitido pelo compiler pode ser lido dinamicamente somente se ainda selecionado, autorizado, legível e compatível, com orçamento próprio reservado. Isso não o transforma em material inicialmente entregue.

Mudança da demanda, turno, identidade física, política, autorização ou manifesto vigente revoga/recusa o vínculo. Fontes específicas alteradas são diagnosticadas e o corpo é recusado. Dependências históricas são rotuladas, sem afirmar atualidade.

Freshness da demanda02, compatibilidade de contexto04, estado do run e integration:not_integrated continuam distintos. Fonte observada parcialmente não vira aprovação global.

## 13. Orçamento e controle de volume

Default da política do host:

| Limite | Valor |
| --- | ---: |
| maxRequests |16 |
| maxResponseBytes |4096 |
| maxTotalBytes |min(10000,metade da reserva externa do compiler) |
| requestTimeoutMs |2000 |
| maxConcurrent |1 |
| maxSources |64 |
| maxDependencyDepth |8 |
| maxRequestBytes |4096 |

São bytes/unidades conservadoras UTF-8, não tokens faturáveis. O broker reserva maxResponseBytes+256 por pedido antes de awaits e devolve a sobra na conclusão. Cobrança efetiva é JSON do broker+256 de transporte; pedidos simultâneos não podem ultrapassar o teto. O adapter também limita o total real dos seus envelopes, inclusive mensagens de controle.

ContextDeliveryContract ganha dynamicContextBudgetBytes. prepareContextDelivery exige overhead do envelope+reserva dinâmica<=reservedExternalTokens e preserva o teto da05. A soma não pode usar duas vezes a mesma reserva. Os testes de helper e pipeline simulado comprovam isso; não se afirma orçamento real de memória/modelo/imagens do Codex.

Tamanho, total, concorrência, chamadas, profundidade ou prazo excedidos produzem recusa/fechamento, sem resumo por IA ou truncagem disfarçada. Timeout revoga o binding inteiro para não liberar novos pedidos enquanto I/O tardio ainda existe. Histórico/summary distinguem material retornado, charged/reserved/remaining e recusas.

## 14. Auditoria

Eventos próprios: bridge_created, request_received, authorized, response_prepared, response_emitted, delivery_unverified, denied, revoked, closed.

- response_prepared: o broker construiu/validou o resultado; ainda não comprova handoff.
- response_emitted: o adapter do host recebeu o resultado do broker. Não comprova transmissão completa à CLI, recebimento pelo modelo ou interpretação.
- delivery_unverified: uso/recepção pelo modelo não foram observados. Seu significado não muda para sucesso só porque houve hash ou output do executor.

Registros guardam binding ao manifesto/run/turno/ator/owner/runtime/projeto/workspace/card/revisão/fingerprint; capacidade/requestId; referência de fonte opaca; sourceIdentityHash estável para correlação com IDs do próprio manifesto após apagar o HMAC; sourceHash/versão, responseHash e volumes; observado/registrado/status/motivo.

Não há corpos de pedidos/respostas/fontes, tokens, socket paths, configuração MCP ou credenciais no payload aceito. SourceIdentityHash é identificação histórica, não autorização. Hash da resposta identifica dados canônicos; o envelope local possui limite de transporte separado.

Host aplica autorização por recurso/owner/workspace/revisão/worker/lease/política/configuração e disponibilidade de plugins. O evento authorized registra a decisão do host, sem fingir arquivar toda a ACL histórica. Falha de auditoria impede nova resposta e revoga a capacidade. Fechamento preserva a revogação mesmo se seu registro falhar; erro final é explícito e não apaga output técnico concluído.

## 15. Lifecycle

1. Preparação autorizada e compilada; flag/limites entram no manifesto do run/turno.
2. Idempotência retorna o registro original antes de reconfigurar o Bridge.
3. Worker verifica revisão/fontes/checkout dentro do lease existente.
4. openContextBridge revalida run/worker/card/projeto/manifesto/compilação/política e registra bridge_created antes de expor o handle.
5. Adapter exclusivo recebe apenas referência de consulta e metadados seguros.
6. Cada pedido é reautorizado; leituras e orçamento são limitados.
7. Cancelamento, permissão/ownership/turno perdidos, estado terminal ou prazo revogam sinais/capacidade.
8. Finally fecha o adapter antes de concluir o ciclo protegido. Waiting_answer não mantém canal ativo.
9. Nova resposta cria outro binding/HMAC após validar o turno; handles antigos continuam encerrados.
10. Histórico é preservado, sem segredo operacional persistente ou endpoint que reabra por bridgeId.

O núcleo não inicia um agente supervisor novo nem mantém daemon de consultas após término. Leitura/SQL não cooperante pode terminar mais tarde, mas resultado tardio é suprimido; abort não é prova de cancelamento físico de qualquer I/O do sistema.

## 16. Autorização e isolamento

context-bridge-host.ts revalida:

- runtime confiável do host; manifesto íntegro e último turno do run.
- fila/run/card/projeto/ator/revisão corretos; status running e worker_id esperado, sem cancel_requested.
- callback de card autorizado, workspace e revisão atuais.
- ProjectRegistry owner e raiz autorizada; configuração/permissões relevantes iguais às capturadas.
- disponibilidade de dependências de plugin.
- lease ativo, inode do root e identidade Git autorizada.
- políticas atuais de compiler/Bridge iguais às capturadas.

A base Git é observada nativamente ao abrir o vínculo. Durante consultas, um selo limitado de HEAD/ref/inode é lido sem subprocessos. Cada valor precisa corresponder à referência/base capturadas; não se aceita mudança entre captura nativa e selo. Diretórios Git locais comuns são suportados; ponteiros .git/worktree/shared layouts não homologados são recusados. Isolamento03B já é bloqueado antes de liberar Bridge.

Caminhos vêm de fontes selecionadas, nunca do request. Leitores reaproveitam safePath/readResource/documentSource/revalidateSelection: traversal, áreas reservadas e symlink fora do escopo são recusados. Observações parciais ficam unverified ou mais restritivas; nunca compatible global.

Bindings são capacidades privadas fornecidas pelo host, não autenticação por UUID. Pipes anônimos não têm endereço público. Não existe endpoint público de query, token reaproveitável por runId ou configuração MCP editável pelo agente.

Isso não é sandbox de plugins JS privilegiados, de processos externos não cooperantes ou de todo filesystem. As restrições do sistema operacional/03A/03B continuam sendo outra camada.

## 17. Compatibilidade com plugins

PluginRegistry/PluginDefinition/actions/capabilities/dependências/RBAC existentes foram preservados. O Core broker importa somente contratos determinísticos/crypto. O host reutiliza o registry atual; nenhum registry MCP ou sistema de ferramentas mutáveis foi criado.

IA pode consumir o contrato de executor, mas não decide autorização. As classes Codex concretas apenas acrescentam guard de integração não homologada. Core compila/consulta seus contratos mesmo sem IA, quando o fluxo autorizado não depende dela; plugin necessário desativado revoga acesso.

Input entregue às actions remove contextBridge e contextDelivery. Plugins não recebem o callback de atestação nem o handle de consulta por essa superfície. Fonte documental maliciosa permanece data e não registra ferramenta, muda revisão, aprova regra ou amplia permissões.

Consumidor vetorial de Suindá e BM25 local não foram alterados/chamados. Nenhum embedding, RAG compartilhado ou índice universal foi implementado.

## 18. Implementação arquivo por arquivo

Caminhos relativos à raiz. Fontes canônicas e suas quatro projeções oficiais têm os mesmos contratos; famílias abaixo identificam explicitamente os caminhos e consumidores.

| Arquivo | Responsabilidade/mudança, razão, compatibilidade e risco |
| --- | --- |
| packages/orbit-core/src/execution/context-bridge.ts | Novo broker puro, identidade, fontes opacas, schema/caps, orçamento concorrente, callbacks autorizados, proveniência e revogação. Não concede autoridade por conta própria; host fornece dependências confiáveis. |
| packages/orbit-core/src/execution/context-bridge.spec.ts |23 testes puros de protocolo/escopo/dados/budgets/replay/timeout/auditoria/paginação; sem FS/DB/provider. |
| packages/orbit-core/src/execution/context-bridge-adapter.ts | Novo adapter local JSON-RPC/NDJSON/streams; limites e fechamento, sem sockets/processos/MCP. Host deve fornecer canal e lifecycle corretos. |
| packages/orbit-core/src/execution/context-bridge-adapter.spec.ts |10 testes de handshake/allowlist/frames/concorrência/backpressure/budget/revogação/late errors. |
| packages/orbit-core/src/execution/context-bridge-repository.ts | Novo append/history estrutural, payload whitelist e DTO sem binding privado. Autorização fica no host; não aceita corpos/tokens. |
| packages/orbit-core/src/execution/context-bridge-repository.spec.ts |3 testes puros de persistência contratual/privacidade/binding; DB fake, SQL real testado separadamente. |
| packages/orbit-core/src/execution/context-bridge-host.ts | Novo adaptador de flags/captura/autorização/RBAC/FS/Git seguro, ligação aos callbacks e auditoria. Apenas fontes selecionadas com contratos de leitura; suporte de layout Git deliberadamente restrito. |
| packages/orbit-core/src/execution/context-bridge-host.spec.ts |6 testes com Registry/Builder reais, FS/DB/lease sintéticos: redação, alteração/remoção/symlink, revogações, flags e substituição do root/layout Git. |
| packages/orbit-core/sql/migrations/207_context_bridge_audit.sql | Nova tabela/índices/guards append-only e binding ao manifesto compilado, independente de verifications160. Aplicação real pendente. |
| packages/orbit-core/src/execution/execution.service.ts | Captura política no enqueue, preserva modo histórico, abre/fecha Bridge dentro do lease e expõe histórico seguro via API atual. Output/status/freshness mantidos. |
| packages/orbit-core/src/execution/types.ts | ExecutionInput ganha handle opcional interno, sem parâmetro público novo nos cards. Callers legados continuam válidos. |
| packages/orbit-core/src/execution/registries.ts | Remove também contextBridge do input exposto a actions; mantém o callback privado de entrega fora delas. |
| packages/orbit-core/src/execution/codex-executor.ts | Recusa Bridge não homologado antes de lease/HOME/spawn; argumentos MCP/sandbox anteriores permanecem. |
| packages/orbit-core/src/execution/context-delivery.ts | Reserva dinâmica opcional e validação da soma envelope+Bridge na reserva05, sem redefinir hashes antigos. |
| packages/orbit-core/src/execution/context-delivery.spec.ts |Acrescenta teste de orçamento agregado;4 testes no arquivo final. |
| packages/orbit-core/src/execution/context-runtime.ts |Allowlist do DTO de recibos inclui dynamicContextBudgetBytes seguro; não inclui conteúdo bruto. |
| packages/orbit-core/src/execution/context-runtime.spec.ts |Teste existente ampliado para provar que actions não recebem Bridge;5 testes finais no arquivo. |
| {dev,prod,safdoulas,suinda}/app/apps/api/src/plugins/ai/prompt-sessions.ts |Captura modo/política por run/turno, configuração aditiva, abertura/fechamento protegido, reserva e recusa409 em retomada incompatível. Patches locais preservam diferenças dos produtos. |
| {dev,prod,safdoulas,suinda}/app/apps/api/src/plugins/ai/codex-provider.ts |Último argumento interno opcional e guard antes de HOME/CLI; sem novo provider, MCP config ou autoridade. |
| {dev,prod,safdoulas,suinda}/app/apps/api/src/orbit-architecture.ts |Sincroniza regra persistente de Bridge readonly, limites/identidade e bloqueio MCP com painel Codex e cartões; namespaces mantidos. |
| tools/orbit/context-workers.test.mjs |Harness04/05 ampliado com modo06, eventos SQL fake, consultas reais ao broker/adapter e fechamento por turno. Corrige projeção SQL da fixture para imitar SELECT real. |
| tools/orbit/context-bridge-workers.test.mjs |Novo wrapper env allowlist;12 cenários filhos reais das duas filas com fakes externos. |
| tools/orbit/context-bridge-adapter.test.mjs |Novo teste de pipes anônimos com subprocesso Node sintético; sem banco/rede/Codex. |
| tools/orbit/context-bridge-provider.test.mjs |Novo teste de bloqueio dos adapters reais antes de HOME/CLI e preservação dos flags03B. |
| tools/orbit/context-bridge.postgres.test.mjs |Novo teste PG16 privado de207/160, guards, concorrência e histórico. Não importa bootstrap/provider. |
| packages/orbit-core/package.json;orbit.workspace.json |9 mappings e releases1.9.0–1.9.3 selecionadas; API1.0.0/Plugin API1 preservadas. |
| {dev,prod,safdoulas,suinda}/app/orbit.shared-lock.json |Atualização oficial apenas Core; entradas UI preservadas. |
| AGENTS.md;docs/product-experience.md |Instrução persistente sincronizada com quatro prompts incorporados. |
| docs/implementacao-arquitetural/06-CONTEXT-BRIDGE-BIDIRECIONAL.md |Este relatório de passagem de contexto; não reescreve entregas anteriores. |

São9 artefatos canônicos novos, cada um com quatro projeções, e8 fontes comuns existentes modificadas com suas projeções. Nenhuma UI, schema anterior, regra de supervisor/quarentena ou consumidor vetorial foi sobrescrito.

## 19. Persistência e migrations

Tabela nova context_bridge_events: UUID/id, event_sequence, bridge_id, manifest_id e binding completo; fase/capacidade/request/source refs/hashes/versão/status/reason/volumes/tempos e audit JSONB estritamente metadados. FK referencia manifesto; não exige retenção permanente da linha do card/run para explicar o evento histórico.

Guards impedem UPDATE/DELETE/TRUNCATE e validam colunas/payload/manifesto/revisão/turno/fingerprint. Primeiro evento concorrente de bridgeId usa serialização para impedir atribuição a owners/bindings diferentes. Código rejeita campos/corpos/credenciais não previstos antes da query. SQL não recompõe todo SHA nem contém administrador privilegiado irrestrito; integridade semântica depende dos contratos/host e política de retenção explícita.

207 foi escolhida após confirmar max global206, evitando161 já usada em Suindá e o intervalo183 histórico.157–160 permanecem inalteradas. Não houve migration real, seed ou consulta a banco de produto.

Feature off/manifestos antigos não consultam207 por conveniência. Feature on requer schema homologado: falha de auditoria bloqueia, não libera execução sem registro. Ativação futura deve verificar/aplicar as migrations apropriadas por banco com autorização própria.

## 20. API e observabilidade

Mantido GET /execution/context/:queue/:id e seu RBAC por card/projeto/workspace/runtime/ator. Nenhuma nova API pública de queries por runId/bridgeId. GET continua somente leitura e não reabre vínculo nem inicia provider.

Para contexto capturado com Bridge: bridge.enabled=true, captured_policy, transport_status explícito de protocolo local/Codex não homologado e histórico seguro limitado a100 eventos. Sem Bridge: enabled:false e sem consulta obrigatória à tabela nova.

history_limited e counts_scope:returned_history_only evitam apresentar a página como contagem global. O repositório suporta até500 eventos por history; summary vivo do broker é métrica daquele binding, não contador global de todos os turnos. Não se infere canal ativo só de um bridge_created antigo: processo/handle efêmero pode ter terminado.

DTO de auditoria exclui owner/binding bruto, corpos, socket paths, tokens e configuração MCP. Campo sourceIdentityHash permite correlacionar fonte do manifesto autorizado sem publicar path. Compatibilidade live e última observação persistida continuam separadas; consulta parcial não vira compatible.

Não foi criada interface Web. Variantes UI existentes permanecem preservadas.

## 21. Testes B1–B20

Comandos executados com Node24.20.0 absoluto e ambiente sintético conforme§24:

```sh
# U: Core novo e regressões unitárias; lista completa em§22
TSX_DISABLE_CACHE=1 TSX_TSCONFIG_PATH=<absoluto>/forge/app/apps/api/tsconfig.json node --import ./forge/app/node_modules/tsx/dist/loader.mjs --test forge/app/apps/api/src/execution/context-bridge.spec.ts forge/app/apps/api/src/execution/context-bridge-host.spec.ts forge/app/apps/api/src/execution/context-bridge-adapter.spec.ts forge/app/apps/api/src/execution/context-bridge-repository.spec.ts
# W: duas filas/classes/registries/adapter reais, DB/quota/executor fake
node --test tools/orbit/context-bridge-workers.test.mjs
# A: pipes reais com cliente Node sintético
node --test tools/orbit/context-bridge-adapter.test.mjs
# P: guard dos adapters Codex reais, sem executar CLI
node --test tools/orbit/context-bridge-provider.test.mjs
# SQL: PG16 privado e ownership provado antes do DDL
node --test tools/orbit/context-bridge.postgres.test.mjs
```

| Cenário | Status real | Método/evidência/arquivos | Limitação |
| --- | --- | --- | --- |
| B1 |PASS |U broker/adapter: schemas, canonical JSON, identidade e mensagens tipadas; IDs opacos estáveis no binding e novos em outro. |Não promete HMAC igual entre runs nem conformidade MCP. |
| B2 |PASS |U host+W: manifesto compilado real, owner/card/projeto/turno atuais e consultas vinculadas. |DB do pipeline fake; SQL separado real. |
| B3 |PASS |U broker+W: apenas fontes selecionadas/opacas, paginação inteira e legibilidade explícita. |Não lista árvore completa do projeto. |
| B4 |PASS |U host+W: read atual com redação/hash/versão/limite e sourceIdentityHash auditável. |Não fornece arquivo histórico por hash. |
| B5 |PASS |U broker/schema: fonte arbitrária/outro binding/projeto recusada, sem path de caller. |Capacidade é referência privada do host, não login de rede. |
| B6 |PASS |U host/broker: arquivo alterado diagnosticado e corpo novo não entregue como capturado. |Sem reconciliação semântica. |
| B7 |PASS |U host: remoção/symlink escape retornam recusa/erro estruturado, sem corpo externo. |TOCTOU externo não cooperante não é sandbox universal. |
| B8 |PASS |U host/broker: observação de fontes incompleta retorna unverified ou mais restritiva, nunca compatible global. |Não recompila memória completa do provider. |
| B9 |PASS |U respostas/bytes/tamanho/request count; ContextDelivery soma envelope+dinâmico; W opera dentro dos limites. |Estimativa local, não tokens faturáveis. |
| B10 |PASS |U reservas sincrônicas/concurrency e quota total; adapter limita fila/transport. |SQL worker simulado; não stress de produção. |
| B11 |PASS |U abort durante read e late callback sem emissão; host cancel aborta handle. |I/O do SO não é cancelado universalmente. |
| B12 |PASS |U host muda membership/revisão/worker/permissão/plugin/root/layout Git; revoked; W usa coordinator real. |Não homologação de filesystem/mounts externos arbitrários. |
| B13 |PASS |U host estado terminal nega nova consulta; W fecha antes de status final. |Histórico não prova processo vivo. |
| B14 |PASS |U old closure/source/replay/schema e W handles únicos/encerrados por turno. |Sem token público/server de rede testado. |
| B15 |PASS |U corpo malicioso permanece data; parâmetros de identidade/path/config desconhecidos são recusados; P não prepara configMCP/HOME. |Não garante obediência semântica de qualquer modelo. |
| B16 |PASS |U broker sem IA/provider; registry01–05 com AI desligada; host plugin necessário desativado recusa. |Não permite operação IA com plugin indisponível. |
| B17 |PASS,simulada |W12 cenários das duas filas com class/registry/lease/adapter reais e executores externos fake. |Não execução de Codex real. |
| B18 |PASS,simulada |W pergunta/resposta preserva parent/turno/sessão, novo binding, old handle fechado; política desativada recusa409 sem consumir turno. |Memória do Codex real não examinada. |
| B19 |PASS local;BLOCKED MCP/Codex real |A atravessa pipes reais;U adapter;P confirma guard/MCP vazio/rede03B preservados. |Sem servidor MCP oficial/config/run real; sem sandbox afrouxado. |
| B20 |PASS no escopo isolado |U/W/A/P/PG/regressões01–05 e4 APIs. |Gate global BLOCK anterior e homologação real NOT_RUN. |

Existência de arquivo não foi usada como evidência de aprovação. Os rótulos B1–B20 não são20 testes extras. Teste de protocolo/integração fake é separado de homologação real; nenhuma capacidade Codex/MCP real recebeu PASS por inferência.

## 22. Testes de regressão

| Grupo final efetivamente executado | Resultado distinto |
| --- | ---: |
| U completo:base05+broker23+adapter10+repo3+host6+teste extra de reserva |147 PASS |
| W Bridge cenários filhos |12 PASS |
| W Bridge wrapper de orquestração |1 PASS |
| A pipes reais |1 PASS |
| P guard dos providers |1 PASS |
| PG Bridge207 |8 PASS |
|04 context-workers legado |10 PASS |
|05 compiler-workers filhos e wrapper separados |17+1 PASS |
|05 compiler-provider |1 PASS |
| Tools shared/preflight/catalog/registry-foundation/card revision/UI/enqueue/PG/workspace PG/workers |75 PASS |
|04 context-manifests PG160 |10 PASS |
|03B isolated-checkout16+provider1+workers1 |18 PASS |
| Prompt selecionado DEV6+PROD5+Safdoulas5+Suindá5 |21 PASS |
| **Total,sem contar reexecuções** |**323 PASS,0 FAIL finais,0 skipped** |

U completo também executou compiler/host/delivery/manifest/registry/runtime/execution/card-contexts/isolated-policy/file-scope/managed-process/project-checks/workspace-coordinator/workspace-process já existentes. Novas famílias foram adicionadas à lista direcionada, sem npm test global.

Comandos adicionais:

```sh
node --test tools/orbit/context-workers.test.mjs
node --test tools/orbit/context-compiler-workers.test.mjs tools/orbit/context-compiler-provider.test.mjs
node --test tools/orbit/shared.test.mjs tools/orbit/preflight.test.mjs tools/orbit/catalog.test.mjs tools/orbit/registry-foundation.test.mjs tools/orbit/card-revision-ui.test.mjs tools/orbit/card-version-enqueue.test.mjs tools/orbit/card-revisions.postgres.test.mjs tools/orbit/workspace-coordinator.postgres.test.mjs tools/orbit/workspace-workers.test.mjs
node --test tools/orbit/context-manifests.postgres.test.mjs
node --test tools/orbit/isolated-checkout.test.mjs tools/orbit/isolated-provider.test.mjs tools/orbit/isolated-workers.test.mjs
node <runtime>/app/node_modules/typescript/bin/tsc --noEmit --incremental false -p <runtime>/app/apps/api/tsconfig.json
TSX_TSCONFIG_PATH=<tsconfig-absoluto> node --import ./<runtime>/app/node_modules/tsx/dist/loader.mjs --test --test-name-pattern='prompt queue|revision|disabled AI startup|Questionar|multi_agent' <runtime>/app/apps/api/src/prompt-question.spec.ts
```

As quatro APIs passaram na versão final. Web/browser não foram alterados/compilados/homologados. Suites de PG/ownership foram executadas em sequência, sem concorrer com testes de workspace; TypeScript e testes de prompt sem lease foram independentes.

Falhas intermediárias registradas/corrigidas/repetidas: fixtures de manifesto com campos de integridade antigos; callback de stream done antes de close; schema/projeção da fixture SQL mais largo que SELECT real; configuração não normalizada na fixture; observador de card incompleto; revalidação Git por subprocesso dentro de timeout gerando interrupção conservadora da fixture. A correção foi no observador, não no supervisor/ownership. Os logs antigos foram preservados quando relevantes; não se ocultou o incidente como PASS.

## 23. Monorepo e projeções

Core fonte final **1.9.3/206 mappings**, integridade **f1ff94b0f872103dc49d802b4dfea9d98f0f07626da3776b5c9c699a9b6f2027**. UI1.1.3/74 e integridade8b8cc6ed2f02d2792da0787193cf0062801623c568e22f4804ee489c87ccdff8 inalteradas. Core API1.0.0/Plugin API1 continuam separados da versão do pacote fonte.

Publicação oficial selecionou apenas @orbit/core-source, com plano/precondições/arquivos atribuídos.1.9.0 integrou contratos;1.9.1 fechou autorização/configuração de host;1.9.2 substituiu subprocessos por selo Git limitado e corrigiu observador da fixture;1.9.3 acrescentou revogação/observabilidade e prova de troca do root/retomada de política. Não houve edição manual de hashes para maquiar drift.

Final: **0 drift Core,0 locks pendentes**. As296 projeções UI/entradas de lock foram comparadas ao preflight inicial; mesmas nove variantes preservadas. Preflight global permanece BLOCK anterior; não se declara promoção operacional aprovada.

Prompt/provider/architecture dos quatro produtos receberam patches localizados, preservando diferenças Safdoulas/Suindá. Não houve cópia integral de DEV sobre produto, branch por ambiente ou novo repositório interno.

## 24. Segurança operacional

Nenhum teste executou Codex real, rateLimits autenticado, modelo pago, embedding, HOME/auth real, banco de produto ou servidor MCP externo. Nenhum listener público foi aberto; adapter é stream-only. Não houve Docker, deploy, restart, migration/seed real, Git publication ou alteração de política global do Codex.

Evidências de isolamento:

- Env allowlist com HOME temporário, CODEX_HOME sintético, CODEX_BIN inexistente/fake, sem DATABASE_URL/PG*/OpenAI keys originais; TSX config absoluto para subprocessos que mudam cwd.
- Hooks/fsmonitor/config Git global/system desativados; Git mutável somente em fixtures próprias.
- Quota import/funções claim/finish sensíveis substituídos nos harnesses; nenhum onModuleInit/bootstrap operacional invocado.
- Testes Codex anteriores usam CLI Node fake e home adapter substituído. O teste Bridge novo prova homes=0 no guard.
- PG16 próprio com initdb/data_directory/usuário/versão/inet_server_addr/listen_addresses verificados antes do DDL; socket privado0700, outbound bloqueado e teardown só do cluster próprio.
- Pipes reais usam subprocesso builtin Node sintético, sem DB/rede/Git/provider/auth.

Um teste inicial de consulta acionou a quarentena da própria fixture, preservando a proteção03A. Foi removido apenas o arquivo de ownership exato da fixture encerrada, após provar UUID/pid/queue, namespace/tmp, processo inexistente, raiz removida e janela temporal do log. Evidência local: owned-fixture-quarantine.json. Nenhum marcador operacional/desconhecido foi limpo; supervisor/coordinator não foram relaxados.

A revalidação deixou de iniciar subprocessos a cada query. A captura Git inicial continua supervisionada; verificações seguintes usam metadados limitados e fontes autorizadas. Testes finais passaram sem repetir a quarentena.

Agentes tiveram arquivos delimitados, com integrador responsável pelos contratos/revisão. Algumas frentes atingiram limite de uso e o integrador concluiu a entrega. Não há medição que permita declarar redução de tokens/tempo por delegação ou economia financeira de contexto.

## 25. Inventário Git

Baseline1453: **61 modificados nesta etapa,0 removidos**. Novos06: **50 arquivos** —9 fontes canônicas+36 projeções+4 tools de teste+este relatório. A tabela§18 enumera todas as famílias.

Os61 modificados:8 fontes comuns e32 projeções;12 nongeneric de runtime;AGENTS/experiência;package/workspace e4 locks;harness context-workers. Diff contra HEAD inclui01–05/trabalho de produto e não é atribuído integralmente à06.

Preservados por hash fora do escopo: migrations157–160;manifest/compiler/builder/ProjectRegistry/RunRepository;coordinator/process/supervisor/checkout/isolated-policy/file-scope;relatórios anteriores e UI. Migrations próprias de produto não foram substituídas por Core207.

main/HEAD preservados, sem stage/commit/push/tag. Arquivos novos continuam locais/não rastreados até autorização futura de versionamento. Nenhuma publicação remota foi declarada.

## 26. Limitações e riscos

1. MCP/Codex real e sandbox com canal dinâmico **não foram demonstrados**; o guard é intencional e etapa permanece parcial.
2. Protocolo próprio não é implementação MCP nem compatibilidade com tools/resources oficiais. Não há daemon/server/empacotamento pronto para CLI real.
3. Integração simulada das filas usa DB/quota/executor fake; SQL e pipes têm testes reais separados. Não é homologação integrada de produção.
4. Capacidade é referência privada/pipe host-bound, não autenticação de rede. Futuro transporte endereçável precisará de credencial efêmera/prova de peer e revogação equivalentes, sem confiar em UUID.
5. Selo Git é limitado a layout local/HEAD/ref/inode, não versão integral do filesystem/objetos Git ou resistência universal a processos não cooperantes. Ponteiros/worktrees compartilhadas não homologadas ficam bloqueados.
6. Leitura/SQL/FS não são snapshot atômico conjunto. Revalidação e hash limitam races, mas não fornecem sandbox universal ou retenção completa de fontes.
7. Bytes/estimativas não são tokens reais; memória interna, imagens, ferramentas e respostas futuras do provider seguem fora de medição completa.
8. I/O/auditoria podem terminar após timeout; a capacidade já está revogada e o resultado tardio não é entregue. Registro tardio não reativa o canal. Falha de close audit é logada e não apaga resultado técnico.
9. response_emitted é intake do adapter do host, não prova de modelo/CLI ter interpretado conteúdo. delivery_unverified continua explícito.
10. Callbacks/constructors são internos do host; um plugin JS comprometido com acesso irrestrito ao processo não vira isolado por este contrato. Superfície remota do agente não recebe esses objetos.
11. Paginação/limites e leitores da primeira versão não cobrem qualquer fonte dinâmica ou arquivo grande. Sem fallback de corpo ou nova descoberta automática.
12. Descriptor inicial/histórico não prova canal ativo. Signals e autorização atual comandam validade; API history pode ser limitada e não fornece totais globais falsos.
13. O adapter encerra seu vínculo, não assume ownership de qualquer processo/stream externo. Provisionamento/drain do processo real precisa ser integrado à03A em próxima homologação.
14. Instruções maliciosas são dados rotulados, mas isso não garante obediência semântica de um modelo. Não há RAG/reconciliação/Integration Gate novo.

## 27. Pendências de ativação

Não ativar automaticamente. Para uma futura etapa autorizada:

1. Verificar schema existente157–160 e aplicar207 separadamente por banco com autorização/backup e isolamento. Nenhuma instalação foi presumida nesta entrega.
2. Definir mecanismo real MCP/stdio/IPC compatível com o Codex instalado e sandbox, demonstrando peer binding e ciclo do processo.
3. Testar com autorização específica CLI real, configuração por run, ausência de servidores externos herdados, cancelamento, drain e não-vazamento de credenciais. Não retirar MCP vazio/network-off só para obter sucesso.
4. Garantir reserva envelope+dinâmico antes de expor consultas ao agente real e observabilidade do handoff sem afirmar uso semântico.
5. Validar funcionalmente RBAC/dados/turnos/perguntas/erro em ambiente de homologação; só então decidir cada runtime.
6. Resolver/revisar gate estático anterior sem apagar variantes intencionais e conferir contratos/plugins pertinentes.

Flags: ORBIT_CONTEXT_BRIDGE_ENABLED padrão ausente/0; só1 habilita preparação compatível. Knobs host com prefixo ORBIT_CONTEXT_BRIDGE_:MAX_REQUESTS,MAX_RESPONSE_BYTES,MAX_TOTAL_BYTES,REQUEST_TIMEOUT_MS,MAX_CONCURRENT,MAX_SOURCES,MAX_DEPENDENCY_DEPTH,MAX_REQUEST_BYTES. Eles não configuram MCP nem concedem permissões. Compiler precisa estar habilitado/verificável para novo Bridge.

Nenhum.env/config operacional foi alterado. Mesmo com a flag configurada manualmente, adapters Codex reais continuam bloqueados até integração/homologação próprias; não há fallback.

## 28. Preparação da próxima etapa

| Capacidade futura, não implementada | Substrato real disponível/limite |
| --- | --- |
| RAG compartilhado |Contrato de query/fonte/escopo/budget; nenhum novo índice/vetor. |
| Conhecimento sob demanda |Leitores selecionados e histórico207; novas fontes exigem autorização/proveniência, não descoberta irrestrita. |
| Registro de descobertas |Somente leitura nesta etapa; nenhuma escrita de memória ou aprovação. |
| Knowledge Reconciliation |Histórico/hash/estado observável; nenhuma decisão semântica. |
| Project Consistency Engine |Demanda/compilação/consulta/resultado separados; sem motor semântico. |
| Integration Gate |Manifestos/recibos/evidências03B/207; sucesso continua diferente de integração autorizada. |
| Desired State Reconciler |Contratos de observação para consumo futuro, sem alterar código automaticamente. |

Nenhuma07 foi iniciada.

## 29. Handoff técnico

Começar pelos contratos/broker, context-bridge-host e adapter; depois repository/207 e os pontos de integração em execution.service e prompt-sessions de cada runtime. Não modificar sem revisão os significados da04/05 ou as proteções03A/03B.

Exemplo do protocolo de handle interno:

```ts
await handle.exchange({jsonrpc:'2.0',id:'init',method:'initialize',params:{protocolVersion:'orbit-context-bridge/1'}});
const list = await handle.exchange({jsonrpc:'2.0',id:'list',method:'capabilities/call',params:{request:{schemaVersion:1,id:'selected-1',capability:'sources.list',parameters:{offset:0,limit:4}}}});
// Only use an opaque sourceId from this binding's authorized response.
await handle.exchange({jsonrpc:'2.0',id:'read',method:'capabilities/call',params:{request:{schemaVersion:1,id:'read-1',capability:'sources.read',parameters:{sourceId,maxBytes:1024}}}});
```

Não enviar runId/ator/path/DB/config como argumentos. O handle nasce do host, não de um endpoint que receba IDs do agente. Fonte de outro binding não será válida. A referência é encerrada em finally e no sinal; uma nova pergunta precisa de outro vínculo autorizado.

ContextBridgePolicyFromHost decide modo novo a partir de compiler metadata; contextBridgePolicyForManifest conserva o modo histórico e recusa desativação/alteração de política em retomadas. bridgeConfiguration é aditiva, sem ephemerals no manifesto. openContextBridge recebe registries existentes/record/lease/worker/signal/card callback; devolve apenas handle/close/summary.

Repo append(binding,event), history(manifestId,limit<=500). SQL207 não usa verifications160; append safe e guards de identidade são obrigatórios. Nunca persistir segredo HMAC, corpo consultado, configMCP ou endpoint operacional em audit.

Para repetir checks: Node24, env allowlist/HOME/bin/quota fake, tsconfig absoluto, Git temporário sem hooks/fsmonitor e PG16 próprio/provado. Não rodar suites de ownership/PG em paralelo com workspace fixtures. Não chamar onModuleInit/claim/finish de quotas reais sem substituição segura.

Publicar fonte comum por shared reconcile --packages @orbit/core-source --release <patch|minor> --files <todas-as-fontes-atribuídas>, plano antes de --write, seguido de inspeção. Não editar apenas projeção ou lock e não sincronizar UI global.

Versões finais:Core fonte1.9.3,206 mappings;Core API1.0.0/Plugin API1;UI1.1.3/74. Migrações anteriores157–160 e nova207 em arquivos, sem ativação real. Estado MCP/Codex:bloqueado,não homologado. Relatório deve ser lido como entrega parcial, não como servidor MCP funcional em produção.

## 30. Resultado final

**PARCIALMENTE CONCLUÍDA**, conforme a exceção explícita da especificação quando a integração MCP não pode ser demonstrada com segurança.

| Dimensão | Estado |
| --- | --- |
| Código Core/broker/host/auditoria |Implementados e integrados nos dois caminhos existentes. |
| Protocolo/adapter local |JSON-RPC/NDJSON orbit-context-bridge/1;streams/pipes restritos e testados. |
| Testes isolados |323 distintos PASS,0 FAIL finais,0 skipped;4 APIs compiladas. |
| Integração simulada |12 cenários Bridge nas duas filas, incluindo perguntas/turnos/retomada/fechamento, com externos fake. |
| MCP efetivamente demonstrado |Nenhum servidor/protocolo MCP oficial integrado. B19 MCP real BLOCKED. |
| Codex real/sandbox |Não homologados;guard antes de HOME/CLI, MCP vazio/network-off preservados. |
| Distribuição em arquivos |Core1.9.3/206,0 drift Core/locks;9 variantes UI mantidas. |
| Banco real |Sem aplicação ou consulta operacional;207 pendente e157–160 a verificar por ambiente. |
| Ativação/homologação |Não realizadas;flags defaultoff e sem.env alterado. |
| Git/serviços |Sem stage/commit/push/tag/deploy/restart ou Docker. main/HEAD/trabalho anterior preservados. |
| Etapas futuras |Não iniciadas;sem RAGnovo/escrita de memória/reconciliação/Git mutável/integração automática. |

O resultado permite evoluir o transporte com evidências e limites explícitos, sem atribuir a um teste fake a homologação de Codex/MCP real.
