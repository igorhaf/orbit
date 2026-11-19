# Implementação06C — Fechamento de transporte MCP/Codex

Data:2026-11-15. Entrega de código e validação isolada; sem autorização operacional.

## 1. Resumo executivo

**PARCIALMENTE CONCLUÍDA.** Implementados entrypoint MCP utilizável, transporte UDS Linux por vínculo com identidade kernel do cliente, assinatura efêmera do host, revogação e integração sintética com coordenador/supervisor reais. O adapter06B e broker06 foram reutilizados. A cadeia sintética passa para card_runs e card_ai_runs, incluindo falha de handshake e queda do MCP.

A compatibilidade textual foi acrescentada como representação alternativa escolhida pelo host, sem duplicar o corpo ou ampliar a reserva256. O CLI nativo0.160.0 foi inspecionado offline, sem autenticação/inferência, em namespace sem rede e filesystem mínimo.

**Os dois adapters Codex reais continuam bloqueados para Bridge.** Há prova offline de merge de mapas MCP com servidores prévios no bootstrap/listagem, mas não prova de exclusão completa no exec/resume. Também não há modo comprovado de obter PID confiável do MCP lançado pelo Codex nem de acesso ao UDS sob seu sandbox. O launcher de teste não substitui essas provas.

Core fonte final **1.9.6**, **213 mappings**; Core API1.0.0/Plugin API1 mantidos. Sem migration nova/real, ativação, restart, deploy, Git mutável original ou etapa07.

## 2. Documentação considerada

Sondagens00–20 e implementações01–06B disponíveis foram lidas e confrontadas com os pontos de código relevantes, sem nova sondagem geral. Referência principal06B: resultado parcial, Core1.9.4/208, MCP2025-06-18, guard ativo,311 testes isolados. Consultados AGENTS, skill orbit-environment, workspace e contratos de experiência/aceleração/plugins.

01 fontes/projeções;02 revisão/CAS;03A lease/supervisor/quarentena;03B checkout/isolamento;04 manifestos;05 compilation/material/reservas;06 broker/autorização/auditoria207;06B MCP. Esses contratos foram preservados.

Normas MCP utilizadas pela06B continuam referência: [lifecycle2025-06-18](https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle), [tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools), [transportes](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports). O padrão permite dados estruturados e recomenda texto para compatibilidade; aqui são modos alternativos, explicitamente testados, sem afirmar compatibilidade com todo cliente.

## 3. Estado inicial

main, HEAD **d9307b8e6a54316f802acbd7bcb96baa26116f16**, preservados. Core1.9.4/208, UI1.1.3/74, APIs Core1.0.0/Plugin1. Migration207 em arquivos, sem instalação operacional presumida. Preflight inicial contém18 BLOCK das mesmas nove variantes UI; não se toma gate global como PASS.

Baseline Git/hashes e árvore suja anterior registrados em /tmp/orbit06c-audit/before.json e status-before.txt. Mudanças01–06B e produto não são atribuídas integralmente à06C. Nenhum banco/config operacional foi lido para inferir estado.

## 4. Arquitetura herdada

ContextBridge controla autorização, seleção, proveniência, quotas e revogação. ContextBridgeAdapter mantém protocolo proprietário e framing limitado; ContextBridgeMcpAdapter traduz ferramentas MCP. ContextBridgeRepository/207 registra auditoria; openContextBridge realiza autorização atual.

As filas existentes já criam/fecham o handle06. CodexExecutor/CodexAiService recusam Bridge antes de iniciar CLI. Supervisor Python mantém descritores de proteção/close_fds/subreaper/drain e coordinator físico permanece autoridade de escrita. Não houve nova fila, broker, registry ou provider.

## 5. Evidências do CLI instalado

### Evidência versionada

Data: 2026-11-15. Escopo desta frente: metadados, launcher, ajuda nativa e bootstrap/listagem MCP sintéticos. Nenhum arquivo do repositório foi alterado. Não houve inferência, autenticação, acesso a configuração real, modelo/quota, instalação, serviço de produto, Git mutável ou rede externa.

### Método e autorização

A exceção expressa da06C autoriza somente operações locais informativas não interativas sem inferência, depois de isolamento comprovado. Antes de executar, foram lidos o launcher instalado, package.json, skill orbit-environment, trechos relevantes dos contratos06/06B e código dos dois executores/política isolada. O launcher não interpreta flags e passa argv ao binário nativo por spawn com stdio0–2/env herdado. A leitura não acessou auth/config global.

Não foi usado o launcher com ambiente real. Foi executado diretamente **o mesmo executável nativo instalado resolvido pelo launcher**, somente para os comandos informativos abaixo. Isolamento por `/usr/bin/bwrap`: namespace de rede novo sem interfaces externas, namespace PID novo e `/proc` próprio, root mínimo com somente binário nativo read-only, `/dev`, `/tmp` descartável, HOME/CODEX_HOME temporários próprios e `/work` sintético. `--clearenv`, PATH=/bin, NO_COLOR=1; stdin=/dev/null; timeout15s por comando; `--die-with-parent --new-session`. Nenhum `/home/meada`, repositório, config real, token, DATABASE_URL, OPENAI_API_KEY, proxy ou auth foi montado/herdado. As únicas escritas possíveis no filesystem visível ficaram em fixtures descartáveis.

Antes dos comandos, o mecanismo de namespace foi provado com `unshare -Urn -- /usr/bin/true`, e uma operação Python no namespace novo observou somente interface lo; tentativa TCP para1.1.1.1:443 retornou errno101 (network unreachable). `bwrap --unshare-net ... /usr/bin/true` também passou. Os comandos Codex usam bwrap próprio com isolamento de rede e filesystem, independentemente dessa prova auxiliar. Nenhum acesso externo foi necessário.

Prefixo exato reproduzível nas evidências JSON:

