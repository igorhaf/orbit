# Implementação06B — Adapter MCP e integração controlada com Codex

Data:2026-11-15. Referência de código e testes isolados; não autorização operacional.

## 1. Resumo executivo

**PARCIALMENTE CONCLUÍDA.** Foi implementado um adapter da especificação MCP **2025-06-18**, com handshake, catálogo fixo de cinco ferramentas read-only, schemas, tools/call, erros, NDJSON stdio e cancelamento conservador. É uma implementação do protocolo oficial, sem dependência nova de SDK ou servidor de terceiros. O protocolo proprietário orbit-context-bridge/1 continua interno e não foi renomeado para MCP.

O adapter reutiliza o broker da06 e o transporte limitado existente. Existe uma factory para ligar o MCP ao exchange do host06, sem Pool, ProjectRegistry privilegiado ou segundo broker. Uma fixture separada demonstra stdio e dois endpoints privados de transporte até o host. **Não existe um entrypoint de produção nem transporte Codex→MCP homologado**: os descritores privados da fixture não atravessam comprovadamente supervisor/launcher/CLI.

Ambos guards Codex permanecem ativos. Configuração MCP por run, ferramentas herdadas, semântica de resume e sandbox no build nativo0.160.0 não foram comprovados pelos meios permitidos. Não foi criado um modo parcialmente configurado que inicia o executor sem Bridge. A exceção de entrega parcial da especificação aplica-se a essa fronteira.

Core fonte final **1.9.4**, **208 mappings**; APIs Core1.0.0/Plugin1 preservadas. Nenhuma migration adicional, migration real, serviço operacional, Codex real, modelo pago, commit/push/tag ou etapa07.

## 2. Base documental

Leitura integral dos arquivos Markdown disponíveis em docs/sondagem-arquitetural e docs/implementacao-arquitetural, incluindo00–20,01/02/03A/03B/04/05/06; skill orbit-environment, AGENTS, contrato de experiência, aceleração e workspace. Os documentos históricos foram confrontados com código. Não houve contexto de cartão/write_scope nesta tarefa direta do IDE.

01 preserva fontes/projeções;02 revisão e CAS;03A coordinator/supervisor/quarentena;03B isolamento e Git fixture;04 manifests imutáveis;05 envelope/reservas;06 broker/host/repository/207 e guard. Nenhuma dessas garantias foi substituída por MCP.

Referências normativas consultadas: [lifecycle MCP2025-06-18](https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle), [tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools), [stdio](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports). Negociação e framing seguem essas referências; não se declara certificação externa ou suporte completo a extensões.

## 3. Estado inicial

Branch main, HEAD **d9307b8e6a54316f802acbd7bcb96baa26116f16**, preservados. Baseline desta etapa: **3336 arquivos**; árvore já suja com trabalho01–06 e produto, registrada em /tmp/orbit06b-audit/before.json e status-before.txt. O diff contra HEAD não é atribuído inteiramente à06B.

Core1.9.3/206; UI1.1.3/74; Core API1.0.0/Plugin API1. Preflight inicial mantém18 findings BLOCK associados a nove variantes UI anteriores; Core sem drift. Migration207 existia em arquivos, sem instalação real presumida. Nenhum banco de produto foi consultado.

## 4. Arquitetura herdada

ContextBridge determina fontes, autoridade, hashes, orçamento e revogação. ContextBridgeAdapter implementa o protocolo interno e o framing limitado. Host06 reautoriza lease/run/card/revisão/projeto/config/plugins/manifesto e observa fontes pelo ProjectRegistry. Repository207 grava auditoria append-only.

CardExecutionService e PromptSessionsService já abrem/fecham vínculos no ciclo protegido. CodexExecutor e CodexAiService recusam o Bridge antes de preparar HOME/iniciar CLI. Nenhuma fila, provider, registry ou broker foi reconstruído.

## 5. Investigação de compatibilidade Codex/MCP

### Evidências e classificações

Data 2026-11-15. Pesquisa somente leitura. Nenhuma execução do CLI, acesso a auth/config global, conexão com modelo/quota, instalação ou alteração de repositório. Metadados públicos, launcher local e fontes Orbit foram lidos. Histórico 06 foi recebido no contexto pai; esta pesquisa não substitui a leitura integral documental do integrador.

### Código instalado efetivamente disponível

`/home/meada/.nvm/versions/node/v24.20.0/bin/codex` é link para `../lib/node_modules/@openai/codex/bin/codex.js`. Package name @openai/codex, versão **0.160.0**; `bin.codex=bin/codex.js`. Esse pacote contém package.json, README.md e launcher JS; o executável Rust vem do pacote opcional por plataforma, não há implementação Rust do cliente MCP nesses fontes locais. Não se deduz comportamento do binário opaco a partir de nomes de flags, strings ou versão declarada.

Hashes SHA256 da leitura:

- package.json:29c350dfcd8d33749852c16e2f5dcde528409d7e1d3f5d916fe3c576f3914820
- README.md:ba4e1f69ff48386e72a9c5e1edaf76aad64a475c2d51af79ccba6d1128261ba7
- bin/codex.js:61b0194f3bb6534439c8d26a3ed57d0805f84b884588b761795323eeb92fcf70

