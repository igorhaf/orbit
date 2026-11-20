# Implementação07B — Consulta lexical dinâmica e Context Bridge

Data:2026-11-16. Referência de código/testes isolados; sem autorização operacional.

## 1. Resumo executivo

**CONCLUÍDA no escopo de código e testes isolados da07B.** Implementada a capability opcional knowledge.search no ContextBridge existente, com ferramenta MCP orbit_knowledge_search concedida somente pelo binding autorizado. Reutiliza retriever/BM25/chunking e o cache derivado compartilhado da07A, sem segundo índice/broker/fila/registry.

Consultas pesquisam exclusivamente candidatos e versões capturados. Uma fonte autorizada omitida inicialmente pode retornar dinamicamente, com ID opaco, hashes/proveniência/ranking e indicação de não inclusão inicial. Mudança de catálogo/corpus/ACL/política/revisão/turno/checkout revoga ou recusa; manifesto original não muda. Orçamento/concorrência/timeout/auditoria continuam do Bridge.

As duas filas foram exercitadas com serviços reais e executores fake, inclusive worktree gerenciada03B e negativas de ownership/inode. MCP estruturado/textual passou em clientes sintéticos e na cadeia supervisionada assinada. Isso **não homologa Codex real, MCP/UDS sob sandbox do provider ou uso semântico pelo modelo**. Guards nativos permanecem intactos.

Core fonte final **1.11.5**, **224 mappings**; Core API1.0.0/Plugin API1 preservadas. Nova migration **208** somente em arquivos/testes descartáveis, sem aplicar em produto. Flags continuam desligadas por padrão. Sem ativação, deploy/restart, Git mutável original, modelos pagos ou07C.

## 2. Base documental

Lidos/considerados os21 relatórios00–20 de docs/sondagem-arquitetural e todos os documentos de implementação disponíveis02/03A/03B/04/05/06/06B/06C/07A e01, versões finais/adendos. Referência principal07A confrontada com código:1.10.6/220,389 testes históricos, BM25 compartilhado, candidatos explícitos e duas filas, sem migration nova07A.

AGENTS, skill orbit-environment, workspace, experiência de produto, aceleração, PluginRegistry/PluginDefinition e ferramentas preflight foram consultados. Trabalho direto IDE, sem cartão/write_scope fornecido. Revisão focal em /tmp/orbit07b-review.md; não foi feita nova sondagem geral nem tratado histórico como implantação.

## 3. Estado inicial

Branch **main**, HEAD **d9307b8e6a54316f802acbd7bcb96baa26116f16**, preservados. Árvore já suja com01–07A/produto. Baseline por arquivo/status em /tmp/orbit07b-audit/before.json e status-before.txt distingue esta etapa do diff contra HEAD.

Core1.10.6/220, APIs Core1.0.0/Plugin1, UI1.1.3/74. Preflight inicial BLOCK pelos mesmos18 findings das nove variantes UI históricas; Core/locks consistentes. Migrations157–160/207 existentes, sem instalação real presumida. Numeração global foi conferida antes de reservar208; não houve colisão com migrações próprias de produto.

## 4. Arquitetura herdada

07A: knowledge-lexical.js puro, ProjectKnowledgeRetriever, catálogo knowledge-host, query baseada no card, fontes/trechos opcionais e metadados knowledgeRetrieval no manifesto. Compiler05 decide inclusão e entrega; ContextManifest04 preserva histórico/fingerprint/integridade.

06: um broker, adapter local, host, repository207, cinco consultas, HMAC sourceIds, quota concorrente, reautorização e revogação.06B/06C: MCP2025-06-18, factory/entrypoint, representação estruturada/textual, UDS com peer validado e respostas assinadas, provas sintéticas e guards Codex.

As filas já abrem/fecham Bridge no lifecycle protegido.07B acrescenta callback host e propagação de grant, sem provider novo ou acesso do agente ao FS/DB/ProjectRegistry.

## 5. Decisões arquiteturais

| Decisão | Justificativa |
|---|---|
| Reusar considered/catalog/corpus da07A | Já preservam IDs, versões, hashes de corpo/identidade, trust e política autorizadora; não fabricar fontes históricas. |
| Novo profile contextBridge.knowledge schema1 | Grant opt-in capturado, separando bindings antigos e novos. |
| Callback host + broker existente | Host revalida fontes; broker conserva schema/quota/timeout/audit/revoke. |
| Namespace opaco separado de candidatos | Não inserir candidatos em manifest.sources/sources.list nem liberar sources.read/dependencies. |
| Mesmo singleton retriever07A | Compartilha cache de tokens por escopo/checkout sem índice concorrente. |
| Metadados208 separados do JSON207 | Preserva trigger/linhas/eventos antigos e valida shape novo com limites. |
| Leitura Core em checkout03B ativo | Binder read-only reaproveita autoridade do manager, sem liberar layouts Git arbitrários ou sandbox nativo. |
| Grant MCP via initialize assinado | Cliente/prompt/bootstrap não escolhem sexta ferramenta. |

Não se adotou corpus atual permissivo, mistura de versões, busca pública, TTL de autorização, fonte nova silenciosa ou fallback de filesystem.

## 6. Contrato de consulta dinâmica

Request interno:
```json
{"schemaVersion":1,"id":"request-1","capability":"knowledge.search","parameters":{"query":"calendário de turmas","limit":1}}
```

Somente query e limit. Texto não vazio, teto host1024bytes UTF-8; limit default3, máximo do profile. Params de runtime/projeto/workspace/ator/card/run/turno/manifesto/path/diretório/fontes/política/binário são recusados. JSON-RPC e query IDs são referências, não autenticação.

Resposta ContextBridgeResponse preserva schema/protocolo/requestId/status/hash/bytes/observedAt/limitações. data inclui queryHash, algoritmo, policyId, corpusHash, compatibility, status lexical, found/returned/omitted, remainingBytesEstimated e results com sourceId opaco, hash histórico do ID interno, versão, documentHash/bodyHash, tipo/origem/trust, rank/score, linhas e texto autorizado. sourceSelectedInitially indica presença da fonte no manifesto inicial; selectedInitially indica seleção do trecho lexical exato na preparação07A. initialCompilation registra a decisão do Compiler para esse trecho com initialCompilationScope=retrieval_block_only; not_selected não prova ausência das mesmas palavras em outras fontes explícitas do contexto. stage=recovered_dynamically identifica a recuperação posterior.