```text
/usr/bin/bwrap --unshare-net --unshare-pid --die-with-parent --new-session --clearenv \
  --ro-bind <binary-instalado> /bin/codex \
  --bind <home-temporario-vazio> /home/offline \
  --proc /proc --dev /dev --tmpfs /tmp --dir /work \
  --setenv HOME /home/offline --setenv CODEX_HOME /home/offline/.codex \
  --setenv PATH /bin --setenv NO_COLOR 1 --chdir /work -- /bin/codex <args>
```

Para testes de configuração de projeto, `/work` foi bind de uma segunda pasta temporária própria contendo somente `.codex/config.toml` sintético. No teste inicial era diretório vazio. Não se montou o checkout Orbit. Comandos foram chamados por Python subprocess com env externo mínimo PATH=/usr/bin:/bin e stdin DEVNULL. HOME/CODEX_HOME descartáveis foram removidos ao final. Arquivos de evidência estão somente em `/tmp/orbit06c-offline/`.

### Executável e versão

- Package wrapper `/home/meada/.nvm/versions/node/v24.20.0/lib/node_modules/@openai/codex/package.json`:0.160.0.
- Native package:0.160.0-linux-x64.
- Executável: `/home/meada/.nvm/versions/node/v24.20.0/lib/node_modules/@openai/codex/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex`.
- ELF static-pie x86-64, stripped; SHA256 **12eb3e81114588aca3b7998f4f19e8997b056aca08e57a7ca7c8a3ec8c652aad**.
- **CONFIRMADO NO BINÁRIO INSTALADO POR OPERAÇÃO OFFLINE:** `/bin/codex --version` exit0, stdout `codex-cli 0.160.0`, stderr vazio.

### Comandos informativos executados

Todos abaixo dentro do prefixo bwrap descrito. JSON guarda argv completo/exit/stdout/stderr, e cada stdout/stderr também tem arquivo separado.

| Nome | Argumentos | Exit | Conclusão exata |
|---|---|---:|---|
| version | --version |0| Versão nativa0.160.0. |
| help | --help |0| -c/--config key=value, nested dotted paths/TOML declarados pela ajuda nativa. |
| exec-help | exec --help |0| --ignore-user-config existe em exec; descrição informa que ignora CODEX_HOME/config.toml e auth ainda usa CODEX_HOME. Não houve execução de prompt. |
| mcp-help | mcp --help |0| Subcomandos list/get/add/remove/login/logout presentes; somente list/help foram utilizados. |
| mcp-list-help | mcp list --help |0| --json e -c aceitos na listagem. |

A ajuda de exec também anuncia sandbox read-only/workspace-write/danger-full-access, exec resume/fork, --ephemeral, --ignore-rules e --json. Isso é somente descoberta de parser/ajuda. Nenhuma opção perigosa foi utilizada, nenhum exec com prompt/sessão foi chamado, e nenhuma dessas descrições atesta política aplicada ao MCP.

### Testes do bootstrap/parser MCP

Configuração base sintética:

```toml
[mcp_servers.foreign_fixture]
command="/not-mounted-foreign"
args=["fixture"]
```

Mapa explícito testado via -c:

```toml
mcp_servers={orbit_context={command="/not-mounted-orbit",args=["fixture"],cwd="/work",env={ORBIT_SYNTHETIC="1"},env_vars=["ORBIT_SYNTHETIC"],enabled_tools=["orbit_context_describe"],required=true,startup_timeout_sec=2,tool_timeout_sec=3}}
```

Os comandos de servidor são propositalmente inexistentes e não montados. Nenhuma ferramenta MCP foi chamada. `mcp list` retornou configuração e auth_status=unsupported, sem executar conexão útil ou modelo. Mesmo que houvesse tentativa não observada de processo/rede, não havia executável autorizado correspondente nem acesso externo no namespace.

| Caso | Comando/variação | Exit | Evidência |
|---|---|---:|---|
| list-empty | mcp list --json, config vazio |0| [] |
| list-config | mcp list --json, foreign_fixture em config |0| Somente foreign_fixture. |
| list-empty-map-override | -c 'mcp_servers={}' mcp list --json, config foreign_fixture |0| **foreign_fixture permanece habilitado. O mapa vazio não apaga a configuração base neste caminho.** |
| list-exclusive-map-override | -c '<mapa orbit_context>' mcp list --json, config foreign_fixture |0| **foreign_fixture e orbit_context aparecem juntos. O override faz merge neste caminho; não é exclusão de todos servidores anteriores.** |
| list-invalid-env | env="invalid" |1 esperado| Erro de tipo: expected a map, em mcp_servers.orbit_context.env. |
| list-invalid-args | args=3 |1 esperado| Erro de tipo: expected a sequence, em args. |
| list-invalid-tools | enabled_tools=4 |1 esperado| Erro de tipo: expected a sequence, em enabled_tools. |
| list-invalid-required | required=4 |1 esperado| Erro de tipo: expected a boolean, em required. |

No mapa válido, listagem devolve command,args,cwd,env,env_vars e tempos2/3. Campos enabled_tools/required não são serializados no resultado de listagem, mas suas tipagens inválidas são rejeitadas pelo parser. Portanto os campos são reconhecidos e o mapa válido é aceito; isso **não prova** filtragem de ferramentas ou comportamento de servidor obrigatório em startup.

### Testes mínimos de configuração de projeto

Pasta sintética `/work/.codex/config.toml`:

```toml
[mcp_servers.project_fixture]
command="/not-mounted-project"
```

Config HOME da fixture trusted:

```toml
[projects."/work"]
trust_level="trusted"
```

| Caso | Args | Exit | Resultado |
|---|---|---:|---|
| project-untrusted | mcp list --json, HOME config vazio |0| [] |
| project-trusted | mcp list --json, HOME confia/work |0| project_fixture carregado. |
| project-empty-map | -c 'mcp_servers={}' mcp list --json, trusted |0| project_fixture permanece. |
| project-exclusive-map | -c mapa orbit_context mcp list --json, trusted |0| orbit_context + project_fixture juntos. |
| project-ignore-user-flag | --ignore-user-config -c 'mcp_servers={}' mcp list --json |2 esperado| unexpected argument --ignore-user-config: esta flag não é global para o subcomando mcp list. |