**CONFIRMADO PELO CÓDIGO INSTALADO**: launcher determina plataforma/arquitetura, resolve pacote nativo, chama `spawn(binaryPath,process.argv.slice(2),{stdio:'inherit',env})`. O env parte de process.env e adiciona marca de package manager e package root; encaminha SIGINT/SIGTERM/SIGHUP e espelha status final. O launcher NÃO oferece montagem de servidores MCP ou forwarding explícito de descritores adicionais. Isso comprova o wrapper, não o código Rust ou a política de sandbox deste.

### Fontes oficiais atuais consultadas

As URLs antigas developers.openai.com redirecionaram para ChatGPT Learn. São páginas atuais, sem vínculo demonstrado ao build 0.160.0. Nenhuma descrição externa é promoção para homologação do instalado.

- [MCP CLI](https://learn.chatgpt.com/docs/extend/mcp?surface=cli): documenta stdio via command/args/cwd; env e env_vars; enabled_tools/disabled_tools; required, startup_timeout_sec e tool_timeout_sec. **DOCUMENTADO EXTERNAMENTE**. Não garante socket acessível sob sandbox nem descritores privados herdados. Exemplos externos com servidores de terceiros não foram executados.
- [Developer commands CLI](https://learn.chatgpt.com/docs/developer-commands?surface=cli): exec aceita overrides repetidos -c/--config e exec resume. `--ignore-user-config` evita CODEX_HOME/config.toml; autenticação continua em CODEX_HOME. **DOCUMENTADO EXTERNAMENTE**. Isso não prova que configs de projeto, plugins ou managed config sejam universalmente ignoradas; flag não deve ser tratada como supressão de toda origem.
- [Config reference](https://learn.chatgpt.com/docs/config-file/config-reference): campos MCP incluem command, args, env, env_vars, cwd, enabled_tools, disabled_tools e required. **DOCUMENTADO EXTERNAMENTE**. Página atual inclui conceitos remotos/startup_readiness/cached catalog: não assumir presença no binário local.
- [Security](https://learn.chatgpt.com/docs/security): consulta auxiliar; não forneceu prova específica de sandbox de subprocesso MCP para build instalado. Não usar como atestado de isolamento do transporte.

As paráfrases acima ficam abaixo de 200 palavras atribuídas a cada página; manter a mesma restrição ao incorporá-las no relatório principal.

### Matriz das 14 perguntas

1. **Pacote e versão** — CONFIRMADO PELO CÓDIGO INSTALADO: metadata 0.160.0 e launcher observados. Rust source indisponível localmente. Não executar --version para reforçar.
2. **Configuração nos dois executores** — CONFIRMADO PELO CÓDIGO INSTALADO (Orbit): `packages/orbit-core/src/execution/codex-executor.ts` e os quatro `apps/api/src/plugins/ai/codex-provider.ts`. Ambos recusam contextBridge antes de HOME/spawn. Generic usa sempre mcp_servers={}; isolatedCodexPolicy também contém mcp_servers={}. Prompt modo shared legado preserva diferenças e não deve ser chamado seguro para Bridge.
3. **Overrides por execução** — montagem de argv CONFIRMADO PELO CÓDIGO INSTALADO (Orbit); suporte CLI -c DOCUMENTADO EXTERNAMENTE. Semântica de merge/replacement do mapa MCP no Rust0.160.0 NÃO DETERMINADA.
4. **ignore-user-config** — Orbit o passa no genérico e no modo isolado. Semântica atual DOCUMENTADA EXTERNAMENTE; interação efetiva com config de projeto/managed/plugins no instalado NÃO DETERMINADA. `git ls-files '*config.toml' '*codex*.toml'` não retornou config versionada; isso não prova ausência de config operacional ou externa e nenhuma foi lida.
5. **Construção de -c** — CONFIRMADO PELO CÓDIGO INSTALADO (Orbit): isolated policy approval_policy="never", mcp_servers={}, network_access=false, exclude_tmpdir_env_var=true, exclude_slash_tmp=true; prompt adiciona reasoning_effort via JSON.stringify e pode adicionar --enable multi_agent. Não há construção de mapa MCP aprovado no caminho ativo.
6. **Início de stdio MCP** — DOCUMENTADO EXTERNAMENTE: command/args. Caminho real de spawning e FD hygiene do Rust local NÃO DETERMINADO.
7. **Opções aceitas instalado** — NÃO DETERMINADO além do launcher encaminhar argv sem interpretar. Não há teste isolado que prove parser nativo sem executá-lo. Fake aceita contrato decidido pela fixture, não comprova CLI real.
8. **Env para servidor** — opções env/env_vars DOCUMENTADAS EXTERNAMENTE. Launcher herda env; código Orbit isolatedProcessEnvironment é allowlist. Se o Rust filtra variáveis do servidor, não está determinado. Nunca transmitir segredo em -c/argv ou manifesto.
9. **Allowlist tools** — enabled_tools DOCUMENTADO EXTERNAMENTE; aceite no instalado NÃO DETERMINADO. Adapter do projeto pode provar catálogo fixo independente dessa opção.
10. **Falha no startup** — required/startup timeouts DOCUMENTADOS EXTERNAMENTE; comportamento real de erro/fallback/cache no0.160.0 NÃO DETERMINADO. Guard impede executar run que exige Bridge sem o canal homologado.
11. **Supervisão MCP** — CONFIRMADO PELO CÓDIGO INSTALADO (Orbit): spawnWorkspaceProcess usa supervisor Python/lease; caller stdio>3 é recusado, FDs acima de stderr reservados para guards. Python usa subreaper, pidfd/ancestry, close_fds=True e preserva ownership até drenagem. MCP iniciado pelo Rust pode ser descendente, mas essa integração específica é INFERIDA — NÃO HOMOLOGADA sem fixture da cadeia e sem prova do instalado.
12. **Sandbox dos subprocessos** — Orbit solicita sandbox workspace-write/read-only e network-off; CONFIRMADO PELO CÓDIGO INSTALADO (Orbit). Aplicação da política a MCP pelo Rust local e acesso a IPC do host NÃO DETERMINADOS. Não confundir flags com atestado de sandbox executado.
13. **Encerramento/cancelamento/drain** — supervisor implementa SIGTERM→SIGKILL, subreaper/reap, status125 para incerteza; adapters cancelam grupos. CONFIRMADO PELO CÓDIGO INSTALADO (Orbit). Fechar adapter não mata descendentes. Uso efetivo por MCP nativo permanece não homologado.
14. **Nova execução/resume** — Orbit prompt monta exec...resume sessionId e valida context/session pai/filho, policy, fingerprint/revisão e close Bridge em finally antes de waiting_answer. CONFIRMADO PELO CÓDIGO INSTALADO (Orbit). Reativação de MCP/sessão pelo Rust instalado e reaplicação de configuração em resume NÃO DETERMINADAS. Guard vigente evita migração silenciosa.

### Transporte: alternativas e riscos

| Alternativa | Criação/peer/descoberta | Segredo/revogação | Limite atual |
|---|---|---|---|
| FD anônimo herdado | Host cria pipe/duplex; autoridade é posse do endpoint entregue pelo spawn ao processo pretendido, sem nome público | Não precisa token em argv/env/arquivo; close + signal por turno revogam | Fixture direta é viável. Cadeia Orbit→supervisor→launcher→Rust→MCP não conserva FDs arbitrários hoje. close_fds=True e política de descritores são barreiras observadas, não defeito a remover. |
| Pipes stdio sem canal extra | Codex usa stdio0–2 para protocolo/prompt/eventos | Não há endpoint segundo para falar com host | Não multiplexar canal interno nas saídas Codex sem contrato real; confunde framing e autoridade. |
| Named pipe/FIFO | Host cria caminho privado | ACL700/600 ajudam, mas outro processo mesmo UID pode abrir | Nome/UUID não autentica peer; token em arquivo/env pode ser lido mesmoUID; não homologado. |
| UDS privado | Host cria socket por run, possivelmente SO_PEERCRED | Exige prova de PID/início/ancestry e segredo efêmero não exposto | UID sozinho não separa processos do mesmo usuário; Node API padrão não oferece atestado portátil completo, seccomp/network-off e path sandbox incertos. Não usar permissões como prova universal. |
| TCP loopback autenticado | Host abre listener/token | Exige segredo seguro e rede | Contraria expectativa network-off e amplia superfície; não implementar como fallback. |
| Node child_process IPC | Host inicia processo e fornece canal IPC privado | Sem token público, fechamento/aborto revoga | Viável em fixture Node diretamente lançada pelo host, não implica forwarding por Codex. Evitar afirmar que existe NODE_CHANNEL_FD preservado através do supervisor/launcher/Rust. |

**Decisão recomendada:** demonstrar adapter/stdio + transporte por endpoint privado de fixture com identidade por spawn, sem credenciais de produto, e manter integração Codex bloqueada. Não adicionar runtime switch que aceite caminho/token escolhido pelo agente. A prova de fixture permite testar protocolo e revogação, não prova sandbox nativo. Não criar daemon, socket de produção ou mecanismo de transporte privilegiado sem peer robusto. Se integrador escolher pipes por spawn direto, registrar a diferença entre autoridade por endpoint privado e isolamento universal contra processos mesmoUID com ptrace/procfs.

### Lifecycle herdado relevante

- `openContextBridge` continua único dono de autorização atual (lease, ator/card/revisão, projeto, plugin/config, selo Git/raiz, latest manifesto).
- ContextBridge possui signal/revoke/close e recusa respostas tardias. Auditoria207 conserva response_prepared distinto de response_emitted (host adapter intake) e delivery_unverified. Não promover evento para consumo pelo modelo.
- maxTotalBytes/maxResponseBytes/reserva de256 já existem; envelope MCP pode exceder256 especialmente structuredContent+text duplicados. Adapter precisa envelope simples conservador ou ajuste aditivo de reserva pelo host/broker, sem segundo orçamento de dados.
- Prompt sessions fecha bridge no finally da chamada do provider, inclusive pergunta e erro; resume reautoriza, prepara manifesto filho e novo vínculo. Credencial anterior não deve ser reutilizada.
- PluginDefinition e PluginRegistry continuam autoridade registrada; ferramentas fixas read-only são facade do broker, não registry novo.

### Lacunas que exigem registro explícito

Nada nesta pesquisa comprova que0.160.0 inicia MCP com apenas servidor aprovado, que impede config de projeto/plugin herdado, que não reutiliza servidor antigo em resume, que preserva sandbox/network-off do processo MCP ou que encaminha canal privado. Manter ambos guards. A ausência de prova é suficiente para classificação parcial prevista na06B, sem bloquear a implementação e testes locais do adapter oficial.

## 6. Alternativas de transporte

A tabela e as14 classificações em§5 documentam a investigação. A escolha de teste é par de endpoints anônimos entregue exclusivamente pelo spawn da fixture ao filho pretendido. Não existe listener, nome de socket, token em argv/env ou arquivo de credencial.

Isso comprova o encaminhamento direto entre processos sintéticos. Não comprova resistência universal a ptrace/procfs por outro processo do mesmo UID nem passagem pelo Codex. FIFO/UDS com0700/0600/UUID não resolveriam essa prova; loopback introduziria rede e segredo. Nenhum desses mecanismos foi instalado como fallback operacional.

## 7. Decisão arquitetural

Adicionar ContextBridgeMcpAdapter por herança do framing já existente, com override somente do dispatcher protocolar. A mudança no adapter interno é apenas private→protected de processJsonRpc. handleJsonRpc continua aplicando limites de frame/mensagens/transporte, e attach continua cuidando de UTF-8 NDJSON, pending input, escrita serializada/backpressure, erro e fechamento.

A factory createContextBridgeMcpForHost traduz somente initialize interno e capabilities/call para o exchange autorizado. maxTransportBytes/maxResponseBytes/maxMessages/concurrency são derivados dos limites do descriptor emitido pelo host. O MCP não decide ator/run/workspace nem inventa configuração.

Nenhum novo flag de homologação foi criado: não há caminho nativo aprovado a habilitar. Bridge opt-in permanece insuficiente para retirar guard. Melhor deixar a lacuna explícita do que introduzir uma configuração executável sem canal seguro.

## 8. Contrato MCP

Versão única suportada:2025-06-18. initialize recebe protocolVersion/capabilities/clientInfo e retorna a versão suportada, serverInfo e capabilities.tools.listChanged=false. Se a versão solicitada for outra, oferece2025-06-18; cliente incompatível deve desconectar. notifications/initialized conclui a negociação; tools antes disso são recusadas. ping retorna objeto vazio. Não há resources/prompts/sampling/elicitation/logging/listChanged anunciados.

| Ferramenta | Consulta06 | Schema |
|---|---|---|
| orbit_context_describe | context.describe | {} |
| orbit_sources_list | sources.list | offset0–1024,limit1–1024 opcionais |
| orbit_sources_read | sources.read | sourceId opaco obrigatório;maxBytes1–65536 opcional |
| orbit_context_compatibility | context.compatibility | {} |
| orbit_sources_dependencies | sources.dependencies | sourceId opaco obrigatório |

Todos schemas são objetos com additionalProperties=false; sourceId obedece src_+64hex. Schemas de leitura são explícitos e não aceitam caminhos/identidade/config. Catálogo fixo retorna inteiro, sem cursor.

Respostas usam content:[] e structuredContent contendo integralmente o resultado06: código/status/hash/proveniência/trust/compatibilidade/limitações/bytes. Omitir a cópia textual opcional evita duplicar corpo e orçamento; clientes somente-texto não foram homologados. Não se anuncia outputSchema.

JSON-RPC: -32600 estrutura inválida; -32602 schema/tool desconhecida; -32601 método desconhecido; -32001 vínculo revogado; -32002 inicialização incompleta. Recusas de negócio usam isError=true e error.code do broker (fonte não selecionada/indisponível/alterada, limite, autorização, timeout, auditoria). Falhas internas não vazam mensagens privadas. Erros já reduzidos pelo adapter06 ao erro genérico não podem ser reconstruídos pela factory; esse limite é preservado. Notificações não recebem respostas.

## 9. Adapter MCP

Novo módulo canônico src/execution/context-bridge-mcp.ts. ContextBridgeMcpAdapter recebe ContextBridgeAdapterHandle, herdando limites/attach/close. Somente tools/call chega à query do vínculo; cada chamada recebe requestId aleatório gerado pelo host do adapter. Não há seleção de capability arbitrária nem passagem de IDs do agente para ownership.

notifications/cancelled causa encerramento conservador de todo o vínculo, incluindo consultas simultâneas. Não promete cancelar apenas uma consulta e manter outras. IDs de cancelamento inválidos não concedem autoridade. O signal do host encerra o adapter; retornos tardios não contêm corpo autorizado depois da revogação.

O módulo é infraestrutura protocolar do Core, sem import concreto de IA; consumidores Codex só poderão ligá-lo quando o transporte estiver homologado. Não existe registro MCP concorrente ao PluginRegistry.

## 10. Canal entre processos

O teste tools/orbit/context-bridge-mcp.test.mjs inicia um Node filho sintético. stdin/stdout são exclusivamente MCP; descritores3/4 são endpoints privados adicionais para protocolo interno06. O host usa ContextBridgeAdapter; o filho recebe somente query/close do transporte, sem DB/registry/credenciais globais. HOME/CODEX_HOME descartáveis, env explícito, cwd temporário.

O filho envolve os descritores socketpair anônimos do Node com net.Socket({fd}), sem connect/listen/endereço de rede. A primeira fixture usava fs streams bloqueantes e travava o término por leitura pendente na threadpool; foi corrigida para streams não bloqueantes. Logs intermediários não contam como PASS.

A posse do endpoint é capacidade por spawn direto. Mesmo UID com acesso proc/ptrace permanece fora da prova. Não se escreve segredo em config/manifesto/log; não se usa UUID como autenticação. Encerrar processos/streams destrói endpoints, sem restart ou reconexão. A prova não satisfaz o transporte pela cadeia Codex; M14 permanece parcialmente bloqueado.

## 11. Integração ao broker

Ferramentas mapeiam exatamente para as cinco queries06. O adapter não lê arquivos, não observa contexto, não modifica manifesto, não escreve auditoria concorrente e não amplia readableSourceIds. Query/refusal e limites continuam no broker.

createContextBridgeMcpForHost(host,close) inicializa o exchange orbit-context-bridge/1 já criado por openContextBridge; cria o facade MCP com a mesma signal e limites. A função não reabre binding encerrado. Seu teste usa broker e adapter reais; as provas de autorização atual do host continuam nas suites06.

## 12. Integração com CodexExecutor

**BLOCKED para configuração MCP ativa; guard preservado.** Nenhum novo mapa mcp_servers é passado ao CLI, nenhum binário ou socket vem do prompt. O caminho legado mantém montagem de argumentos/HOME/supervisor e mcp_servers={}. O teste de provider06 usa CLI fake e verifica recusa antes de HOME/spawn.

Não há prova permitida de que0.160.0 aceite um mapa isolado sem merge de fontes externas nem de forwarding de endpoints. Criar apenas um mapa sintético e dizer que o CLI recebeu não resolveria esse contrato. Não foi introduzida essa falsa integração.

## 13. Integração com CodexAiService

**BLOCKED para MCP ativo nos quatro produtos.** CodexAiService/codex-provider e prompt-sessions não foram reescritos. O parâmetro interno de Bridge continua provocando o guard antes do CLI. Preservados sessões/Q&A, quota fake nos harnesses, multiagent, assinaturas e diferenças intencionais de Safdoulas/Suindá.

As filas já passam e fecham o handle06; a factory fornece uma fronteira futura de adapter, não prova de conexão de ambas filas ao CLI nativo. Os testes de fila existentes exercitam turno filho/política atual/fechamento e não são apresentados como integração MCP real.

## 14. Sandbox e segurança

Nenhuma alteração em isolated-execution-policy, workspace-process, supervisor Python, coordinator, checkout manager ou guards. MCP vazio, network-off, ignore-user-config, sandbox e approval existentes preservados por hash. Não houve danger-full-access, bypass de sandbox, fallback de rede ou config global alterada.

A fixture é um processo Node direto e **não é prova de sandbox Codex**. Aprovação/autenticação/sandbox do binário real permanecem não determinados. Não se usa flag de Bridge para assumir essa homologação.

## 15. Lifecycle

Host06 mantém preparação/autorização/run/turno e close no finally. MCP mantém new→initializing→ready→closed; não há reinitialize após fechar. EOF encerra attach e fecha vínculo; signal/cancelamento impede novas respostas. Falha de handshake não executa query. Falha crítica host/closeTransport revoga; timeout da consulta permanece no broker.

Perda de lease, cancelamento, PostgreSQL/auditoria e source changes conservam regras06. Pergunta pendente fecha o vínculo anterior; resume revalida card/turno/manifesto/fontes/política/sessão e cria outro vínculo. Não se transfere canal antigo. Processo crash não autoriza restart/reconexão.

Fechamento do adapter não mata descendentes: responsabilidade permanece supervisor03A. Locks não foram liberados por sinais novos. Drain/quarentena e supervisão MCP real pela cadeia Codex ainda precisam de prova autorizada; não há daemon.

## 16. Orçamento

Não existe segundo orçamento de dados MCP. Broker06 continua dono de maxRequests/maxResponseBytes/maxTotalBytes/timeout/concurrency/fontes/depth. O framing herdado limita bytes de todos os envelopes e mensagens de controle e continua mais restritivo que o orçamento do vínculo.

Cada resposta tools/call contém somente uma cópia do resultado estruturado. Diferença de bytes entre envelope MCP e resposta06, incluindo newline, precisa caber na reserva existente de256bytes; caso contrário fecha e recusa. IDs wire limitados a64ASCII ou inteiros seguros. Não foram alteradas reservas05/06 ou migrations.

Catálogo/initialize também consomem o teto de transporte derivado do host; configurações pequenas podem não comportar catálogo e devem falhar fechadas. Bytes não equivalem a tokens faturados. Não há afirmação de economia mensurada.

## 17. Auditoria

Reutilizada207. request_received/authorized/response_prepared/denied/revoked/closed e delivery_unverified continuam no broker; response_emitted permanece intake do adapter do host06. MCP não redefine esses eventos como leitura pelo CLI/modelo nem cria contadores persistentes independentes.

Envelope MCP preserva resultado/proveniência/hash; não escreve corpo, endpoint ou credencial no ledger. O teste direto de broker não gera response_emitted do host porque não passa pelo host intake: esse limite é explícito. Não há prova de interpretação/uso semântico pelo modelo.

## 18. Plugins

PluginRegistry/PluginDefinition, dependências, parentPlugin, capabilities/actions e RBAC permanecem intactos. Catálogo MCP é fachada fixa do broker, sem descoberta de ferramentas publicadas por plugins. Core não importa plugin IA. Nenhum consumo vetorial de Suindá, RAG ou integração externa foi modificado. Core API1.0.0/Plugin API1 mantidos.

## 19. Implementação arquivo por arquivo

| Caminho/família | Antes; alteração e razão | Consumidor/compatibilidade/risco |
|---|---|---|
| packages/orbit-core/src/execution/context-bridge-adapter.ts | Dispatcher privado passa a protected, para reutilizar framing sem duplicá-lo. | Protocolo06 inalterado; herança restringe nova superfície a transport adapter. |
| packages/orbit-core/src/execution/context-bridge-mcp.ts | Novo facade MCP e factory host. | Usa broker/exchange06; não provisiona CLI/processo; guard nativo continua. |
| packages/orbit-core/src/execution/context-bridge-mcp.spec.ts | Novos9 testes com broker real. | Schemas, proveniência, revogação, budget e factory; sem DB real. |
| tools/orbit/context-bridge-mcp.test.mjs | Novo teste de processo/stdio/canal de fixture. | No Codex; processo fake direto não é sandbox nem peer universal. |
| orbit.workspace.json;packages/orbit-core/package.json | Dois mappings novos e release selecionada1.9.4. |208 mappings; versionamento fonte separado da API. |
| {dev,prod,safdoulas,suinda}/app/orbit.shared-lock.json | Gerado oficialmente. | Versão/hash Core atualizados; UI preservada. |
| {dev,prod,safdoulas,suinda}/app/apps/api/src/execution/{context-bridge-adapter.ts,context-bridge-mcp.ts,context-bridge-mcp.spec.ts} | Quatro projeções por fonte, geradas. | Sem cópia integral de DEV ou edição isolada. |
| docs/implementacao-arquitetural/06B-ADAPTER-MCP-E-INTEGRACAO-CODEX.md | Novo relatório. | Referência de limites; não autorização de ativação. |

Inventário exato desta etapa (inclui individualmente cada projeção):

- forge/app/apps/api/src/execution/context-bridge-adapter.ts
- forge/app/apps/api/src/execution/context-bridge-mcp.spec.ts
- forge/app/apps/api/src/execution/context-bridge-mcp.ts
- forge/app/orbit.shared-lock.json
- orbit.workspace.json
- packages/orbit-core/package.json
- packages/orbit-core/src/execution/context-bridge-adapter.ts
- packages/orbit-core/src/execution/context-bridge-mcp.spec.ts
- packages/orbit-core/src/execution/context-bridge-mcp.ts
- workspace/app/apps/api/src/execution/context-bridge-adapter.ts
- workspace/app/apps/api/src/execution/context-bridge-mcp.spec.ts
- workspace/app/apps/api/src/execution/context-bridge-mcp.ts
- workspace/app/orbit.shared-lock.json
- safdoulas/app/apps/api/src/execution/context-bridge-adapter.ts
- safdoulas/app/apps/api/src/execution/context-bridge-mcp.spec.ts
- safdoulas/app/apps/api/src/execution/context-bridge-mcp.ts
- safdoulas/app/orbit.shared-lock.json
- suinda/app/apps/api/src/execution/context-bridge-adapter.ts
- suinda/app/apps/api/src/execution/context-bridge-mcp.spec.ts
- suinda/app/apps/api/src/execution/context-bridge-mcp.ts
- suinda/app/orbit.shared-lock.json
- tools/orbit/context-bridge-mcp.test.mjs

## 20. Persistência e migrations

Nenhuma nova tabela ou migration.207_context_bridge_audit.sql e157–160 preservadas por hash, assim como migrations específicas dos produtos. Testes PostgreSQL usam instância descartável da ferramenta existente; nenhum banco operacional foi consultado/aplicado. Reutilizar ledger207 não presume que já exista em cada produto.

## 21. Testes M1–M20

| Cenário | Estado e evidência | Limitação |
|---|---|---|
| M1 handshake | PASS — mcp.spec, initialize/initialized/versão/ordem. | Não é parser nativo Codex. |
| M2 catálogo | PASS — somente cinco schemas read-only. | Sem recursos/extensões extras. |
| M3 chamada | PASS — queries reais do broker e factory exchange. | In-process/facade autorizado. |
| M4 schema | PASS — tool desconhecida/parâmetros/tipos rejeitados. | Sem mutation tools. |
| M5 fora manifesto | PASS — fonte opaca arbitrária recusada. | Fonte conhecida também exige ACL do host. |
| M6 proveniência | PASS — body/hash/trust/status preservados. | Sem prova de uso pelo modelo. |
| M7 runs separados | PASS — sourceIds distintos por binding. | Fixtures sintéticas. |
| M8 binding antigo | PASS — close impede reabrir. | Sem credencial de rede. |
| M9 cancelamento | PASS — consulta pendente não entrega corpo tardio. | Revoga vínculo inteiro. |
| M10 orçamento | PASS — reserva256 e teto não resetáveis. | Catálogo pode falhar em teto pequeno. |
| M11 concorrência | PASS — broker recusa concorrência excedente. | Nenhum contador de dados paralelo. |
| M12 supervisor | PASS nas regressões03A/03B; BLOCKED cadeia MCP nativa. | Fixture nova é spawn direto; não afirmar integração supervisora nova. |
| M13 stdio | PASS — filho real sintético initialize/list/call/close. | No Codex. |
| M14 transporte | PASS plumbing/endpoints privados/env da fixture; BLOCKED autenticação/isolamento suficientes pela cadeia Codex. | Mesmo UID/proc/ptrace e forwarding não homologados. |
| M15 executor | PASS guard/legado fake06; BLOCKED configuração MCP ativa. | Sem mapa novo que inicie parcialmente. |
| M16 provider | PASS guard/filas fake06; BLOCKED MCP ativo. | Preservadas diferenças de runtime. |
| M17 isolado | PASS contratos/regressões anteriores; BLOCKED sandbox MCP nativo. | Flags não provam comportamento do Rust. |
| M18 pergunta | PASS regressão filas/turno06; BLOCKED retomada MCP nativa. | Bridge antigo não reutilizado. |
| M19 regressão | Resultados e comandos§22. | Sem suíte global. |
| M20 homologação | PASS distinção explícita; real NOT_RUN. | Sem CLI/modelo/autenticação real. |

Comandos novos seguros:
```sh
TSX_TSCONFIG_PATH=forge/app/apps/api/tsconfig.json node --import ./forge/app/node_modules/tsx/dist/loader.mjs --test forge/app/apps/api/src/execution/context-bridge-mcp.spec.ts
node --test tools/orbit/context-bridge-mcp.test.mjs
```
Logs locais: /tmp/orbit06b-audit. Falhas intermediárias de timeout da fixture foram corrigidas; não contam como testes aprovados.

## 22. Testes de regressão

**311 testes distintos aprovados;0 falhas finais,0 cancelados,0 ignorados.** Contagem:147 unitários existentes;9 novos unitários MCP;1 teste MCP de processo;125 testes de topo das regressões;17 cenários filhos compiler e12 Bridge, contados uma vez. Wrappers de orquestração e seus filhos estão separados; reexecuções e suites focadas sobrepostas não são adicionadas.

| Suite/log em /tmp/orbit06b-audit | PASS |
|---|---:|
| unit-final | 147 |
| mcp-unit-final | 9 |
| mcp-process | 1 |
| context-compiler-workers | 1 |
| context-compiler-provider | 1 |
| bridge-workers | 1 |
| bridge-provider | 1 |
| context-workers | 10 |
| isolation-regressions | 18 |
| context-postgres | 10 |
| bridge-postgres | 8 |
| regressions | 75 |
| Compiler filhos |17 |
| Bridge filhos |12 |

Quatro TypeScript: dev/prod/safdoulas/suinda, todos exit0. Logs tsc-<runtime>.log vazios significam ausência de diagnóstico, e o exit foi conferido. Prompt-question separado e navegador não foram reexecutados: código desses componentes permaneceu inalterado. Os harnesses reais das duas filas cobriram política/turno/closure.

Comandos executados em ambiente sintético pelos harnesses existentes:
```sh
node --test tools/orbit/context-compiler-workers.test.mjs
node --test tools/orbit/context-compiler-provider.test.mjs
node --test tools/orbit/context-bridge-workers.test.mjs
node --test tools/orbit/context-bridge-provider.test.mjs
node --test tools/orbit/context-workers.test.mjs
node --test tools/orbit/isolated-checkout.test.mjs tools/orbit/isolated-provider.test.mjs tools/orbit/isolated-workers.test.mjs
node --test tools/orbit/context-manifests.postgres.test.mjs
node --test tools/orbit/context-bridge.postgres.test.mjs
node --test tools/orbit/shared.test.mjs tools/orbit/preflight.test.mjs tools/orbit/catalog.test.mjs tools/orbit/registry-foundation.test.mjs tools/orbit/card-revision-ui.test.mjs tools/orbit/card-version-enqueue.test.mjs tools/orbit/card-revisions.postgres.test.mjs tools/orbit/workspace-coordinator.postgres.test.mjs tools/orbit/workspace-workers.test.mjs
node <runtime>/app/node_modules/typescript/bin/tsc --noEmit --incremental false -p <runtime>/app/apps/api/tsconfig.json
```

A lista unitária147 contém broker/host/adapter/repository, compiler/host/delivery, manifest/registry/runtime, execução, permissões/file-scope e coordinator/supervisor. Lista integral e ambiente em /tmp/orbit06b-audit/regress.py. Suites com PostgreSQL e workers descartáveis executadas sequencialmente; não houve suíte global ou processo Codex autenticado. O teste MCP novo não chama CLI real.

## 23. Monorepo e projeções

Core fonte1.9.4/208 mappings, integridade0ee4fe03edebe4b37cc8da2938dd55fc5297abbb60659d5c942a61c7d2b6dbd4, por publicação selecionada oficial, plano e precondições. Somente @orbit/core-source foi reconciliado. UI1.1.3/74 permanece; nove variantes históricas e seus18 findings BLOCK permanecem. Preflight global não é declarado PASS.

Arquivos atribuídos: context-bridge-adapter.ts, context-bridge-mcp.ts, context-bridge-mcp.spec.ts, package.json canônico e workspace. Relatórios de plano/apply em /tmp/orbit06b-audit/release-plan.json e release.json. Nenhuma edição manual de hashes.

Comando de referência (não repetir publicação sem motivo):
```sh
node tools/orbit/cli.mjs shared reconcile --packages @orbit/core-source --release patch --files packages/orbit-core/src/execution/context-bridge-adapter.ts,packages/orbit-core/src/execution/context-bridge-mcp.ts,packages/orbit-core/src/execution/context-bridge-mcp.spec.ts,packages/orbit-core/package.json,orbit.workspace.json
```

## 24. Segurança operacional

Sem Codex real, modelos/embeddings pagos, APIs de produto/quota, instalação MCP de terceiro, Docker, serviços reais, .env, config global, Git mutável original, migration real, deploy/restart. Fixtures temporárias próprias foram removidas pelos respectivos testes; não se limpou quarentena operacional. Nenhuma autorização de ativação foi inferida das leituras de documentação pública.

Tarefa usou skill orbit-environment para trabalho direto. Uma frente delegada de pesquisa concluiu apenas /tmp; a frente inicialmente proposta para código atingiu limite antes de editar. Integrador implementou/revisou todo código. Não há alegação de ganho de tokens/tempo mensurado.

## 25. Inventário Git

Baseline3336 arquivos, main/HEAD preservados. Inventário por hash final em /tmp/orbit06b-audit/inventory.json. Arquivos desta etapa não foram staged/commitados. Trabalho anterior permanece local.

Modificados nesta etapa:11; novos:12, incluindo este relatório. Contagens finais conferidas por hash e status Git. Nenhum baseline removido. Host/broker/repository/207/compiler/manifest/coordinator/supervisor/checkout/providers/filas/configurações e UI anteriores preservados por hash fora dos três arquivos canônicos alterados/adicionados e metadados de distribuição listados em§19.

## 26. Limitações e riscos

1. Não existe cadeia MCP ativa nos executores reais; guard continua bloqueando.
2. SDK oficial não foi instalado; implementação segue o subconjunto normativo declarado, sem certificação externa ou teste por cliente MCP de terceiro.
3. Content somente estruturado exige cliente compatível; text-only não foi homologado.
4. Cancelamento é por binding inteiro; não preserva consultas vizinhas.
5. Catálogo fixo/limites pequenos podem esgotar envelope de transporte; falha fechada é esperada.
6. Descritores de fixture não atravessam comprovadamente supervisor/launcher/Codex. Peer mesmoUID não tem isolamento universal.
7. Configuração real pode mesclar fontes externas ou reaproveitar estado de sessão; comportamento no0.160.0 não determinado.
8. Sandbox MCP não foi executado. FDs não são autorização para ampliar sandbox.
9. Auditoria mantém fronteira de intake do host; não comprova entrega ao CLI/modelo.
10. Limites/FS/Git/observação e autorização continuam com os limites documentados06; MCP não torna o snapshot atômico.
11. A factory inicializa um exchange uma vez; não é reconnect/resume de um handle já negociado. Falhas exigem fechamento pelo owner do host.
12. Clientes não podem escolher comando/socket/path/env; nenhuma API pública foi aberta para esses parâmetros.

## 27. Pendências de homologação

Antes de qualquer ativação: obter prova versionada de parser/config MCP0.160.0; demonstrar exclusão de configs externas; projetar transporte seguro que sobreviva à cadeia supervisionada sem relaxar sandbox; comprovar peer/run/turno e revogação; integrar processo MCP ao drain e testar crash/perda de lease/PG; comprovar sessão nova/resume sem ferramenta herdada; homologar ambas filas nos quatro runtimes.

CLI real exige autorização futura específica; não é realizado automaticamente. Verificar schema207 separadamente em cada banco antes de habilitar host. Não modificar .env ou serviços como parte desta entrega.

## 28. Preparação da próxima etapa

O facade MCP pode consumir somente as fontes já autorizadas, seus hashes/proveniência e recusas. Futuras fontes/RAG/conhecimento/registro de descobertas exigem contratos próprios, seleção/permissões e política capturada. MCP não concede escrita, memória persistente, reconciliação ou aprovação de integração. Nenhum desses recursos nem a07 foi iniciado.

## 29. Handoff técnico

Entradas: packages/orbit-core/src/execution/context-bridge-mcp.ts e testes; factory createContextBridgeMcpForHost({exchange,signal,descriptor},close). A fábrica exige handle novo autorizado do host06 e close explícito do owner. Nunca fornecer Pool/registry ao servidor.

Exemplo MCP:
```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"fixture","version":"1"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"orbit_sources_list","arguments":{"limit":1}}}
```
Mensagens acima são linhas independentes. stdout só contém MCP; diagnóstico em stderr. Source IDs são recebidos do catálogo autorizado, nunca caminhos. Resultado de leitura permanece dado não confiável.

Não há exemplo de configuração Codex executável nesta entrega: suporte e canal não foram comprovados. Continuar usando mcp_servers={} e os guards. ORBIT_CONTEXT_BRIDGE_ENABLED ausente/0 mantém default desativado; nenhum valor autoriza MCP nativo por si só. Não reaproveitar configuração de usuário como fallback.

## 30. Resultado final

**PARCIALMENTE CONCLUÍDA.**

| Dimensão | Estado |
|---|---|
| Adapter MCP e contratos | Implementados;2025-06-18, cinco ferramentas read-only. |
| Broker/autorização | Reutilizados da06, sem reconstrução. |
| Unitários | Aprovados nos resultados§22. |
| Processo/stdio | Aprovado com filho sintético e endpoints privados. |
| Transporte Codex↔MCP↔host | Bloqueado/não homologado. |
| CodexExecutor/CodexAiService | Guards preservados; configuração MCP ativa bloqueada. |
| Pacote instalado |0.160.0 metadata/launcher observados; MCP/sandbox do Rust não comprovados. |
| Codex real | NOT_RUN, conforme restrição. |
| Sandbox | Contratos/regressões preservados; sandbox MCP nativo não homologado. |
| Persistência em arquivos | Core1.9.4/208 distribuído aos quatro runtimes. |
| Migrations reais/ativação/deploy | Não executados. |

Nenhuma continuidade automática para a07.