countsScope=retriever_shortlist: found é shortlist autorizado limitado pela07A, não contagem global de documentos com match. compatibility=compatible prova corpus/binding observados compatíveis, não contexto semântico/global ou verdade. Erros sanitizados distinguem schema/grant/limite e corpus não verificável; revogações podem encerrar canal/retornar erro RPC genérico, com motivo exato seguro na auditoria, sem revelar fonte privada.

## 7. Catálogo capturado

07A considered já registra cada candidato autorizado: id/version/contentHash/bodyHash/authorizationPolicy/trust/sourceIdentityHash, além de catalogHash/catalogPolicyHash/corpusHash. A extração knowledgeCandidateEvidence agora é compartilhada entre preparação e consulta, preservando fórmula anterior.

assertKnowledgeBridgeMetadata exige evidência completa/limitada, política07A e hashes válidos. Records antigos/incompletos não ganham busca por flag posterior. Não houve reescrita do manifesto nem preenchimento de histórico ausente; extensão aditiva é somente profile de grant novo.

Antes e depois da recuperação: reautorizar projeto/card/ator/worker/lease/turno, reconstruir catálogo explícito no checkout aprovado, comparar policyHash/catalogHash/considered exatos e corpusHash; revalidar fontes atuais e policy capturada. Qualquer candidato alterado/removido/revogado ou configuração que acrescente fonte torna o binding incompatível. Fonte fora da lista não aparece em conteúdo/contagens. Não há leitura histórica por fallback.

## 8. Integração com ProjectKnowledgeRetriever

knowledge-bridge.ts fornece createKnowledgeBridgeCallback, retornando candidates e search. Reutiliza projectKnowledgeRetriever exportado pelo host07A, sem instanciar cache lexical paralelo. Motor/chunking/tokenização/fórmula/ordenação/dedup/cache/deep-clone permanecem07A; utilitário CLI não foi alterado.

Consulta dinâmica usa fields=['dynamic_query'], texto separado da consulta original do card e a mesma identidade/revisão capturadas. Não funde conversa/resposta/título automaticamente. Política de recuperação inteira permanece igual: não mudar maxResults por request porque isso alteraria corpusHash. Retriever prepara shortlist limitada a6; broker aplica limit/profile3 e tamanho real de resposta.

O callback não devolve query textual para auditoria nem faz I/O por path do agente. Cache é derivado e sempre precedido de ACL/FS/hash frescos; não concede acesso por presença de token.

## 9. Integração com ContextBridge

ContextBridgeCapability estende union com knowledge.search, preservando lista base de cinco. ContextBridgeOptions.knowledge é callback interno opcional, policy e candidatos; presença exige profile capturado/evidência e fonte no escopo. Grant exigido sem callback falha na construção, não cria binding5 silenciosamente.

Candidatos e fontes iniciais recebem IDs HMAC por binding com a mesma chave efêmera, mas mapas são separados. Sources.list continua mostrando seleção inicial; candidato recuperado não vira selecionado/readable. sources.read e dependencies continuam exigindo mapa inicial. maxSources limita a união; secret HMAC é apagado mesmo quando validação falha.

Broker valida request, reserva cota antes de await, reautoriza, chama host, valida resultado contra corpus/política/considered/query/card, identidade completa da fonte e hash do chunk, produz envelope limitado e audita. Callback não verificável revoga binding; retornos tardios nunca reativam canal. Não há novo registry de ferramentas ou autorização pelo plugin.

## 10. Integração com MCP

Ferramenta opcional orbit_knowledge_search, schema explícito additionalProperties=false, query e limit somente. Teto de comprimento do schema mais validação efetiva de bytes UTF-8 e limite do host. ReadOnly/destructive=false; não é ferramenta mutável ou semântica.

Grant percorre broker.descriptor→adapter interno initialize/capabilities→contextBridgeMcpBinding→factory/entrypoint MCP. Entrypoint recebe initialize autenticado pela assinatura UDS; não usa flag de grant em texto do agente/env/bootstrap para anunciar ferramenta. Policy ausente/inválida com cap anunciada falha fechada. Legado anuncia cinco; autorizado seis, com schema derivado do profile.

MCP2025-06-18, initialized/ping/errors/cancelamento mantidos. Structured e text alternativos preservam uma cópia do resultado. Envelope real deve caber nos256bytes reservados; text escaping pode causar recusa/fechamento, nunca duplicação gratuita de corpo. Cliente structured com match e text-only sem match foram testados no processo supervisionado; não se afirma que qualquer resposta textual grande cabe ou que Codex nativo utilizou o tool.

## 11. Proveniência

Resultados mostram sourceId opaco por binding, versão/declaração histórica, documentHash, bodyHash do trecho efetivo, tipo/origem/trust, linhas, score/rank e limites. Não mostram paths físicos, IDs internos crus, considered ou Source objects inteiros.

sourceIdentityHash na auditoria/resultado segue06: SHA256 do ID interno para correlação histórica com o manifesto. Não é o fingerprint completo de identidade07A (que inclui escopo/origem/proveniência). Ambos são metadados, não credenciais. A ligação histórica usa considered.id/versão/hash e record autorizado.

Trust não muda por score. Dados hostis continuam dados lexicais; selectedInitially/initialCompilation não afirmam consumo pelo modelo. Manifest.sources/material/compiledHash/fingerprint originais não são modificados para fingir entrega inicial.

## 12. Autorização

Host revalida runtime, owner do projeto, card/revisão/workspace, status running, workerId, cancel flag, config/permissões, plugins relevantes, raiz/Git/checkout, latest manifesto/turno e integridade. Callback repete verificação integral dos candidatos antes e depois da busca, inclusive cache hit.

Nenhuma identidade/escopo/política vem do request. Quatro dimensões rejeitadas explicitamente em testes: runtime/projeto/workspace/ator. ProjectRegistry preserva contrato real owner_id; não se inventou acesso multiusuário. Dois cards podem usar mesmos documentos autorizados sem compartilhar bindings ou quotas.

Regras de arquivos sensíveis07A, permissions de documento, filesystem.read, paths exatos e symlink safeguards permanecem. Fonte nova/removida/revogada/alterada não retorna como vigente. UUID/sourceId/queryId/corpusHash/fingerprint não autenticam.

## 13. Contexto versionado

Consulta dinâmica é evidência posterior, não recompilação. Revisão do card, manifesto, fingerprint/integridade, compiled/material hashes, Git/checkout, resultado técnico e integração continuam independentes.

A intenção e o corpus capturados são comparados com observação atual. Busca pode encontrar outro candidato do mesmo corpus; não substitui o ranking inicial registrado na07A nem torna o resultado regra validada. Changed corpus/policy exige nova preparação autorizada; nada é atribuído retroativamente ao run antigo.