Assim, import de config do projeto trusted e merge de mapas são **CONFIRMADOS NO BINÁRIO INSTALADO POR OPERAÇÃO OFFLINE para bootstrap/listagem MCP**. A opção --ignore-user-config pertence ao caminho exec. Não se executou exec para testar bootstrap ativo; não é legítimo generalizar a listagem para toda semântica de exec. A ajuda nativa confirma o alcance declarado da flag (config do usuário), não exclusão completa de config de projeto/plugins/managed.

### Classificação por capacidade

| Pergunta | Classificação e alcance |
|---|---|
| Versão instalada | CONFIRMADO NO BINÁRIO INSTALADO POR OPERAÇÃO OFFLINE0.160.0. |
| -c e mapa MCP | CONFIRMADO NO BINÁRIO INSTALADO POR OPERAÇÃO OFFLINE em mcp list. Tipos/env/args/required/allowlist reconhecidos. |
| Precedência/exclusão | Merge com usuário e projeto trusted CONFIRMADO offline; exclusão universal por mapa vazio/único **refutada neste caminho**. |
| --ignore-user-config | Presença/descrição CONFIRMADA pela ajuda exec; funcionamento ativo com projeto/plugins/managed NÃO COMPROVADO. |
| Único servidor autorizado | Pode listar único em HOME/projeto sintéticos vazios; isso não prova supressão de toda origem operacional. **NÃO COMPROVADO para execução real.** |
| enabled_tools | Tipo reconhecido offline; aplicação da allowlist no cliente ativo NÃO COMPROVADA. |
| required/falha startup | Tipo reconhecido offline; comportamento de inicialização/fallback NÃO COMPROVADO. |
| env do servidor | Config listada; ambiente efetivamente recebido por MCP nativo NÃO COMPROVADO. |
| resume | Subcomando anunciado na ajuda exec; persistência/reaplicação MCP em sessão NÃO COMPROVADA. |
| Sandbox MCP/subprocessos | Ajuda anuncia sandbox para shell model-generated; aplicação ao processo MCP e IPC NÃO COMPROVADA. |
| CodexExecutor/Provider Orbit | CONFIRMADO PELO CÓDIGO LOCAL: guards recusam Bridge antes de HOME/spawn; política isolada solicita MCP vazio/network-off. Esses argumentos não constituem prova de exclusão em parser ativo. |
| ForwardingFD | CONFIRMADO PELO CÓDIGO LOCAL: launcher stdio inherit0–2; supervisor preserva close_fds/reserva para guards. Não há contrato nativo de forwarding do canal. |

Nenhum caso desta frente usou CLI fake. As classificações CONFIRMADO EM TESTE COM CLI FAKE devem vir das frentes de integração e não deste material. Referências externas da06B continuam DOCUMENTADO EXTERNAMENTE e não substituem esses resultados versionados. Não foi necessário navegar para inferir funcionalidades modernas.

### Resultado e consequência

**F1: PASS no alcance de inspeção offline/versão/parser-listagem; BLOCKED como prova de configuração MCP ativa exclusiva/sandbox/resume.** São18 operações informativas/negativas no total (5ajuda/versão,8bootstrap/schema,5projeto). Exits1/2 de casos inválidos são recusas esperadas; não são falhas inesperadas de teste. Não contar essas operações como18 testes de integração com modelo.

É tecnicamente incorreto tratar `-c mcp_servers={}` ou `-c mcp_servers={orbit_context=...}` como prova universal de exclusão de servidores. Manter guard ativo até implementar/provar configuração de confiança por run e ausência de outras origens no caminho exec instalado. A prova offline reduz a incerteza e identifica um bloqueio concreto, mas não autoriza mudar as políticas03B nem ativar serviço.

Um futuro contrato interno deverá exigir HOME/CODEX_HOME próprios sem auth herdada indevida, configuração do host selada, workspace/config de projeto sujeito à política explícita, ausência comprovada de fontes adicionais/managed/plugins e resultado efetivo exclusivo antes do startup; server command/args/env nunca escolhidos pelo agente. A presente frente não implementa nem homologa esse contrato de execução.

### Evidências e reprodução

- `/tmp/orbit06c-offline/initial-results.json`: argv completo e resultados5help/version.
- `/tmp/orbit06c-offline/config-results.json`:8casos bootstrap/schema; config sintética e resultados.
- `/tmp/orbit06c-offline/project-results.json`:5casos projeto trusted/untrusted/merge/flag.
- `/tmp/orbit06c-offline/*.stdout` e `*.stderr`: saídas integrais.
- `/tmp/orbit06c-offline.py`, `/tmp/orbit06c-offline-config.py`, `/tmp/orbit06c-offline-project.py`: scripts exatos. Podem ser copiados para evidência durable pelo integrador, sem incorporar caminhos físicos de credenciais (não há credenciais).

Scripts só escrevem próprios temporários e evidências/tmp. Não alteram Core, projeções, locks, configuração real ou serviços. O integrador deve considerar a prova completa junto à implementação, sem declarar homologação operacional.

## 6. Problema de transporte anterior

A06B entregava FDs extras diretamente a um Node sintético. O supervisor reserva descritores acima de stderr para guards e usa close_fds; o launcher Codex transmite stdio0–2. Nenhuma dessas camadas oferece contrato de forwarding até o servidor MCP nativo. Não se relaxou close_fds nem se reutilizaram descritores de ownership.

A06C usa canal local endereçável com autenticação específica de peer; o nome do socket não autentica. Isso remove a dependência de herança arbitrária de FD no teste supervisionado, mas não prova a descoberta confiável do PID MCP pelo Codex real nem permissões do sandbox.

## 7. Alternativas consideradas

| Alternativa | Resultado |
|---|---|
| FD extra | Não comprovado na cadeia nativa; não relaxado. |
| IPC Node | Específico do launcher; não presumido no Rust. |
| FIFO/UDS com UID/0700 apenas | Insuficiente contra outro processo mesmo UID. |
| UDS com SO_PEERCRED/PID/starttime/pidfd | Implementado em helper Linux, PID fixado por host confiável. |
| Token em argv/env/arquivo | Rejeitado como segredo de autenticação. |
| TCP | Não implementado; sem fallback de rede. |

O helper Python existe porque a API net portátil do Node não expõe SO_PEERCRED. Python e supervisor já fazem parte do runtime Orbit; não foi instalado servidor MCP externo.

## 8. Decisão de transporte

UDS temporário por vínculo, diretório0700/socket0600 como proteção adicional. O host fixa exatamente PID,UID,starttime obtidos de processo lançado por preparação confiável. SO_PEERCRED verifica kernel PID/UID; procstat e pidfd verificam nascimento/vida. O endpoint aceita uma conexão autorizada e é imediatamente desvinculado do filesystem.

Cada endpoint recebe par Ed25519 efêmero. A chave privada fica na closure do host Node; só a pública vai ao bootstrap do entrypoint. Todas respostas são assinadas. Entrypoint verifica assinatura e id de requisição aleatório pendente; um socket substituído não consegue fabricar contexto válido. O pathname é roteamento, não segredo. Nenhuma credencial é persistida/registrada.

| Ator | Garantia/limite |
|---|---|
| Agente sem privilégio | Não escolhe identidade/endpoint/servidor no caminho aprovado; queries seguem broker. |
| MCP autorizado | Só o processo fixado conecta; não recebe DB, registry ou chave privada. |
| Outro processo mesmo UID | PID diferente é recusado; servidor falso não assina respostas; ainda pode causar DoS em filesystem/processos acessíveis. |
| procfs/ptrace privilegiado | Fora da garantia: leitura/alteração de memória/bootstrap/FD pode comprometer capacidade. |
| Plugin JS host não cooperante | Processo host não é sandbox entre plugins; comprometimento interno fora da garantia. |
| Editor/escritor externo | Não participa do lease; alterações de fontes seguem revalidação06; não há snapshot atômico universal. |

Não se promete proteção contra root/host comprometido ou contra substituição do próprio bootstrap/binário por escritor privilegiado.

## 9. Entrypoint MCP

Novo context-bridge-mcp-entry.ts: exporta runContextBridgeMcpEntrypoint(bootstrap,input,output,signal). Compilado, pode ser executado por Node; em testes usa loader TS instalado. O main lê somente ORBIT_CONTEXT_BRIDGE_BOOTSTRAP, limitado4096bytes, contendo endpointPath/publicKey/limits/presentation; não lê credenciais, banco, registry ou fontes.

Inicializa protocolo interno06 pelo canal autenticado; depois conecta o adapter MCP06B a stdin/stdout. stdout é exclusivamente MCP; diagnóstico fixo sem dados em stderr. EOF fecha binding local; SIGTERM/SIGINT/cancelamento/timeout/falha de assinatura/peer encerram. Erros críticos produzem exit1; término normal exit0. Não há daemon/reconexão/descoberta de projeto.

Entrypoint depende de PID fixado no host antes de accept; conexão pode ficar na fila kernel enquanto host autoriza. Bootstrap não autentica cliente ao host: SO_PEERCRED/pidfd fazem essa parte. Não é argumento livre do agente nem autorização por UUID.

## 10. Canal autenticado/autorizado

createContextBridgePeer({exchange,signal,limites}) inicia helper sob spawnWorkspaceProcess. Retorna endpointPath/publicKey/authorizePeer(identity)/close/done/signal. readContextBridgePeerIdentity(pid) é leitor host-only de procstat/UID, não registro remoto.

Helper recebe bootstrap e uma autorização única pelo stdin privado do host; não aceita UID sozinho. Revalida identidade antes de accept, leitura e resposta; pidfd dispara fechamento na morte do peer. Rejeita processo errado, excesso de frames/pending e timeout. Host callbacks tardios são suprimidos depois de close. Endpoint é single-use; autorizações/reconexões antigas não reabrem canal.

Owner deve ligar signal de lease/run e fechar transporte **e** handle06 em finally. Transporte não possui objeto broker e não inventa revisão/ator/run. Escopo vem da closure exchange previamente autorizada, preservando manifesto/card/revisão/runtime/turno. Factory de transporte isolada não concede essas identidades sozinha.

Assinatura cobre JSON.stringify(payload) do raw06JSONRPC; verifica-se mesma serialização Node ao receber. IDs aleatórios pendentes e chave nova por endpoint evitam replay cruzado de respostas. A assinatura fica no IPC, não é conteúdo novo para o modelo.

## 11. Integração com supervisor

Cadeia comprovada: worker de fixture→withWorkspaceWriteLease real (DB lock fake)→spawnWorkspaceProcess→supervisor Python real→launcher Node sintético confiável→cliente MCP sintético→entrypoint real→UDS helper também supervisionado→exchange/adapter06→broker real→resposta assinada→MCP.

O launcher de fixture reporta o PID do filho que criou; host lê sua identidade real e fixa peer. Essa informação não vem de texto do agente. Ambos processos protegidos são drenados antes de terminar callback; coordinator/supervisor não foram modificados. Tests percorrem card_runs/card_ai_runs, handshake inválido e crash MCP.

Não foi conectado IsolatedCheckoutManager ao novo teste UDS: regressões03B cobrem suas garantias anteriores, mas acesso UDS sob checkout/sandbox Codex continua bloqueado. Cancelamento/ownership/quarentena/interrupção supervisor contam com regressões anteriores e testes de signal/peer; nem toda falha foi reexecutada na nova cadeia completa. Não chamar a matriz parcial de homologação integral.

Helper startup com erro aguarda drenagem antes de rejeitar factory. Fechar adapter não mata descendentes por si só; supervisor mantém essa responsabilidade. SIGKILL abrupto pode deixar socket/diretório órfão; não se apagam substituições desconhecidas nem se faz cleanup recursivo/quarentena operacional.

## 12. Integração com CodexExecutor