Q&A cria manifesto filho e binding novos após compatibilidade. Query do turno anterior não é promovida a memória semântica válida. Saída técnica e histórico permanecem mesmo se a observação final mudar.

## 14. Orçamento

Mesmo contador/reserva do Bridge para todas as seis capacidades: maxRequests, maxResponseBytes, maxTotalBytes, maxConcurrent, requestTimeoutMs, limites de frame/transporte e orçamento reservado05. Requests simultâneos reservam maxResponseBytes+256 antes de awaits; consultas pequenas repetidas não reiniciam quota.

Profile dinâmico default schema1/maxQueryBytes1024/maxResults3; shortlist07A≤6. Broker remove deterministicamente o final da lista até o envelope caber, conservando trechos inteiros e explicitando returned/omitted/warnings. Se nem metadados couberem, recusa. Não corta código/regras/JSON nem inventa resultado vazio de autorização.

remainingBytesEstimated (e remainingBytes opcional na auditoria) é snapshot conservador maxTotal-charged-reserved antes de liberar a reserva da chamada. Não representa cota global a partir de página de histórico, tokens faturados ou uso pelo modelo. Contagem returned é do envelope Core preparado para adapter; eventual recusa posterior de framing MCP continua delivery_unverified.

maxSources é a união de fontes iniciais e candidatos. Catálogo07A máximo60 mais fontes obrigatórias pode exigir configurar conscientemente ORBIT_CONTEXT_BRIDGE_MAX_SOURCES (host-only) acima do default64; exceder falha antes de executar, sem esconder fontes. Nenhum knob foi aplicado operacionalmente.

## 15. Auditoria

207 permanece intacta.208 acrescenta knowledge_metadata JSONB nullable e validado, para queryHash/corpusHash/policyId/found/returned/omitted, estimativa restante opcional e fontes limitadas com IDs opacos/hash histórico/documentHash/versão. Não guarda query textual nem corpos ou paths.

Repository separa knowledge do audit.event antigo para satisfazer trigger207, grava coluna208 somente quando há metadata e recompõe leitura allowlisted. Eventos antigos/linhas NULL não são reescritos. SQL valida shape/limites/capability knowledge.search, não autentica usuário, rederiva ranking ou recalcula hashes.

request_received/authorized/response_prepared/response_emitted/delivery_unverified/denied/revoked/closed conservam significado. response_emitted é intake do adapter do host, não confirmação do MCP/CLI/modelo. Hash da resposta vincula ranking/proveniência/corpo sem armazenar conteúdo inteiro. Históricos sem corpo/query não permitem reconstrução universal de texto depois de remoção; não foi criado arquivo histórico de fontes.

208 também amplia de modo estrito o CHECK de source_version para sha256:64hex usado na07A, mantendo valores legados. Isso corrige sources.read de fontes opcionais endereçadas por conteúdo, sem modificar207. Probe do schema antes de abrir binding que exige busca ou versões modernas evita fallback silencioso em schema incompleto.

## 16. Lifecycle

Abertura usa policy capturada e schema disponível, prepara callback limitado e audita antes de expor handle. Cada consulta exige binding ativo; revogação/cancelamento/timeout/perda de worker/lease/turno/corpus impedem novas respostas. Callback tardio não passa pela checagem de ativo.

waiting_answer fecha o Bridge no finally anterior ao estado de espera. Resposta reautoriza, valida filho/corpus/policy/revisão/sessão e prepara novo binding, com nova chave HMAC. Antigo handle permanece revogado. Terminais/recursos sem autoridade não reabrem canal.

Supervisor03A e manager03B continuam donos de processos, drain e quarentena. Read-only binder não mata descendentes ou libera locks; não há limpeza/takeover automático. Corpo de uma resposta já autorizada no passado não pode ser revogado da memória do receptor; não se presume consumo semântico.

## 17. Integração com card_runs

PreparedContextManifest captura profile dinâmico usando metadados07A já compilados; worker resolve policy do mesmo manifesto. Coreopen só instala callback se Compiler+07A+Bridge+grant capturados e compatíveis. Idempotência early lookup e revisão transacional preservadas.

Binding só é exposto na preparação protegida. Busca alcança candidato other ausente do material inicial; factory/source validation falha antes do executor se corpus incompatível. Resultado do executor continua separado da observação final. Sem terceira fila ou lógica lexical no executor.

Worktree: novo bindActiveIsolatedCheckout é observador read-only no manager03B. Host exige policy nova, ALS isolado exato e lease corrente cobrindo raiz. Registro running/owner/pin/escopo/privatemanifest/inodes e Git HEAD detached/commondir/backpointer são verificados. Revalidação por query não inicia Git. Caminho compartilhado anterior permanece; worktree não registrada/pointer arbitrário continua bloqueado.

## 18. Integração com card_ai_runs

Alterações locais nas quatro prompt-sessions capturam nova policy e a revalidam sem retrofit. Flag nova habilitada depois não transforma policy antiga em seis ferramentas. O projeto fornecido ao Bridge agora usa a mesma raiz aprovada do collectContext em execução isolada; owner/config são revalidados sem ler corpos do checkout original para servir a pesquisa.

Sessão, quotas, Q&A, multiagent, imagens, output/progress e diferenças de produto foram preservados. Pergunta fecha handle anterior; resposta com policy/corpus alterado não consome turno. Fake provider recebe binding real preparado pelo serviço, pesquisa e confirma conteúdo/proveniência; nenhum Codex real é iniciado.

Em worktree o binder verifica ledger/metadata local e raiz do catálogo; testes registram caminhos de leitura apenas no temporário para provar que conteúdo veio do checkout aprovado. Substituição de HEAD por inode diferente (generic) e troca de owner do ledger (prompt) provocam recusa/revogação antes de nova busca. Alterações negativas são da fixture e restauradas dentro do teste; não existe reparo operacional automático.

## 19. Plugins

PluginRegistry/Definition, plugin base ai/dependentes, actions/capabilities/RBAC e APIs Core1.0.0/Plugin1 não foram reconstruídos. Nova capability é grant do host Core, não registro livre por plugin. Plugins/actions não recebem o handle privilegiado por acidente.

Recuperação pura funciona sem plugin IA; desligar IA não autoriza executar seus runs. Consumidor vetorial de Suindá, embeddings e lógica de outros produtos foram preservados por hash. Não há registry MCP paralelo ou fonte de autorização dentro do plugin IA.

## 20. Persistência