Guard incondicional mantido. Não existe configuração MCP nativa ativa nova. A prova offline refuta usar mapa vazio/único como garantia geral de exclusão no bootstrap/listagem; a semântica exec exata ainda precisa de prova permitida. Também não há registro confiável do PID do servidor iniciado por CLI nativo.

O teste usa um launcher fake com estrutura de processos, não uma chamada CodexExecutor em modo MCP ativo. Regressão provider mantém recusa antes de HOME/spawn e caminho legado. ContextDelivery, supervisor, workspace e políticas03B foram preservados por hash. Não há fallback para MCP vazio quando manifesto exige Bridge.

## 13. Integração com CodexAiService

Guard ativo nos quatro runtimes. Sessão, Q&A, quota, multiagent, eventos, revisão/manifesto e diferenças específicas não foram reescritos. O teste de cadeia utiliza identidade card_ai_runs, mas **não prova** que CodexAiService inicia MCP nativo. Harnesses existentes exercitam ambas filas/turnos/política/fechamento com provider fake.

Retomada exige novo manifesto/turno e vínculo; não há transferência de PID/canal/chave de turno anterior. Sem migração de sessão legada. Transporte está pronto para consumir um exchange novo quando o host nativo tiver provas suficientes, sem retirar guard apenas por existência do arquivo.

## 14. Compatibilidade MCP

Protocolo2025-06-18 e catálogo cinco ferramentas mantidos. Acrescentado parâmetro host-only presentation='structured'|'text' ao adapter, default structured. Structured mantém structuredContent e content:[]; text contém uma única TextContent com JSON do mesmo resultado06, sem structuredContent duplicado.

Cliente fixture structured passa pela cadeia de processo; cliente text-only unitário parseia conteúdo/proveniência/hash. Não se declara text-only testado pelo Codex real ou por cliente externo. Texto com escaping cujo envelope excede a reserva é recusado e fecha canal; erros/refusals também têm representação textual no modo text.

Não se aumentou reserva nem duplicou dado sem contar. Schemas, handshake, erros e cancelamento por binding inteiro continuam06B. Nenhuma extensão nova de recursos/prompts/mutação foi anunciada.

## 15. Contexto versionado

Manifesto, compiler, card_revision, fingerprint, Git base, checkout e política capturada não foram alterados. Transporte recebe exchange bound do host; não aceita contexto do agente. SourceIds opacos continuam por binding, sem endpoints/públicas/segredos gravados no manifesto.

Sessão é um estado separado da autoridade de canal. Run/turno novo exige endpoint/chave/peer novos. Uma ferramenta MCP não aprova freshness, integração ou escrita; consultas continuam sendo observações autorizadas e limitadas.

## 16. Orçamento

Broker05/06 mantém maxRequests/maxResponseBytes/maxTotalBytes/timeout/concorrência/fontes/profundidade. MCP continua verificando overhead real <=256bytes por tools/call acima do payload já cobrado; no modo text inclui escaping e newline. Resposta incompatível com reserva é recusada em vez de truncada.

Framing06 limita controle/envelopes totais. Transporte UDS tem caps de fila/frame/pending e limite adicional1024bytes para envelope de assinatura **interno**, que não é enviado ao modelo nem desconto duplicado de corpo. Essa cap é proteção de memória/transporte, não segundo orçamento de dados. Entrypoint verifica payload máximo e assinatura antes de repassar ao MCP.

Não há alegação de tokens faturados ou prova de consumo pelo modelo. Falhas de timeout da consulta continuam do broker; handshake/connect possuem deadlines de transporte.

## 17. Auditoria

207 reutilizada, sem schema novo. Mantidos request_received/authorized/response_prepared/response_emitted/delivery_unverified/denied/revoked/closed. Assinar/enviar payload não redefine response_emitted como leitura do modelo.

Novo teste usa broker real com coletor de eventos em memória; não afirma persistência SQL ponta a ponta. Host06 em produção continua dono de response_emitted/auditoria append-only; regressão PG207 valida persistência separadamente. Não se gravam endpoint, chave privada, corpo ou credencial em ledger.

## 18. Segurança

Nenhuma mudança em RBAC, seleção por fonte, PluginDefinition/Registry, plugin base IA/dependentes, IsolatedCheckoutManager, coordinator, supervisor, policy de sandbox/network-off/approval ou config operacional. Não há leitura arbitrária, ferramentas de escrita, commands MCP, vetorial Suindá/RAG/Delivery/Git mutável.

UDS usa AF_UNIX; não se abriu listener TCP ou rede externa. Acesso AF_UNIX real sob sandbox Codex permanece não comprovado. Namespace sem rede da inspeção offline não é homologação do sandbox do agente. Mesclar mapas no parser não autoriza permitir servidor externo: guards continuam fechados.

## 19. Implementação arquivo por arquivo

| Arquivo/família | Alteração e consumidores | Compatibilidade/risco |
|---|---|---|
| packages/orbit-core/src/execution/context-bridge-peer.ts | Novo owner UDS/helper/pinning/signature/lifecycle. | Requer Linux/Python/pidfd; caller conserva autoridade e fecha binding. |
| context-bridge-peer.py no mesmo diretório | Novo relay kernelcredential single-use. | Sem DB/registry; não isola host/ptrace. |
| context-bridge-peer.spec.ts |4 testes peer/abort/limite/timeout. | Deadline mínimo pode recusar startup antes de ready; teste aceita ambos fechamentos seguros. |
| context-bridge-mcp-entry.ts | Novo main e função de entrypoint. | Bootstrap host-only; verifica assinatura/IDs, sem config nativa ativa. |
| context-bridge-mcp-entry.spec.ts |2 testes: host falso e timeout não entregam dados. | Não é sandbox real. |
| context-bridge-mcp.ts | Representação text alternativa, mesmo orçamento. | Default structured preservado; texto oversized recusa. |
| context-bridge-mcp.spec.ts |2 novos testes text/escaping. | Os9 testes06B mantidos. |
| tools/orbit/context-bridge-mcp-supervised.test.mjs |4 novos cenários supervisionados. | Fake launcher confiável; não Codex nativo. |
| orbit.workspace.json e packages/orbit-core/package.json |5 mappings novos; releases selecionadas. | APIs não alteradas. |
| Quatro orbit.shared-lock.json | Gerados oficialmente. | UI preservada. |
| Quatro projeções de cada um dos7 fontes/testes acima | Geradas pelo mecanismo oficial. | Sem cópia integral DEV nem edição isolada. |
| Este relatório | Nova referência autossuficiente. | Resultado parcial explícito. |

Python helper é localizado junto ao JS compilado ou no src/execution do runtime, seguindo padrão do supervisor existente. Distribuições futuras sem src precisam copiar o asset .py; não se declara pacote compilado standalone validado nesta etapa. Inventário individual completo em§25.

## 20. Persistência

Nenhuma migration criada/modificada/aplicada.157–160/207 e migrations de produto preservadas por hash. PostgreSQL descartável usado somente em harnesses já existentes. Nenhuma instalação operacional de207 foi presumida; ativação futura deve verificar cada banco separadamente.

## 21. Testes F1–F20

| ID | Estado e método | Limitação |
|---|---|---|
|F1|PASS inspeção offline18 operações; BLOCKED exclusão ativa exec/resume.|Listagem prova merge, não startup MCP.|
|F2|PASS entrypoint/processo/EOF/timeout/falha assinatura.|Novo main TS/JS, não Codex real.|
|F3|PASS MCP handshake2025-06-18 em processo.|Cliente fixture.|
|F4|PASS catálogo cinco ferramentas read-only.|Sem extensões mutáveis.|
|F5|PASS ferramenta chega broker real sob supervisor.|DB lock/audit sink fake; host06/SQL separados.|
|F6|PASS structured processo e text-only unitário.|Clientes externos/nativo NOT_RUN; texto oversized recusa.|
|F7|PASS kernelPID/starttime/UID/pidfd e assinatura host.|Bootstrap confiável; ptrace/host comprometido fora da garantia.|
|F8|PASS processo diferente não usa endpoint, broker separa sourceIds.|Run real não ativado.|
|F9|PASS single-use/revoke fecha endpoint e bloqueia reuse.|Não reconnect/restart automático.|
|F10|PASS peer abort e MCP query tardia suprimida.|Cancelamento de toda nova cadeia não reexecutado em todos pontos.|
|F11|PASS regressão ownership06/03A e transporte signal; BLOCKED perda real no nativo.|Não fingir teste completo novo de todos cenários.|
|F12|PASS cadeia real supervisor com launcher sintético.|Launcher nativo/sandbox BLOCKED.|
|F13|PASS crashMCP sob supervisor; regressões drain/orfãos.|Crash/interrupção em todos pontos novos NOT_RUN.|
|F14|PASS reserva256/textescaping/frame/pending/timeout.|Assinatura é IPC interno com cap separado, sem tokens reais.|
|F15|PASS guard/legado fake; BLOCKED mapa MCP ativo no CodexExecutor.|Nenhum caminho parcialmente configurado.|
|F16|PASS filas/turnos fake e cadeia identidade card_ai_runs; BLOCKED CodexAiService MCP ativo.|Sem migração de sessões.|
|F17|PASS contratos e regressões03B; BLOCKED acessoUDS/sandbox MCP nativo.|Não testado em sandbox Codex.|
|F18|PASS Core determinístico sem provider/IA.|Não depende de modelo.|
|F19|Resultados dirigidos§22.|Sem suíte global.|
|F20|PASS isolamento operacional e classificação explícita.|Real inference NOT_RUN, proibida.|

Comandos novos:
```sh
TSX_TSCONFIG_PATH=dev/app/apps/api/tsconfig.json node --import ./dev/app/node_modules/tsx/dist/loader.mjs --test dev/app/apps/api/src/execution/context-bridge-peer.spec.ts dev/app/apps/api/src/execution/context-bridge-mcp-entry.spec.ts dev/app/apps/api/src/execution/context-bridge-mcp.spec.ts
node --test tools/orbit/context-bridge-mcp-supervised.test.mjs
```
Evidências locais: /tmp/orbit06c-audit e /tmp/orbit06c-offline. Operações offline com exit1/2 esperado para schema/flag inválidos são provas de recusa do parser, não falhas de regressão.

## 22. Regressões

**324 testes distintos PASS,0 falhas finais,0 cancelados,0 skipped.** Mais18 operações offline informativas/configuração nativa (separadas dos testes; erros de tipo/flag esperados não são falhas). Não se somam reexecuções ou suites sobrepostas.

| Suite/log em /tmp/orbit06c-audit | PASS |
|---|---:|
|unit-final|164|
|bridge-workers|1|
|bridge-adapter|1|
|bridge-provider|1|
|bridge-postgres|8|
|context-workers|10|
|context-compiler-workers|1|
|context-compiler-provider|1|
|regressions|75|
|context-postgres|10|
|isolation-regressions|18|
|chain-final|4|
|mcp-process|1|
| Compiler cenários filhos |17|
| Bridge cenários filhos |12|

Os164 unitários são147 existentes+11 MCP (9 anteriores+2 text)+4 peer+2 entrypoint. Os wrappers e seus29 cenários filhos são registrados separadamente uma única vez. Suite de processo06B1 e cadeia06C4 não são testes do CLI real.

Quatro APIs TypeScript aprovadas. Manifest/compiler/context envelope/registry/revisões/queues/PG160/207/coordinator/processos/isolation foram exercitados por suites dirigidas. Navegador e prompt-question isolado não foram reexecutados: seus arquivos não mudaram. Harnesses das filas usam fake DB/quota/executor e testes PostgreSQL usam servidor descartável separado, sem produto.