Reusados JSONB160/configuração/compilation e histórico207, com extensão aditiva208 após maior número global207. Sem tabela concorrente de resultados, sem índice persistente novo ou cache raw global.

208: função de validação de metadata, coluna nullable+CHECK e ampliação estrita do CHECK de source_version. Eventos207 e constraints/triggers antigos continuam, salvo extensão explicitamente aditiva de versão em208. UPDATE/DELETE/TRUNCATE permanecem protegidos pelo contrato207; admin privilegiado não está sob promessa de imutabilidade universal.

Nenhuma migration de produto foi alterada/aplicada. Bindings legados sem busca/versões modernas usam INSERT207 sem citar coluna nova; bindings07B e leituras com sha256 exigem schema208. Não fabricar metadata para eventos antigos.

## 21. Observabilidade

API de contexto autorizada existente recebe bridge.knowledge_search com enabled_at_capture, schema, queries_in_returned_history, emitted_results_in_returned_history, authority_state=captured_policy_not_live_channel, corpus_state=captured_not_live_search, counts_scope=returned_history_only e model_consumption=unverified.

Histórico allowlisted pode expor hashes/contagens/refusals/fontes opacas/estimativa segura, sem query, corpo, prompts, identidade física ou limites escolhidos pelo agente. Unique requestIds contam somente consultas representadas na página retornada; histórico limitado não é contagem global. bridge_created não prova canal ativo.

Nenhuma UI nova, endpoint público de busca ou observação GET que reescreva manifesto/histórico foi criada. Verificação de contexto global e compatibilidade do corpus de uma resposta são dimensões diferentes.

## 22. Implementação arquivo por arquivo

| Fonte/família | Responsabilidade anterior → mudança | Consumidor/compatibilidade/risco |
|---|---|---|
| context-bridge.ts | Broker5 → callback/grant opcional, schema6, mapa separado, resposta limitada e metadata segura. | Quota/audit/revoke únicos; cinco consultas preservadas. |
| context-bridge-knowledge.spec.ts | Novo18testes diretos com retriever real. | Schema/isolamento/ranking/budget/late/audit/MCP, sem provider. |
| knowledge-bridge.ts/.spec.ts | Novo adapter host e6testes. | Snapshot07A completo e reautorização/catálogo atual, sem BM25 duplicado. |
| knowledge-retrieval.ts | Extração knowledgeCandidateEvidence sem mudar fórmula. | Preparação e busca usam mesmo fingerprint de candidatos. |
| knowledge-host.ts | Exporta mesmo singleton e tipa metadata. | Um cache técnico por runtime/escopo, não segundo índice. |
| context-bridge-adapter.ts | Grants via handle e initialize/list/call condicionais. | Legado5 intacto. |
| context-bridge-mcp.ts | Tool opcional e validação de binding/profile host. | Schema derivado; cliente não concede capability. |
| context-bridge-mcp-entry.ts | Propaga grant do initialize assinado. | Bootstrap não escolhe ferramentas; native guard intacto. |
| context-bridge-host.ts/.spec.ts | Capture/compatibility/schema probe/callback e checkout gerenciado; corrige read optional/sha. | Revalidação antiga shared preservada; nova leitura Core não homologa sandbox. |
| isolated-checkout.ts | Novo observador read-only reaproveita manager. | Host ainda exige ALS+lease; helper não é autorizador standalone. |
| context-bridge-repository.ts/.spec.ts | Metadata208 opcional e sourceVersion sha. | Oldevent JSON intacto;6unitários. |
| sql/migrations/208_context_bridge_knowledge_audit.sql | Nova extensão de metadata e versão. | Não aplicada em produto;207 permanece por hash. |
| execution.service.ts | Snapshot policy+resumo seguro e integração existente. | Revisão/idempotência/lifecycle sem fila nova. |
| Quatro prompt-sessions.ts | Grant capturado/masklegacy/projeto aprovado no Bridge. | Inserções locais, sem substituir variantes por DEV. |
| tools/orbit/context-workers.test.mjs | Modo combinado07B e negativos em worktree/legado/audit. | Fake DB/quota/provider, Core/manager reais. |
| tools/orbit/knowledge-bridge-workers.test.mjs | Wrapper novo com env sintético. | Conta filhos separadamente. |
| tools/orbit/context-bridge-mcp-supervised.test.mjs | Dois cenários opcionais novos. | UDS/supervisor reais com launcher fake, não CLI nativo. |
| tools/orbit/context-bridge.postgres.test.mjs |208 e versões/metadata/limites/imutabilidade. | PG privado descartável. |
| AGENTS/product-experience +4orbit-architecture.ts | Regra07B sincronizada para IDE/painel/cartões. | Instrução host separada de texto recuperado. |
| workspace/package/4locks e projeções |4mappings novos, releases selecionadas. | Core1.11.5/224, API1 preservada; UI não sincronizada. |
| Este relatório | Referência autossuficiente. | Inventário individual em§27. |

Caminhos curtos da tabela são packages/orbit-core/src/execution salvo indicação. Projeções dos fontes compartilhados nos quatro runtimes são geradas, nunca editadas isoladamente.

## 23. Testes D1–D24

| ID | Estado/evidência | Limitação |
|---|---|---|
|D1|PASS grant condicional no broker/host/MCP.|Host-only; sem retrofit.|
|D2|PASS cinco consultas legadas e flags posteriores nas filas.|Não inicia nativeCodex.|
|D3|PASS callback usa retriever real e entrega trecho.|Corpus explicitamente capturado.|
|D4|PASS candidato other/Abacaxi não entrou inicialmente e retorna depois.|Não é fonte nova.|
|D5|PASS fora de catálogo/params sourceId/path recusados.|Sem contagem global.|
|D6|PASS corpus adicionado/alterado invalida binding.|Sem reranking do manifesto antigo.|
|D7|PASS remoção/revogação impede corpo.|Erro sanitizado; detalhes só metadata segura.|
|D8|PASS score/rank determinísticos.|IDs opacos variam por binding.|
|D9|PASS query hostil não altera escopo/trust.|Não é prova de obediência semântica de LLM.|
|D10|PASS envelope real, redução tail e omissão inteira.|Text pode recusar por escaping.|
|D11|PASS buscas sucessivas esgotam quota compartilhada.|Bytes estimados, não billing.|
|D12|PASS reserva/concurrency existentes, sem callback extra fora de slot.|Sem paralelismo irrestrito.|
|D13|PASS timeout suprime late response.|Callbacks não cooperantes podem terminar I/O sem entregar.|
|D14|PASS abort fecha binding antigo.|Sem retirar texto já recebido da memória de cliente.|
|D15|PASS auth/worker/lease e owner worktree inválidos recusam.|Não reparo/takeover automático.|
|D16|PASS runtime/projeto/workspace/ator incompatíveis recusados.|Project owner contract mantido.|
|D17|PASS worktree03B real nas duas filas, raiz de leitura e negativas de inode/owner.|Prova Core/in-process; UDS em sandbox nativo BLOCKED.|
|D18|PASS sources/material/fingerprint históricos inalterados.|Query é evidência posterior.|
|D19|PASS hash/count/audit sem query/corpo, falha audit nega emissão.|Não comprova modelo.|
|D20|PASS catálogo5/6 e calls structured/text em cliente/processo supervisionado.|Codex real NOT_RUN.|
|D21|PASS serviços existentes das duas filas e bindings corretos.|DB/quota/provider fake; PG separado.|
|D22|PASS perguntas/novo turno revogam handles antigos e preservam pai.|Não transforma query antiga em memória validada.|
|D23|PASS Core lexical independente de IA; plugin desativado não concede run.|Nenhum modelo executado.|
|D24|Resultados dirigidos§24.|Sem suíte global/serviço operacional.|