Comandos e ambiente exatos em /tmp/orbit06c-audit/validate.py. Famílias executadas:
```sh
node --test tools/orbit/context-bridge-workers.test.mjs
node --test tools/orbit/context-bridge-adapter.test.mjs tools/orbit/context-bridge-provider.test.mjs
node --test tools/orbit/context-bridge.postgres.test.mjs
node --test tools/orbit/context-workers.test.mjs
node --test tools/orbit/context-compiler-workers.test.mjs tools/orbit/context-compiler-provider.test.mjs
node --test tools/orbit/context-manifests.postgres.test.mjs
node --test tools/orbit/isolated-checkout.test.mjs tools/orbit/isolated-provider.test.mjs tools/orbit/isolated-workers.test.mjs
node --test tools/orbit/shared.test.mjs tools/orbit/preflight.test.mjs tools/orbit/catalog.test.mjs tools/orbit/registry-foundation.test.mjs tools/orbit/card-revision-ui.test.mjs tools/orbit/card-version-enqueue.test.mjs tools/orbit/card-revisions.postgres.test.mjs tools/orbit/workspace-coordinator.postgres.test.mjs tools/orbit/workspace-workers.test.mjs
node --test tools/orbit/context-bridge-mcp.test.mjs
node --test tools/orbit/context-bridge-mcp-supervised.test.mjs
node <runtime>/app/node_modules/typescript/bin/tsc --noEmit --incremental false -p <runtime>/app/apps/api/tsconfig.json
```

Primeira execução agregada teve163/164 por expectativa incorreta da fixture de deadline100ms: host recusou startup antes do Python ready sob carga, conforme fail-closed. Teste corrigido, publicação1.9.6 e suite inteira repetida com164/164; log intermediário unit-initial.log mantido. Nenhuma proteção de produção foi relaxada.


## 23. Monorepo

Core final1.9.6/213 mappings, integridade479587354e9e50581615bb81289f9f6f08afa4d77df255e9433a9615e21f2472; publicação selecionada @orbit/core-source com plano/precondições.1.9.5 introduziu transporte/entrypoint/text;1.9.6 corrigiu expectativa da fixture de deadline100ms: sob concorrência o startup pode ser recusado antes de ready, igualmente fail-closed. Nenhuma política de produção foi afrouxada para passar teste.

UI1.1.3/74 e nove variantes conhecidas preservadas. Preflight global permanece BLOCK pelos findings anteriores; Core sem drift/locks pendentes. Plano/apply em /tmp/orbit06c-audit/{plan,release,plan-1.9.6,release-1.9.6}.json. Não houve edição manual de hashes.

## 24. Segurança operacional

Inspeção nativa somente em bwrap sem rede/credenciais/filesystem do usuário,18 operações informativas/listagem, nenhum exec com prompt. Nenhum modelo pago, auth real, API quota, embeddings, .env/config global, DB produto, Docker, serviço operacional, migration, deploy/restart ou Git mutável original.

Testes de coordinator usam fake lock e temporários; PG usa instâncias descartáveis existentes. Não se removeu quarentena operacional ou worktree real. Frente offline só escreveu/tmp; frente transporte escreveu3 fontes/testes delimitados; integrador revisou/integrou/publicou projeções e validou. Não se declara economia mensurada de delegação.

## 25. Inventário Git

Baseline3348 arquivos. Nesta etapa: **16 modificados,27 novos,0 removidos**. Inventário individual:

- dev/app/apps/api/src/execution/context-bridge-mcp-entry.spec.ts
- dev/app/apps/api/src/execution/context-bridge-mcp-entry.ts
- dev/app/apps/api/src/execution/context-bridge-mcp.spec.ts
- dev/app/apps/api/src/execution/context-bridge-mcp.ts
- dev/app/apps/api/src/execution/context-bridge-peer.py
- dev/app/apps/api/src/execution/context-bridge-peer.spec.ts
- dev/app/apps/api/src/execution/context-bridge-peer.ts
- dev/app/orbit.shared-lock.json
- docs/implementacao-arquitetural/06C-FECHAMENTO-TRANSPORTE-MCP-CODEX.md
- orbit.workspace.json
- packages/orbit-core/package.json
- packages/orbit-core/src/execution/context-bridge-mcp-entry.spec.ts
- packages/orbit-core/src/execution/context-bridge-mcp-entry.ts
- packages/orbit-core/src/execution/context-bridge-mcp.spec.ts
- packages/orbit-core/src/execution/context-bridge-mcp.ts
- packages/orbit-core/src/execution/context-bridge-peer.py
- packages/orbit-core/src/execution/context-bridge-peer.spec.ts
- packages/orbit-core/src/execution/context-bridge-peer.ts
- prod/app/apps/api/src/execution/context-bridge-mcp-entry.spec.ts
- prod/app/apps/api/src/execution/context-bridge-mcp-entry.ts
- prod/app/apps/api/src/execution/context-bridge-mcp.spec.ts
- prod/app/apps/api/src/execution/context-bridge-mcp.ts
- prod/app/apps/api/src/execution/context-bridge-peer.py
- prod/app/apps/api/src/execution/context-bridge-peer.spec.ts
- prod/app/apps/api/src/execution/context-bridge-peer.ts
- prod/app/orbit.shared-lock.json
- safdoulas/app/apps/api/src/execution/context-bridge-mcp-entry.spec.ts
- safdoulas/app/apps/api/src/execution/context-bridge-mcp-entry.ts
- safdoulas/app/apps/api/src/execution/context-bridge-mcp.spec.ts
- safdoulas/app/apps/api/src/execution/context-bridge-mcp.ts
- safdoulas/app/apps/api/src/execution/context-bridge-peer.py
- safdoulas/app/apps/api/src/execution/context-bridge-peer.spec.ts
- safdoulas/app/apps/api/src/execution/context-bridge-peer.ts
- safdoulas/app/orbit.shared-lock.json
- suinda/app/apps/api/src/execution/context-bridge-mcp-entry.spec.ts
- suinda/app/apps/api/src/execution/context-bridge-mcp-entry.ts
- suinda/app/apps/api/src/execution/context-bridge-mcp.spec.ts
- suinda/app/apps/api/src/execution/context-bridge-mcp.ts
- suinda/app/apps/api/src/execution/context-bridge-peer.py
- suinda/app/apps/api/src/execution/context-bridge-peer.spec.ts
- suinda/app/apps/api/src/execution/context-bridge-peer.ts
- suinda/app/orbit.shared-lock.json
- tools/orbit/context-bridge-mcp-supervised.test.mjs