Mapa de reprodução por cenário (os nomes D estão nos títulos dos testes diretos): D1–D16/D18–D20/D23 → `forge/app/apps/api/src/execution/context-bridge-knowledge.spec.ts`, comando unitário§23, evidência unit-final.log; D6/D7/D18 adicionalmente → `knowledge-bridge.spec.ts`, mesmo comando/log. D2/D14/D15/D17/D18/D19/D21/D22/D23 → `node --test tools/orbit/knowledge-bridge-workers.test.mjs`, fixture `context-workers.test.mjs`, evidência dynamic-workers.log (18filhos). D20 adicionalmente → `node --test tools/orbit/context-bridge-mcp-supervised.test.mjs`, chain-final.log (6casos); D19/persistência → `node --test tools/orbit/context-bridge.postgres.test.mjs`, bridge-postgres.log (9casos). D24 → todos os comandos/listas§24. Cada PASS da matriz refere-se a esses arquivos/comandos e aos limites da coluna correspondente.

Complementares: query vazia/longa, acentos, no_match, oversized chunk, hash/version mismatch, config/corpus alterado, sourceId/path arbitrário, replay/terminal, flag do host, auditfail, schema init inválido, cache/source authorization e dados hostis. Matrix não soma24 testes Node fictícios.

Comandos novos seguros:
```sh
TSX_TSCONFIG_PATH=forge/app/apps/api/tsconfig.json node --import ./forge/app/node_modules/tsx/dist/loader.mjs --test forge/app/apps/api/src/execution/context-bridge-knowledge.spec.ts forge/app/apps/api/src/execution/knowledge-bridge.spec.ts
node --test tools/orbit/knowledge-bridge-workers.test.mjs
node --test tools/orbit/context-bridge-mcp-supervised.test.mjs
node --test tools/orbit/context-bridge.postgres.test.mjs
```
Evidências locais /tmp/orbit07b-audit. Falhas de preparação esperadas são negativas verificadas, não homologação de acesso externo.

## 24. Regressões

| Suíte/log local | Testes aprovados no processo pai |
|---|---:|
| unit-final.log | 219 |
| bridge-workers.log | 1 |
| bridge-adapter.log | 1 |
| bridge-provider.log | 1 |
| bridge-postgres.log | 9 |
| context-workers.log | 10 |
| context-compiler-workers.log | 1 |
| context-compiler-provider.log | 1 |
| regressions.log | 75 |
| context-postgres.log | 10 |
| isolation-regressions.log | 18 |
| lexical-cli.log | 22 |
| mcp-process.log | 1 |
| chain-final.log | 6 |
| knowledge-workers.log | 1 |
| dynamic-workers.log | 1 |

Total de processos pais: **377** testes; filhos informados pelos wrappers: bridge-workers12, compiler-workers17, knowledge-workers15 e dynamic-workers18, **62** adicionais distintos. Total **439 aprovados, zero falhos, cancelados ou ignorados nos runs finais**. Wrappers e filhos são informados separadamente; D1–D24 são critérios cruzados, não24 testes adicionais. Unit219 inclui novos18 broker/MCP,6helper,3repository adicionais e1host adicional; matrizes R/D e reexecuções não são somadas novamente.

As quatro APIs passaram em TypeScript (`tsc --noEmit --pretty false`, executado em cada `<runtime>/app/apps/api` com o compilador de `<runtime>/app/node_modules/typescript/bin/tsc`). Nenhuma suíte Web global foi executada. O preflight global permanece **BLOCK**, com os mesmos18 findings UI históricos; não é um gate geral aprovado. MCP/Codex nativo: **BLOCKED**, sem contagem fictícia como teste executado. Bancos/serviços operacionais e aplicação real da208: **NOT_RUN** por escopo.

Durante o desenvolvimento houve falhas corrigidas de fixture/tipagem/integrabilidade: expectativa authorization_lost versus revoked, raiz original do prompt recusada pela worktree, spy detectando leitura documental original no caminho de reautorização, import/tipagem de metadata e assert assíncrono de timeout registrado tarde. As duas primeiras rodadas dinâmicas falharam e foram preservadas em dynamic-workers-initial.log/dynamic-workers-final.log; unit-initial.log preserva a falha temporal. A solução restringiu o root autorizado e a revalidação, sem relaxar guards. O último timeout de fixture usa200ms e registra a expectativa imediatamente. Uma tentativa final de tsc apontou caminho inexistente do compilador; o comando corrigido abaixo passou nos quatro runtimes.

Reprodução das suites: Node24.20.0, dependências locais existentes; usar ambiente novo sem herdar DATABASE_URL/credenciais, HOME/CODEX_HOME temporários, CODEX_BIN inexistente, PATH=/usr/bin:/bin, TSX_DISABLE_CACHE=1, TSX_TSCONFIG_PATH absoluto do DEV, ORBIT_CONTEXT_COMPILER_ENABLED=0 e ORBIT_CONTEXT_BRIDGE_ENABLED=0 (fixtures opt-in habilitam suas flags). Git de fixture: GIT_CONFIG_NOSYSTEM=1, GIT_CONFIG_GLOBAL=/dev/null, hooksPath=/dev/null, fsmonitor=false, template temporário. PostgreSQL dos harnesses é privado e descartável.

Lista exata de arquivos unitários (prefixo `forge/app/apps/api/src/`), passados a `node --import ./forge/app/node_modules/tsx/dist/loader.mjs --test`:
```text
execution/context-bridge-knowledge.spec.ts
execution/knowledge-bridge.spec.ts
execution/knowledge-host.spec.ts
execution/knowledge-retrieval.spec.ts
execution/context-bridge-mcp.spec.ts
execution/context-bridge-mcp-entry.spec.ts
execution/context-bridge-peer.spec.ts
execution/context-bridge.spec.ts
execution/context-bridge-host.spec.ts
execution/context-bridge-adapter.spec.ts
execution/context-bridge-repository.spec.ts
execution/context-compiler.spec.ts
execution/context-compiler-host.spec.ts
execution/context-delivery.spec.ts
execution/context-manifest.spec.ts
execution/context-registry.spec.ts
execution/context-runtime.spec.ts
execution/execution.spec.ts
card-contexts.spec.ts
execution/isolated-execution-policy.spec.ts
execution/file-scope.spec.ts
execution/managed-process.spec.ts
execution/project-checks.spec.ts
execution/workspace-coordinator.spec.ts
execution/workspace-process.spec.ts
```

Suites Node adicionais, usando `node --test`:
```text
tools/orbit/context-bridge-workers.test.mjs
tools/orbit/context-bridge-adapter.test.mjs
tools/orbit/context-bridge-provider.test.mjs
tools/orbit/context-bridge.postgres.test.mjs
tools/orbit/context-workers.test.mjs
tools/orbit/context-compiler-workers.test.mjs
tools/orbit/context-compiler-provider.test.mjs
tools/orbit/shared.test.mjs
tools/orbit/preflight.test.mjs
tools/orbit/catalog.test.mjs
tools/orbit/registry-foundation.test.mjs
tools/orbit/card-revision-ui.test.mjs
tools/orbit/card-version-enqueue.test.mjs
tools/orbit/card-revisions.postgres.test.mjs
tools/orbit/workspace-coordinator.postgres.test.mjs
tools/orbit/workspace-workers.test.mjs
tools/orbit/context-manifests.postgres.test.mjs
tools/orbit/isolated-checkout.test.mjs
tools/orbit/isolated-provider.test.mjs
tools/orbit/isolated-workers.test.mjs
tools/orbit/knowledge.test.mjs
tools/orbit/knowledge-lexical.test.mjs
tools/orbit/context-bridge-mcp.test.mjs
tools/orbit/knowledge-retrieval-workers.test.mjs
tools/orbit/context-bridge-mcp-supervised.test.mjs
tools/orbit/knowledge-bridge-workers.test.mjs
```
O grupo lexical executa `tools/orbit/knowledge-lexical.test.mjs` (8 casos puros) e `tools/orbit/knowledge.test.mjs` (14 casos CLI),22 no total. O wrapper07A é `tools/orbit/knowledge-retrieval-workers.test.mjs`; o processo MCP legado é `tools/orbit/context-bridge-mcp.test.mjs`. Os logs locais guardam saída e contagem; sua retenção em /tmp não é persistência operacional.


## 25. Monorepo

Final Core fonte1.11.5/224 mappings. Integridade SHA-256 do pacote: `5067a71529e874a673f91faec63bb407e1aad196b14aa28d02e755ffcafe31d2`. As896 projeções Core coincidem com fontes e locks; as296 projeções UI mantêm exatamente os hashes/classificações do baseline. Releases selecionadas:1.11.0 capability/host/MCP/208/observador;1.11.1 cache singleton/tipos e raiz aprovada do prompt;1.11.2 autorização no root sem ler corpos originais em worktree;1.11.3 compatibilidade sources.read opcional/sha;1.11.4 estimativa segura restante e correção de expectativa temporal da fixture de timeout;1.11.5 distingue seleção inicial da fonte, seleção do trecho e escopo da decisão do Compiler.

Planos/precondições/apply em /tmp/orbit07b-audit/plan*.json e release*.json. Não houve edição manual de hashes ou sincronização UI global. UI1.1.3/74 e nove variantes/18 findings BLOCK anteriores preservados; Core/locks sem drift na conferência final. Publicação em arquivos não é commit/push/deploy ou ativação.

## 26. Segurança operacional

Somente arquivos/repos temporários, fake quota/provider/executores, HOME/CODEX_HOME sem auth, binários CLI fake/inexistentes e PG descartável. Nenhum Codex real (inclusive operações offline), inferência paga, embeddings, reranking/resumo por modelo, banco produto ou instalação de servidor vetorial.

Nenhum .env/config global, migration real, Git mutável original, deploy/restart, cleanup de worktree/quarentena operacional ou flag de runtime ativada. Mutações Git/HEAD/owner negativas ocorreram apenas em fixtures próprias e foram restauradas antes de encerrar o teste; não existe essa recuperação automática no runtime.

Agentes tiveram escopos separados para host/binder, repository/SQL e revisão read-only; integrador implementou broker/MCP/filas/integração e reviu tudo. Interrupção de turno não autorizou descarte de trabalho. Não se declara medição de economia de tokens/tempo por delegação.

## 27. Inventário Git

Comparação contra o snapshot imediatamente anterior à07B: **3413 arquivos existentes**, **79 modificados nesta etapa**, **22 novos**, **zero removidos**. O diff contra HEAD inclui alterações anteriores01–07A e não mede isoladamente esta implementação. Arquivos anteriores fora da lista abaixo permaneceram com hash idêntico ao baseline.