Inventário e hashes iniciais/finais em /tmp/orbit06c-audit. Modificações contra HEAD incluem trabalho anterior; foram comparadas ao baseline imediato. Host/broker/repository/compiler/manifestos/coordinator/supervisor/checkout/providers/filas/UI/migrations anteriores permanecem por hash. main/HEAD preservados; sem stage/commit/push/tag.

## 26. Limitações e bloqueios

1. Integração ativa dos dois adapters nativos continua bloqueada; implementação não equivale a homologação.
2. Parser bootstrap/listagem mescla mapas; exclusão por exec/ignore-user-config/projeto/plugins/managed config ainda não comprovada.
3. PID do MCP do Codex real não é obtido por canal confiável; aceitar PID enviado por agente seria falso vínculo.
4. Acesso UDS sob sandbox/network-off Codex não foi demonstrado. Não há relaxamento para obter sucesso.
5. Cadeia nova não testa todos crashes/perda de lease/quarentena simultaneamente; regressões e testes unitários são classificados separadamente.
6. Linux com SO_PEERCRED/pidfd/Python é necessário; outras plataformas falham fechadas.
7. Chave pública/bootstrap e binário precisam de integridade do host; root/ptrace/pluginhost comprometido fora da garantia.
8. Mesmo UID pode causar DoS, matar/restringir processos ou alterar paths acessíveis. Assinatura impede fabricar resposta, não disponibilidade universal.
9. SIGKILL pode deixar endpoint/diretório órfão; não há limpeza automática de propriedade duvidosa.
10. Bytecaps/assinatura não comprovam uso pelo modelo, snapshot FS/DB atômico ou sandbox universal.
11. Text-only foi testado em fixture unitária; clientes externos/CLI não foram homologados. Falha de orçamento pode recusar a representação.
12. Artefato compilado sem src precisa incluir helper.py como asset; teste rodou projeções/fontes via loader instalado.

## 27. Pendências para homologação

Procedimento futuro, com autorização específica: fixar configuração per-run em diretório confiável fora de escrita do agente; provar exclusão de todas origens no exec e exec resume0.160.0 com canários sintéticos; provar mecanismo confiável de reportar/pinnar servidor MCP sem identidade vinda do modelo; testar UDS/network-off/sandbox sem bypass; testar startup obrigatório, falha, cancelamento, perda de lease, pergunta e drain na cadeia nativa.

Primeiro testar cadeia sem inferência quando existir mecanismo nativo adequado. Inferência autenticada só com nova autorização, modelo/quota explícitos, dados sintéticos e sem mexer em produtos. Homologar separadamente CodexExecutor e CodexAiService/retomada. Conferir schema207 por ambiente antes de qualquer flag; não há ativação autorizada nesta entrega.

## 28. Preparação para a Implementação07

Recuperação lexical/RAG futura pode usar consultas read-only, seleção/fonte/proveniência/hashes e recusas existentes, MCP2025-06-18 e transporte host-bound. Não recebe autoridade nova para descobrir fontes, escrever memória/cards/Git ou fazer reconciliação. Parte nativa continua bloqueada; a07 não foi iniciada e este relatório não a autoriza.

## 29. Handoff técnico

APIs principais:
```ts
const peer = await createContextBridgePeer({exchange: handle.exchange, signal: lease.signal});
// Somente identidade obtida por preparação confiável de processo, nunca por prompt:
await peer.authorizePeer(await readContextBridgePeerIdentity(trustedMcpPid));
// Entrypoint recebe SOMENTE endpoint público, chave pública e limites do host:
const bootstrap = {endpointPath: peer.endpointPath, publicKey: peer.publicKey, limits};
// Owner deve preservar os dois finally:
await peer.close();
await closeHostBridge();
```
O exemplo é contrato, não receita de configuração Codex ativa: falta obter trustedMcpPid de forma comprovada no CLI real. Nenhum ID de run autentica peer.

Entry compilado: node <runtime>/app/apps/api/dist/execution/context-bridge-mcp-entry.js, com helper.py disponível no dist ou src conforme resolver. Teste usa node --import <loader-tsx> <entry.ts>. Bootstrap fica em ORBIT_CONTEXT_BRIDGE_BOOTSTRAP (não é segredo); não incluir DATABASE_URL/tokens/chaves privadas. Comando/binário/endpoint não vêm do agente.

Default ORBIT_CONTEXT_BRIDGE_ENABLED ausente/0 permanece; habilitar Bridge não remove guard nativo. presentation default structured; text opcional escolhido pelo host. Erros de bootstrap/assinatura/frame/timeout/autoridade encerram; sem reconnect/fallback/reuso de turno.

Comandos read-only: node tools/orbit/cli.mjs preflight --format json; node tools/orbit/cli.mjs shared check. Comandos de testes§21/22 usam fixtures. Não repetir publicação sem nova mudança e plano. Nenhuma configuração executável do CLI nativo é fornecida enquanto exclusão e PID/sandbox não forem comprovados.

## 30. Resultado final

**PARCIALMENTE CONCLUÍDA.**

| Dimensão | Resultado |
|---|---|
| Código/entrypoint | Implementados e testados. |
| MCP oficial | Subconjunto2025-06-18 herdado; text/structured alternativos. |
| Transporte | UDS validado por kernelPID/starttime/UID/pidfd; respostas host assinadas. |
| Supervisor | Cadeia real comprovada com launcher sintético nos dois tipos de run. |
| Fixtures | Testes dirigidos§22, sem prova de Codex real. |
| CLI instalado |0.160.0/18 operações offline; parser/listagem e merge comprovados. |
| Integração ativa dos adapters | BLOCKED: exclusão de config, PID confiável, sandbox e resume nativos. |
| Homologação Codex real | NOT_RUN, sem autorização para inferência. |
| Sandbox | Contratos anteriores preservados; UDS/MCP nativo não homologado. |
| Migrations/ativação/deploy | Não executados. |

Não iniciar07 automaticamente.