Modificados nesta etapa:
```text
AGENTS.md
forge/app/apps/api/src/execution/context-bridge-adapter.ts
forge/app/apps/api/src/execution/context-bridge-host.spec.ts
forge/app/apps/api/src/execution/context-bridge-host.ts
forge/app/apps/api/src/execution/context-bridge-mcp-entry.ts
forge/app/apps/api/src/execution/context-bridge-mcp.ts
forge/app/apps/api/src/execution/context-bridge-repository.spec.ts
forge/app/apps/api/src/execution/context-bridge-repository.ts
forge/app/apps/api/src/execution/context-bridge.ts
forge/app/apps/api/src/execution/execution.service.ts
forge/app/apps/api/src/execution/isolated-checkout.ts
forge/app/apps/api/src/execution/knowledge-host.ts
forge/app/apps/api/src/execution/knowledge-retrieval.ts
forge/app/apps/api/src/orbit-architecture.ts
forge/app/apps/api/src/plugins/ai/prompt-sessions.ts
forge/app/orbit.shared-lock.json
docs/product-experience.md
orbit.workspace.json
packages/orbit-core/package.json
packages/orbit-core/src/execution/context-bridge-adapter.ts
packages/orbit-core/src/execution/context-bridge-host.spec.ts
packages/orbit-core/src/execution/context-bridge-host.ts
packages/orbit-core/src/execution/context-bridge-mcp-entry.ts
packages/orbit-core/src/execution/context-bridge-mcp.ts
packages/orbit-core/src/execution/context-bridge-repository.spec.ts
packages/orbit-core/src/execution/context-bridge-repository.ts
packages/orbit-core/src/execution/context-bridge.ts
packages/orbit-core/src/execution/execution.service.ts
packages/orbit-core/src/execution/isolated-checkout.ts
packages/orbit-core/src/execution/knowledge-host.ts
packages/orbit-core/src/execution/knowledge-retrieval.ts
workspace/app/apps/api/src/execution/context-bridge-adapter.ts
workspace/app/apps/api/src/execution/context-bridge-host.spec.ts
workspace/app/apps/api/src/execution/context-bridge-host.ts
workspace/app/apps/api/src/execution/context-bridge-mcp-entry.ts
workspace/app/apps/api/src/execution/context-bridge-mcp.ts
workspace/app/apps/api/src/execution/context-bridge-repository.spec.ts
workspace/app/apps/api/src/execution/context-bridge-repository.ts
workspace/app/apps/api/src/execution/context-bridge.ts
workspace/app/apps/api/src/execution/execution.service.ts
workspace/app/apps/api/src/execution/isolated-checkout.ts
workspace/app/apps/api/src/execution/knowledge-host.ts
workspace/app/apps/api/src/execution/knowledge-retrieval.ts
workspace/app/apps/api/src/orbit-architecture.ts
workspace/app/apps/api/src/plugins/ai/prompt-sessions.ts
workspace/app/orbit.shared-lock.json
safdoulas/app/apps/api/src/execution/context-bridge-adapter.ts
safdoulas/app/apps/api/src/execution/context-bridge-host.spec.ts
safdoulas/app/apps/api/src/execution/context-bridge-host.ts
safdoulas/app/apps/api/src/execution/context-bridge-mcp-entry.ts
safdoulas/app/apps/api/src/execution/context-bridge-mcp.ts
safdoulas/app/apps/api/src/execution/context-bridge-repository.spec.ts
safdoulas/app/apps/api/src/execution/context-bridge-repository.ts
safdoulas/app/apps/api/src/execution/context-bridge.ts
safdoulas/app/apps/api/src/execution/execution.service.ts
safdoulas/app/apps/api/src/execution/isolated-checkout.ts
safdoulas/app/apps/api/src/execution/knowledge-host.ts
safdoulas/app/apps/api/src/execution/knowledge-retrieval.ts
safdoulas/app/apps/api/src/orbit-architecture.ts
safdoulas/app/apps/api/src/plugins/ai/prompt-sessions.ts
safdoulas/app/orbit.shared-lock.json
suinda/app/apps/api/src/execution/context-bridge-adapter.ts
suinda/app/apps/api/src/execution/context-bridge-host.spec.ts
suinda/app/apps/api/src/execution/context-bridge-host.ts
suinda/app/apps/api/src/execution/context-bridge-mcp-entry.ts
suinda/app/apps/api/src/execution/context-bridge-mcp.ts
suinda/app/apps/api/src/execution/context-bridge-repository.spec.ts
suinda/app/apps/api/src/execution/context-bridge-repository.ts
suinda/app/apps/api/src/execution/context-bridge.ts
suinda/app/apps/api/src/execution/execution.service.ts
suinda/app/apps/api/src/execution/isolated-checkout.ts
suinda/app/apps/api/src/execution/knowledge-host.ts
suinda/app/apps/api/src/execution/knowledge-retrieval.ts
suinda/app/apps/api/src/orbit-architecture.ts
suinda/app/apps/api/src/plugins/ai/prompt-sessions.ts
suinda/app/orbit.shared-lock.json
tools/orbit/context-bridge-mcp-supervised.test.mjs
tools/orbit/context-bridge.postgres.test.mjs
tools/orbit/context-workers.test.mjs
```

Novos nesta etapa:
```text
forge/app/apps/api/sql/migrations/208_context_bridge_knowledge_audit.sql
forge/app/apps/api/src/execution/context-bridge-knowledge.spec.ts
forge/app/apps/api/src/execution/knowledge-bridge.spec.ts
forge/app/apps/api/src/execution/knowledge-bridge.ts
docs/implementacao-arquitetural/07B-CONSULTA-LEXICAL-DINAMICA-CONTEXT-BRIDGE.md
packages/orbit-core/sql/migrations/208_context_bridge_knowledge_audit.sql
packages/orbit-core/src/execution/context-bridge-knowledge.spec.ts
packages/orbit-core/src/execution/knowledge-bridge.spec.ts
packages/orbit-core/src/execution/knowledge-bridge.ts
workspace/app/apps/api/sql/migrations/208_context_bridge_knowledge_audit.sql
workspace/app/apps/api/src/execution/context-bridge-knowledge.spec.ts
workspace/app/apps/api/src/execution/knowledge-bridge.spec.ts
workspace/app/apps/api/src/execution/knowledge-bridge.ts
safdoulas/app/apps/api/sql/migrations/208_context_bridge_knowledge_audit.sql
safdoulas/app/apps/api/src/execution/context-bridge-knowledge.spec.ts
safdoulas/app/apps/api/src/execution/knowledge-bridge.spec.ts
safdoulas/app/apps/api/src/execution/knowledge-bridge.ts
suinda/app/apps/api/sql/migrations/208_context_bridge_knowledge_audit.sql
suinda/app/apps/api/src/execution/context-bridge-knowledge.spec.ts
suinda/app/apps/api/src/execution/knowledge-bridge.spec.ts
suinda/app/apps/api/src/execution/knowledge-bridge.ts
tools/orbit/knowledge-bridge-workers.test.mjs
```

Baseline/status/hashes em /tmp/orbit07b-audit. Nenhum arquivo anterior removido.07A engine/CLI, migrations157–160/207, guards Codex, supervisor/coordinator, consumidor vetorial Suindá, UI e relatórios anteriores foram preservados por hash fora do escopo listado. Main/HEAD não mudaram; sem stage/commit/push/tag.

## 28. Limitações e riscos

1. BM25 é lexical; score não significa verdade, aprovação, dependência completa ou similaridade semântica.
2. Compatibilidade retornada refere-se ao corpus/binding observado, não à totalidade semântica/global do contexto.
3. FS/DB/ACL não formam snapshot atômico; revalidação antes/depois e checks físicos limitam races, sem proteção universal a root/ptrace/pluginhost não cooperante/editor externo.
4. Observador isolado só é válido sob precondições do host (ALS/lease/manager/registro running); não é autorizador standalone nem novo manager. Leituras Core em worktree não homologam MCP/UDS no sandbox provider.
5. Fonte sem evidência, hash incompatível ou corpus atual maior não tem fallback histórico; novo run autorizado é necessário.
6. Volume pode omitir todos trechos de um match grande, explicitamente; MCPtext pode fechar por overhead. Não se trunca documento estruturado.
7. found conta shortlist da07A, returned envelope Core e remaining snapshot conservador; não são total global ou consumo do modelo.
8. Cache compartilhado de tokens continua privado por escopo/checkout e exige fontes atuais; não é fonte da verdade, memória universal ou persistência raw.
9. Auditoria guarda hashes/refcounts, não query/corpo; reconstrução histórica integral não é garantida se fonte some.
10. API de histórico é limitada/paginada e não prova canal ativo. GET não deve ser usado para executar busca.
11. Schema208 é necessário para a capacidade e para algumas leituras Bridge07A com versões sha256; sem ele falha fechada. Nada foi aplicado em produto.
12. Native MCP/Codex permanecem bloqueados por configuração/PID confiável/sandbox/resume descritos na06C; testes fake não removem esse bloqueio.

## 29. Pendências de ativação

Default ORBIT_CONTEXT_BRIDGE_KNOWLEDGE_ENABLED ausente/0. Para preparação nova exige também ORBIT_CONTEXT_COMPILER_ENABLED=1, ORBIT_KNOWLEDGE_RETRIEVAL_ENABLED=1, ORBIT_CONTEXT_BRIDGE_ENABLED=1, catálogo explícito e manifesto verificável. Flag1 não atualiza binding antigo nem habilita Codex nativo.

Ativação futura requer autorização separada: verificar/aplicar208 e schema160/207 por banco, revisar catálogo/ACL/volume/cap union/retention, homologar funcionalmente recursos por produto, testar lifecycle/erros em ambiente preparado e confirmar asset JS/Python. Não editar .env ou serviço automaticamente.

Nenhuma flag de homologação nativa foi criada. Runtimes/bancos seguem isolados. Feature código disponível não é implantação.

## 30. MCP/Codex

Funciona em fixtures: negociação2025-06-18, ferramentas5/6 condicionais, broker real, structured/text com limites, processo stdio, UDS com peer/públicakey e supervisor real com launcher sintético.

Bloqueado/não testado: configuração exclusiva no Codex0.160.0 real, PID confiável do servidor nativo, acesso UDS sob sandbox/network-off e resume nativo. CodexExecutor/CodexAiService recusam Bridge antes de iniciar CLI, bytecode/guards não foram removidos. Não houve inferência autenticada ou teste que a simule como prova real.

Core07B não depende de ativar esse canal para existir; executores autorizados de fixture podem consumir binding diretamente. Não se anuncia integração nativa funcional em produção.

## 31. Preparação da próxima etapa

| Capacidade futura | Contratos disponíveis/limite |
|---|---|
| Registro de descobertas | Hash/proveniência/audit existem; falta aprovação/retenção/autoria, sem escrita nesta etapa. |
| Memória versionada | Manifesto e query posterior são evidência, não memória semântica validada. |
| Knowledge Reconciliation | Recusas/versões podem ser insumo; nenhuma reconciliação automática. |
| Consistência entre cards | Fontes de projeto compartilháveis sob ACL; revisão e run permanecem separados. |
| Integration Gate | Contexto/resultado/integração continuam estados distintos; nenhum merge. |
| Desired State Reconciler | Ausente; consulta não altera intenção/recursos. |
| Vetorial opcional | Consumidor Suindá intacto; demanda contrato/modelo/quota específicos. |

Nada dessas capacidades ou07C foi iniciado.

## 32. Handoff técnico

Arquivos centrais: context-bridge.ts, knowledge-bridge.ts, context-bridge-host.ts, context-bridge-mcp.ts, context-bridge-mcp-entry.ts, repository/208 e isolated-checkout.bindActiveIsolatedCheckout. knowledgeCandidateEvidence e projectKnowledgeRetriever reutilizam07A.

Profile capturado: configuration.contextBridge.knowledge={schemaVersion:1,maxQueryBytes:1024,maxResults:3}. configuration.knowledgeRetrieval.considered/catalogHash/catalogPolicyHash/corpusHash originais delimitam candidatos. O handler não escolhe fontes por input do agente.

Exemplo MCP (somente em binding com grant):
```json
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"orbit_knowledge_search","arguments":{"query":"calendário institucional","limit":1}}}
```

Comandos read-only: node tools/orbit/cli.mjs preflight --format json; node tools/orbit/cli.mjs shared check. Testes§23/24. Publicação futura exige plano/precondições/atribuição; não repetir release sem mudança. Schema208 em arquivo não prova instalação real.

Lifecycle obrigatório: abrir sob lease/card/manifesto atuais, propagar signal, fechar binding no finally antes de waiting_answer/terminal, revalidar childturn e preparar novo binding para answer. Não reutilizar query/corpus/sourceId como credencial nem reabrir callbacks antigos. Owner de transporte deve acoplar revogação/close ao binding; fechamento de adapter não drena processos sozinho.

Erros críticos de corpus/auth/audit/timeout revogam; schema/limites são recusados com código seguro. RPC fechado pode ser genérico; histórico mantém razão sanitizada. Não retirar guards ou liberar sandbox para obter ferramenta funcional.

## 33. Resultado final

**CONCLUÍDA no escopo de código e testes isolados da07B.**

| Dimensão | Resultado |
|---|---|
| Código/contratos | knowledge.search opcional/versionada no broker existente. |
| Recuperação | Retriever/cache/BM25/chunking07A reutilizados; corpus capturado estrito. |
| Consultas posteriores | Candidato não inicial recuperável; manifesto/material originais imutáveis. |
| Duas filas | Bindings reais em serviços com fake executor; Q&A/legado e worktree gerenciada exercitados. |
| MCP em fixtures | Ferramenta condicional, modos structured/text, stdio/UDS/supervisor aprovados no alcance declarado. |
| Auditoria/persistência |207 preservada,208 aditiva e testada em PG descartável; sem banco real. |
| Distribuição | Core1.11.5/224 em quatro runtimes; UI histórica preservada. |
| Homologação/ativação operacional | Não executadas; autorização futura específica. |
| MCP/Codex nativo | BLOCKED conforme06C, guard preservado. |

Não avançar automaticamente para07C.
