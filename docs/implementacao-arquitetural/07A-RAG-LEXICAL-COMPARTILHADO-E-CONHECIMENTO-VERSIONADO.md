# Implementação07A — Recuperação lexical compartilhada e conhecimento versionado

Data:2026-11-15. Referência de código e validação isolada; sem autorização operacional.

## 1. Resumo executivo

**CONCLUÍDA no escopo de código e testes isolados da07A.** Implementada recuperação lexical compartilhada por projeto, com BM25 extraído do utilitário existente, catálogo explícito autorizado, chunking estrutural, cache derivado em memória, proveniência, consulta baseada no card versionado e integração efetiva ao contexto compilado das duas filas.

Candidatos, selecionados e incluídos pelo compiler têm estados e evidências distintos. Corpus e seleção integram metadados imutáveis do manifesto; mudanças inclusive em candidatos não selecionados impedem a execução silenciosa com ranking novo. Perguntas/retomadas e idempotência preservam histórico. Recuperação é opt-in, exige compiler e continua independente de IA/modelo/MCP.

Core fonte final **1.10.6**, **220 mappings**; Core API1.0.0/Plugin API1 preservadas. Não houve migration nova/real, ativação, deploy/restart, Codex real, inferência, embeddings ou07B. MCP nativo permanece bloqueado conforme06C. Isto é recuperação **lexical**, sem validação ou similaridade semântica.

## 2. Base documental

Considerados os21 relatórios00–20 de docs/sondagem-arquitetural e todos os relatórios de implementação disponíveis01–06C, inclusive versões finais/adendos. Leitura e confronto focal com código atual, sem reabrir auditoria global. AGENTS, orbit-environment, workspace, experiência de produto, aceleração, PluginRegistry/PluginDefinition e mecanismo lexical existente foram consultados.

01 fontes/projeções;02 revisão/CAS;03A físico/lease/supervisor;03B checkout isolado;04 ProjectRegistry/manifests;05 compiler/envelope/receipts;06 broker/autorização/207;06B MCP;06C transporte/guards. Os bloqueios nativos06C são preservados, não reinterpretados como autorização de ativação.

Trabalho direto no IDE, sem cartão de execução ou write_scope fornecido. Planejamento/revisão auxiliares em /tmp/orbit07a-audit-notes.md, sem ampliar permissões.

## 3. Estado inicial

main, HEAD **d9307b8e6a54316f802acbd7bcb96baa26116f16**, preservados. Core fonte1.9.6/213, Core API1.0.0/Plugin API1, UI1.1.3/74. A06C relatou324 testes; isso é histórico, não contagem automática desta execução.

Baseline por arquivo e status em /tmp/orbit07a-audit/before.json e status-before.txt; árvore já continha trabalho01–06C/produto. Preflight inicial BLOCK por18 findings associados às nove variantes UI anteriores; Core sem drift/locks pendentes. Migrações157–160 e207 existentes em arquivos; nenhuma instalação real presumida. Dados e configuração operacional não foram consultados.

## 4. Conhecimento existente

tools/orbit/knowledge.mjs continha tokenização e fórmula BM25 puras misturadas a CLI/FS/Git/cache .orbit/cache/knowledge/index.json. CLI indexa arquivos Git e includes explícitos, filtra formatos/sensíveis, guarda documentos/chunks e hashes; query filtra runtime/path antes de deduplicar, calcula BM25, revalida hash e pode exigir --fresh. Seu chunker legado usa janelas45/60linhas e cache de corpos: esse comportamento permanece **somente no utilitário de desenvolvimento**, não foi convertido em autorização de aplicação.

Extraídos words e ranking para knowledge-lexical.js, módulo puro sem FS/DB/modelo. CLI delega ao mesmo algoritmo com desempate legado localeCompare/path/start; preservados cache/janelas/saída/flags. Core usa mesma fórmula com desempate estável por identificador, catálogo host e chunker estrutural novo versionado.

ProjectRegistry já possuía get(owner_id), documents, safe readResource/fileSource, hashes de corpo redigido e rawHash, observeSelection/revalidateSelection. Esses contratos foram reutilizados. linkedCardContexts já autoriza cards relacionados; permanece no contexto atual, **sem novo índice lexical de cards** nesta etapa.

Consumidor vetorial específico de Suindá, com owner_plugin_id/collection/workspace e OrbitEmbeddingsService, foi inspecionado apenas para delimitar fronteiras; arquivos e comportamento não alterados nem globalizados.

## 5. Decisões arquiteturais

| Escolha | Motivo |
|---|---|
| Extrair motor puro do CLI | Uma fórmula/tokenização canônicas, sem importar autoridade FS/Git do utilitário. |
| Catálogo explícito por projeto | Descobre candidatos fora do prompt sem varrer Git ou diretórios inteiros. |
| Retriever determinístico no Core | Plugin IA consome resultado; não decide permissões/score/orçamento. |
| Cache privado de vetores/ranges por escopo | Evita tokenização repetida sem guardar corpo bruto ou usar cache como autoridade. |
| Fontes selecionadas opcionais + evidência do corpus | Compiler controla inclusão; manifesto detecta mudança até em candidato omitido. |
| Política capturada nas duas filas | Não retrofitar legado nem reclassificar run antigo com ranking novo. |
| Nenhuma migration | JSONB160/configuração de compilação já comportam metadados, sem índice persistente novo. |

A pipeline mantém comparação da preparação/worker/delivery/final. Não se declara transação atômica FS+PostgreSQL nem aprovação semântica pelo ranking.

## 6. Contratos de recuperação

knowledge-retrieval.ts exporta KnowledgeCandidate, KnowledgeRetrievalPolicy, KnowledgeResult, KnowledgeChunk, knowledgeQueryFromCard, ProjectKnowledgeRetriever, knowledgeCompileInputs e knowledgeRetrievalMetadata.

retrieve recebe identidade host ContextManifestIdentity, query textual+campos+card/revisão, candidatos autorizados, política, callback authorize, signal e checkout opcional. Callback é capacidade interna do host, não parâmetro público do agente. Revalida autorização antes de indexar e antes de expor selecionados. Source.scope/owner/runtime/projeto/workspace/ator/availability/hash/version precisam corresponder; host_policy é recusado como candidato recuperável.

Retorna queryId determinístico/queryHash, algoritmo/política, corpusHash, candidatos considerados autorizados, chunks selecionados com ranking/score/versão/hashes/origem/trust/linhas, status/limitações/avisos e fingerprint. Resultado é deep-cloned para não manter referências mutáveis de candidato/política. RunId/turno/timestamps não desempatem ranking nem alteram seleção semântica.

Statuses matched/no_match/insufficient_corpus; fontes alteradas/indisponíveis/sem comprovação/escopo incompatível e limites inválidos causam falha controlada, não informação antiga com aparência de atual.

## 7. Catálogo de candidatos

Configuração explícita autorizada do projeto:
```yaml
knowledge_retrieval:
  documents: [knowledge/calendario, rules/contratos, skills/operacao]
  files: [docs/referencia.md]
```

Cada lista máximo30; nomes exatos, sem glob/recursão. Ausência de configuração produz corpus vazio controlado; não descobre tudo implicitamente. documentos vêm das classes existentes knowledge/rules/skills de .orbit, e arquivos são somente referências textuais explicitamente configuradas. ProjectRegistry pode fazer sua listagem limitada de recursos .orbit existente; isso não inclui todo repositório no corpus.

Arquivos exigem filesystem.read na execução; documentos com frontmatter permissions não satisfeito são excluídos de corpos/resultados/contagens. Fontes configuradas disponíveis para recuperação não recebem aprovação por constar em rules/. Todo material de catálogo atual é documentary/reference, nunca host_policy.

Negados caminhos absolutos/escape/globs, symlinks fora do projeto e segmentos reservados: .env/.git/.ssh/.codex/.next, node_modules, data/backups/sessions/state/snapshots/dist/build/coverage, caches/logs, auth/credential(s)/secret(s), chaves e .orbit/cache/local/validations. Tipos textuais permitidos explícitos; não há bancos/indexação de credenciais. Revalidação usa autoridade atual do projeto antes e depois de preparar corpus.

## 8. Corpus e indexação

Host prepara catálogo com policyHash/catalogHash e corpos atuais redigidos, preservando hash canônico do ProjectRegistry e rawHash. CorpusHash considera escopo, política e identidade/versão/hash de **todos os candidatos autorizados**, mesmo os não selecionados. Não contém corpora de outros projetos por parâmetro arbitrário.

Cache técnico ProjectKnowledgeRetriever: máximo64 escopos, chave runtime/projeto/workspace/ator/política/checkout aprovado; entradas por chunk/documento/versão/hash. Retém somente tokens e chaves derivadas, sem corpo bruto. Cada chamada lê/reautoriza fontes atuais antes do lookup; mudança reusa apenas entradas comprovadamente idênticas, remoção/revogação elimina entradas do próximo mapa daquele escopo. Reinício perde cache; instâncias/processos não compartilham índice persistente.

Checkout entra somente na chave técnica do cache; fingerprint semântico permanece independente de caminho físico para permitir preparação/delivery equivalentes em worktree autorizada. Corpo sempre vem do checkout aprovado naquela chamada. Hash de raiz não autentica.

Não há promessa de evitar todas leituras: para comprovar atualidade/ACL, o host revalida o corpus. A economia incremental é da tokenização de fontes idênticas; não foi medida redução de tempo/tokens faturados.

## 9. Ranking BM25

Motor orbit-bm25-lexical/1, política orbit-lexical-retrieval/1 (algorithm configurado orbit-bm25/1). Tokenização compartilhada: normalize NFD, remove marcas Unicode, lower-case, regex letras/números/underscore/hífen com mínimo2 caracteres. Acentos portugueses e caixa são normalizados; não há stemming, stopwords ou equivalência semântica.

Para cada termo único da consulta, df é número de chunks de scoring contendo termo, tf sua frequência, N tamanho do corpus e avgdl comprimento médio. Fórmula preservada do CLI:
```
idf = log(1 + (N - df + .5)/(df + .5))
score += idf * tf * 2.2 / (tf + 1.2*(.25 + .75*dl/avgdl))
```
Scores arredondados a6 casas. Chunks equivalentes comprovados são deduplicados antes de df; versões diferentes não são fundidas. Desempate Core por id determinístico derivado de documento/versão/hash/posição, por comparação de codepoints, nunca recência/run/timestamp. CLI preserva seu desempate legado.

Label lógico e texto compõem tokens. Max6 resultados, max2 por documento por default. Score0 não vira similaridade inventada. Acentos iguais não comprovam significado, dependências completas ou verdade de conteúdo.

## 10. Chunking

orbit-structural-chunks/1 segmenta headings, parágrafos e blocos cercados por fences. Preserva texto original (inclusive CRLF), posições UTF16 e linhas1-based; chunks não cortam fence/parágrafo arbitrariamente. Não é parser AST de código/regra nem chunking semântico.

Bloco maior que cap é omitido inteiro com motivo/posição, sem truncar regra/código e sem resumir. Material recuperado é opcional; regras obrigatórias já selecionadas continuam no builder/compiler existentes. Avisos structural_blocks_omitted são registrados, sem alegar recuperação completa.

Default chunk6000bytes, max256chunks no corpus; limite global excedido falha controladamente. ID do chunk deriva de documento/versão/hash/posição; bodyHash separado de documentHash. Títulos semelhantes não substituem identidade do documento.

## 11. Proveniência

Cada candidato selecionado preserva ContextSource.scope/owner/origin/resourceId/logicalPath/trust, hash canônico do corpo conforme Registry e provenance.rawHash do arquivo. Version para documentos/arquivos recuperados é sha256:rawHash, sem inventar revisão histórica. BodyHash e chunkHash são de representações redigidas realmente consideradas; não substituem o hash do Registry.

Metadados registram sourceId/sourceVersion/ranking/linhas/heading/hashes e política autorizadora. Considerados não selecionados não entram falsamente em manifest.sources ou material entregue. Heading é metadado lógico redigido, não corpo integral.

knowledgeCompileInputs preserva trust e diferencia referência recuperada, observação técnica, histórico, hipótese e resultado não aprovado quando esses tipos forem explicitamente fornecidos por contrato host futuro. Catálogo atual fornece somente documental. Um score nunca aprova regra; host_policy é recusado, e fontes explícitas obrigatórias mantêm required/trust originais ao conciliar IDs.

## 12. Autorização e isolamento

Quatro dimensões são explícitas e reavaliadas: runtime/projeto/workspace/ator. O host resolve projeto por owner_id e card por ACL existente; corpus não recebe permissão da consulta. ProjectRegistry.revalidateSelection valida raiz atual e fontes; catálogo refeito detecta perda de acesso/frontmatter/permissão/configuração. Callback autoriza antes de tokenizar e antes de expor selecionados; host revalida corpus inteiro após ranking.

Dois cards autorizados do mesmo projeto podem usar mesmas fontes dentro de suas permissões; isso não compartilha run/session/binding. O contrato real atual de projeto é owner_id: não se inventou associação multiusuário para permitir segundo ator. Workspaces têm namespaces/cache separados; a mesma documentação de projeto pode ser autorizada em dois cards sem misturar dados de execução.

Cache nunca responde sozinho, não expõe consultas/sugestões/contagens de fontes excluídas e não usa TTL como ACL. Paths/symlinks seguem safePath/readResource do checkout aprovado. Documento malicioso permanece dado JSON de referência, sem execução, alteração de política ou elevação para instrução host.

## 13. Consulta baseada em card

knowledgeQueryFromCard considera título e descrição capturados mais explicit_terms somente se caller autorizado fornecer a lista (pipeline atual usa título/descrição). Registra nomes dos campos, cardId/cardRevision, queryHash/queryId. Revisão ausente/mismatch é recusada.

Sem histórico inteiro, comentário, resposta à pergunta ou termos de cards não autorizados adicionados automaticamente. Isso mantém o conhecimento compartilhado estável em Q&A quando card/política/corpus não mudam. Nova revisão pode mudar consulta e seleção, preservando evidência anterior. Não afirma descobrir todas dependências reais.

## 14. Integração com Project Context Registry

knowledge-host.ts usa ProjectRegistry.get/revalidateSelection/document/documentSource/fileSource/configurationSource; não cria registry ou autorização paralelos. prepareKnowledgeCandidates separa disponibilidade da escolha lexical; prepareProjectKnowledge chama retriever e revalida catálogo completo.

A autorização de escopo da execução é criada pelo host e cruzada com card/projeto/ator antes da consulta. Generic e prompt fornecem selectedProject já remapeado ao checkout aprovado, sem ler authorizationRoot para servir texto. Fontes selecionadas entram na lista observada do manifesto; configurações de catálogo/corpus também viram metadados comparáveis.

## 15. Manifestos e fingerprints

configuration.knowledgeRetrieval é extensão aditiva schemaVersion1 contendo política, query hash/campos, corpus/catalog hashes, fontes consideradas autorizadas (sem corpo), seleção/ranking/version/posição/hashes, fingerprint e decisões do compiler para esses blocks. Não armazena outra cópia dos documentos/consulta textual.

A evidência distingue intenção/estado observado/material compilado. Fonte candidata não selecionada só aparece como metadado de corpus, não como entregue. Selecionado pode ser omitido pelo compiler; isso é registrado em compilationDecisions/sourceUsage.

Fingerprint de seleção é determinístico e não inclui timestamps/cache hit/runId. Manifest fingerprint/integrity/material/compiledHash continuam com semântica04/05, agora abrangendo metadados aditivos. O manifesto histórico nunca é substituído por ranking atual. Mudança até em candidato não selecionado altera corpusHash/catalogHash e falha na comparação antes do executor.

## 16. Integração com Context Compiler

knowledgeCompileInputs gera ContextSources opcionais e ContextCompileBlocks dependencies/priority related, kind structured com JSON de classificação, proveniência, trecho e hashes. Nenhum trecho lexical vira host_policy. Regras/skills já obrigatórias não são rebaixadas por deduplicação com recuperação; hash incompatível com fonte explícita falha controladamente.

compileContext decide inclusão/omissão/deduplicação usando orçamento05 e dependencies/sourceUsage. knowledgeRetrievalMetadata filtra decisões por blockId, sem assumir que todos selecionados foram entregues. Hash do material final e ContextDelivery receipts existentes continuam prova da fronteira de adapter, não consumo semântico do modelo.

Caps de corpus/chunks são proteção de volume, não um novo orçamento de tokens. O compiler pode omitir completamente o material opcional. Não há truncamento oculto de corpo recuperado obrigatório nem fallback para satisfazer policy sem compiler.

## 17. Integração com card_runs

ContextBuilder.build recebe knowledgePolicy opcional no scope: undefined prepara conforme host atual; null mantém legado/desativado; objeto corresponde à política capturada. Acrescenta recuperação antes de compileContext e evidência após decisões. CardExecutionService.resolved e todos rebuilds/API/final/checkout propagam essa política.

Enqueue mantém idempotency early lookup e duas preparações/observações antes de transação de revisão/manifesto. Worker resolve política capturada, recusa alterações do host, rebuilda corpus no projeto/checkout autorizado, compara manifesto antes da entrega e observa fontes ao finalizar. Resultado do executor não é descartado por drift final; compatibilidade é separada do status técnico.

Teste com corpus não selecionado alterado antes de worker bloqueia executor e preserva manifesto/retry original. Worktree real de fixture usa fontes e rawHash do checkout aprovado. Não houve Git mutável no Orbit original.

## 18. Integração com card_ai_runs

Mudanças localizadas nos quatro prompt-sessions: política capturada em resume ou atual em preparação nova; prepareProjectKnowledge dentro de collectContext com card ativo, permissões configuradas e selectedProject. Fontes/blocks opcionais são incorporados antes do compiler; metadados aditivos acompanham compilation.

Idempotência mantém lookup antes de recuperação. Pergunta preserva parent e gera manifesto filho somente após compatibilidade. A consulta não inclui resposta/conversa; mudança de corpus impede retomada sem consumir turno. Mudança de política capturada gera resume_rejected knowledge:policy e HTTP409, sem chamada ao provider. Nenhum remix de conhecimento em sessão antiga incompatível.

Provider/modelo/quota/multiagent/eventos e diferenças dos produtos não foram reescritos. Harness usa serviços reais, quota/provider fake; as quatro APIs compilam. Com recuperação desativada na captura, habilitar host depois não retrofita run legado. Não se altera memória interna do Codex nem se remove guard MCP.

## 19. Plugins

Core possui algoritmos/contratos/catálogo determinístico. Plugin IA apenas consome composição host. PluginRegistry/PluginDefinition, dependências/parentPlugin, actions/capabilities/RBAC e APIs Core1.0.0/Plugin1 foram preservados.

Sem plugin lexical concorrente, sem import de classe concreta IA no Core, sem nova fila. Consumidor vetorial de Suindá continua isolado, sem embeddings ou expansão global. Regras persistentes sobre recuperação e evidência foram sincronizadas em AGENTS, product-experience e orbitArchitecturePrompt dos quatro runtimes para painel Codex/cartões.

## 20. Persistência

Sem migration nova. Schema160 e metadados de compilation já permitem guardar evidência;207 continua exclusiva da auditoria Bridge.157–160/207 e migrations próprias dos produtos não foram alteradas nem aplicadas operacionalmente.

Índice Core é derivado em memória, com retenção de vetores/token hashes limitada a64escopos e reinício do processo. Dados brutos não são guardados no cache; texto compilado segue persistência histórica existente da execução/manifesto. Tokens derivados ainda são dados privados internos, não cache público; ACL fresca sempre é exigida. Não há índice global entre produtos ou TTL que conceda acesso.

Cache persistente do CLI permanece mecanismo de desenvolvimento separado, com comportamento anterior; não é usado para servir corpus da aplicação.

## 21. API e observabilidade

contextManifestDto recebe summary allowlisted knowledge_retrieval: schema/algorithm/policyId/corpusHash/queryHash/fingerprint/status, authorized_candidates, selected_chunks, included_chunks, omitted_chunks e warning_count. Rota de contexto existente mantém autorização por recurso; não foi criada busca pública ou UI nova.

included_chunks significa inclusão do compiler, não execução ou leitura pelo modelo. Metadata mais completa/ranking fica no manifesto autorizado, sem corpo bruto; queryHash não publica a consulta textual. DTO não retorna selected/considered/corpos/cache/paths físicos. Omissões com motivos estão em compilationDecisions e histórico existente. Não se inventou medição de latência/economia de tokens.

## 22. Implementação arquivo por arquivo

| Família/caminho canônico | Antes → mudança; razão e consumidor | Compatibilidade/risco |
|---|---|---|
| knowledge-lexical.js/.d.ts | Novo motor puro extraído do CLI, com tipos e chunker estrutural. | CLI/Core compartilham fórmula; JS asset deve acompanhar runtime. |
| knowledge-lexical-loader.ts | Novo resolver de asset sibling dist ou src aprovado. | Padrão equivalente aos helpers Python; artefato dist sem src precisa copiar asset. |
| knowledge-retrieval.ts/.spec.ts | Novo contrato/ranking/cache/política/conversão/evidência e19 testes. | Sem provider/DB/FS de projeto; autoridade via callbacks host. |
| knowledge-host.ts/.spec.ts | Novo catálogo/flags/revalidação/wrapper e8 testes. | Owner/root/config atuais; corpus explícito, sem varredura. |
| context-builder.ts | Recebe política e compõe blocos opcionais/metadados. | Legacy null; obrigatório preservado; compiler autoridade de inclusão. |
| execution.service.ts | Propaga política capturada em preparation/worker/API/final/isolated. | Idempotência/revisão/coordinator/resultado preservados. |
| context-runtime.ts | Resumo seguro de recuperação no DTO. | Aditivo, sem configuração arbitrária/corpos. |
| tools/orbit/knowledge.mjs | Delega words/BM25 ao motor puro. | Cache/chunking/flags/locale do CLI mantidos. |
| tools/orbit/knowledge-lexical.test.mjs |8 testes novos do motor compartilhado. | Sem dados de produto. |
| tools/orbit/context-workers.test.mjs | Modo07A na fixture existente, catálogo e cenários específicos. | Baselines04/05/06 continuam separados; waits de pergunta são isolados na fixture. |
| tools/orbit/knowledge-retrieval-workers.test.mjs | Wrapper com env/HOME/bin fake explícitos. | Conta filhos separadamente; não Codex real. |
| Quatro prompt-sessions.ts | Inserções locais de policy/corpus/compiler e resume409. | Sem copiar DEV sobre variantes. |
| AGENTS/product-experience e4 orbit-architecture.ts | Regra persistente sincronizada. | IA executora recebe instrução vigente; não é conhecimento recuperado como instrução. |
| workspace/package e4 locks |7 mappings novos e releases selecionadas. | Fonte1.10.6 distinta de APIs. |
| Este relatório e projeções | Referência final + quatro cópias de cada fonte compartilhada. | Inventário individual em§27. |

Caminhos relativos da tabela são sob packages/orbit-core/src/execution salvo quando explicitado. Nenhum arquivo de UI foi alterado.

## 23. Testes R1–R24

| ID | Status/método/evidência | Limitação |
|---|---|---|
|R1|PASS motor/retriever repetem corpus/query/policy e ordem alterada.|Sem semântica ou runId como tie.|
|R2|PASS português/acentos/case NFD no motor.|Sem stemming/sinônimos.|
|R3|PASS documento relevante score positivo.|Lexical somente.|
|R4|PASS no_match score0.|Não infere relevância.|
|R5|PASS desempate por ID estável.|CLI mantém tie legado.|
|R6|PASS hashes/linhas/fences/posições.|Sem AST; oversized omite inteiro.|
|R7|PASS equivalentes dedup antes de scoring e na seleção.|Somente equivalência comprovada.|
|R8|PASS versões diferentes preservadas.|Não faz reconciliação de versões.|
|R9|PASS mutation invalida catálogo/cache/worker.|FS+SQL não são snapshot atômico.|
|R10|PASS remoção não retorna corpo anterior.|Fonte configurada ausente falha.|
|R11|PASS permission-denied não entra em count/result.|Autoridade owner/permissões atuais.|
|R12|PASS runtime/projeto/ator incompatíveis recusados.|Não adiciona membership novo.|
|R13|PASS workspace separado e scope mismatch recusado.|Projeto pode autorizar mesma doc para dois cards.|
|R14|PASS revogação revalida antes de cache/output.|Sem TTL de ACL.|
|R15|PASS query card/revisão/campos e binding.|Sem conversa inteira.|
|R16|PASS resultados deep-cloned e históricos preservados.|Sem reescrita do manifesto.|
|R17|PASS duas filas registram selected/source/metadata no manifesto.|DB fake de filas; SQL160 testado separado.|
|R18|PASS compiler inclui/omite optional; trust host_policy recusado.|Não aprova regra por score.|
|R19|PASS corpus não selecionado alterado bloqueia ambas filas antes do executor.|Sem reranking do run antigo.|
|R20|PASS fixture real de worktree nas duas filas verifica rawHash do checkout.|Não homologação operacional.|
|R21|PASS retries mantêm manifesto; flag habilitada depois não retrofita legado.|Política capturada é autoridade.|
|R22|PASS Core independente de IA/provider; secret/path/signal/limites testados.|Sem modelo externo.|
|R23|PASS Q&A compatível/childturn; changed corpus ou policy409 preserva oldturn.|Não manipula memória Codex real.|
|R24|PASS regressões dirigidas e controles operacionais§24/26.|Sem suite global nem MCP nativo.|

Comandos novos (a matriz não soma24 testes Node fictícios):
```sh
node --test tools/orbit/knowledge-lexical.test.mjs tools/orbit/knowledge.test.mjs
TSX_TSCONFIG_PATH=dev/app/apps/api/tsconfig.json node --import ./dev/app/node_modules/tsx/dist/loader.mjs --test dev/app/apps/api/src/execution/knowledge-retrieval.spec.ts dev/app/apps/api/src/execution/knowledge-host.spec.ts
node --test tools/orbit/knowledge-retrieval-workers.test.mjs
```

Testados também documentação pequena/média, títulos/fences, documento malicioso como dado, fonte configurada ausente, query vazia/sem resultado, paths/globs/symlinks/sensíveis, cache antigo, mudança de hostpolicy e interrupção. Logs locais em /tmp/orbit07a-audit.

## 24. Testes de regressão

**389 testes distintos PASS,0 falhas finais,0 cancelados,0 skipped.** Wrappers e cenários filhos são separados; a matriz R1–R24 não é contagem de testes adicionais. Reexecuções/suites focadas sobrepostas não são somadas.

| Suite/log em /tmp/orbit07a-audit | PASS |
|---|---:|
|unit-final|191|
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
|lexical-cli|22|
|mcp-process|1|
|chain-final|4|
|knowledge-workers-final|1|
| Compiler cenários filhos |17|
| Bridge cenários filhos |12|
| Recuperação07A cenários filhos |15|

Os191 unitários incluem os164 da06C mais27 de recuperação/catálogo (19retriever+8host). Os22 lexical/CLI são8novos+14legados. A fixture07A usa serviços reais das duas filas e15 cenários Node reportados; idempotência, fonte/corpus alterado, Q&A, policy409, DTO e worktree real são exercitados com DB/quota/provider fake. PG160/207/revisões/coordinator usam bancos descartáveis separados. Nenhum teste Codex nativo/operacional foi executado.

Quatro APIs TypeScript passaram na versão final. Logs tsc-<runtime>-final.log e exit0 conferidos. Não foi recompilada UI/navegador nem rerodado prompt-question isolado: arquivos UI/provider não foram alterados; as filas e variantes API foram exercitadas no alcance descrito.

Ambiente/ordem e lista integral unitária em /tmp/orbit07a-audit/validate.py. Suites dirigidas herdadas:
```sh
node --test tools/orbit/context-workers.test.mjs
node --test tools/orbit/context-compiler-workers.test.mjs tools/orbit/context-compiler-provider.test.mjs
node --test tools/orbit/context-bridge-workers.test.mjs tools/orbit/context-bridge-adapter.test.mjs tools/orbit/context-bridge-provider.test.mjs
node --test tools/orbit/context-bridge.postgres.test.mjs tools/orbit/context-manifests.postgres.test.mjs
node --test tools/orbit/isolated-checkout.test.mjs tools/orbit/isolated-provider.test.mjs tools/orbit/isolated-workers.test.mjs
node --test tools/orbit/shared.test.mjs tools/orbit/preflight.test.mjs tools/orbit/catalog.test.mjs tools/orbit/registry-foundation.test.mjs tools/orbit/card-revision-ui.test.mjs tools/orbit/card-version-enqueue.test.mjs tools/orbit/card-revisions.postgres.test.mjs tools/orbit/workspace-coordinator.postgres.test.mjs tools/orbit/workspace-workers.test.mjs
node --test tools/orbit/context-bridge-mcp.test.mjs tools/orbit/context-bridge-mcp-supervised.test.mjs
node <runtime>/app/node_modules/typescript/bin/tsc --noEmit --incremental false -p <runtime>/app/apps/api/tsconfig.json
```
Comandos agrupados acima enumeram famílias; PG/workers foram orquestrados em sequência pelos harnesses, sem suite global. TypeScript e checks puros foram paralelos independentes. Após ajuste final de invalidação por label, unitários/recuperação/TypeScript foram repetidos; regressões sem interface alterada não foram repetidas sem necessidade.

Falhas intermediárias corrigidas: fixture host não habilitava flag ao testar wrapper opt-in; narrowing de contentHash após validação; fixture deixava pergunta incompatível em waiting_answer antes dos novos cenários. Revisão encontrou e fechou exclusão de secrets/.orbit/local e audit409 de policy na retomada. Revisão final fechou cache de tokens de label renomeado e fez deep-clone do resultado. Nenhuma política foi relaxada para verde.


## 25. Monorepo e projeções

Final Core1.10.6/220 mappings, integridade **ec098e19636091d9e2cb3e5db1d33b953500c17a5eda2cd9f985578780bc4ba1**. Releases oficiais selecionadas @orbit/core-source:1.10.0 introduziu capacidade;1.10.1 ajustou revalidação de política/fixture;1.10.2 corrigiu narrowing TypeScript;1.10.3 fechou diretórios sensíveis, observação409 e cache por checkout/dedup antes de score;1.10.4 fez deep-clone/queryId;1.10.5 explicitou categorias de trust e recusa host_policy;1.10.6 invalidou corretamente tokens de scoring quando o label lógico autorizado muda, incluindo identidade da fonte no corpusHash.

Planos/precondições/apply armazenados em /tmp/orbit07a-audit. Nenhum hash/lock foi editado manualmente, nenhum pacote UI foi sincronizado globalmente. UI1.1.3/74 e nove variantes históricas/18 findings BLOCK permanecem; gate global não é PASS. Core/projeções/locks são verificados na evidência final. Sem commit/push/tag ou substituição integral de produtos.

## 26. Segurança operacional

Ambientes de teste com arquivos/repos temporários próprios, HOME/CODEX_HOME/binário Codex inexistente/fake, allowlists de env, fake quota/provider e PG descartável quando usado. Nenhum Codex real (nem comandos offline nesta etapa), modelo/embedding/API paga, banco de produto, instalação vetorial ou MCP externo foi executado.

Nenhum .env/config global, serviço de produto, deploy/restart, migration real, Git mutável original ou limpeza de quarentena operacional. Git mutável somente nas fixtures; isolamento03A/03B continua responsável por ownership/drain/retirada de árvores temporárias.

Delegação limitada a motor puro, catálogo host e auditoria read-only, com escopos sem sobreposição; integrador compôs pipelines, reviu resultados e executou validação final. Não se apresentou projeção de economia como medição.

## 27. Inventário Git

Baseline3375 arquivos. Nesta etapa: **33 modificados,38 novos,0 removidos**. Inventário individual:

- AGENTS.md
- dev/app/apps/api/src/execution/context-builder.ts
- dev/app/apps/api/src/execution/context-runtime.ts
- dev/app/apps/api/src/execution/execution.service.ts
- dev/app/apps/api/src/execution/knowledge-host.spec.ts
- dev/app/apps/api/src/execution/knowledge-host.ts
- dev/app/apps/api/src/execution/knowledge-lexical-loader.ts
- dev/app/apps/api/src/execution/knowledge-lexical.d.ts
- dev/app/apps/api/src/execution/knowledge-lexical.js
- dev/app/apps/api/src/execution/knowledge-retrieval.spec.ts
- dev/app/apps/api/src/execution/knowledge-retrieval.ts
- dev/app/apps/api/src/orbit-architecture.ts
- dev/app/apps/api/src/plugins/ai/prompt-sessions.ts
- dev/app/orbit.shared-lock.json
- docs/implementacao-arquitetural/07A-RAG-LEXICAL-COMPARTILHADO-E-CONHECIMENTO-VERSIONADO.md
- docs/product-experience.md
- orbit.workspace.json
- packages/orbit-core/package.json
- packages/orbit-core/src/execution/context-builder.ts
- packages/orbit-core/src/execution/context-runtime.ts
- packages/orbit-core/src/execution/execution.service.ts
- packages/orbit-core/src/execution/knowledge-host.spec.ts
- packages/orbit-core/src/execution/knowledge-host.ts
- packages/orbit-core/src/execution/knowledge-lexical-loader.ts
- packages/orbit-core/src/execution/knowledge-lexical.d.ts
- packages/orbit-core/src/execution/knowledge-lexical.js
- packages/orbit-core/src/execution/knowledge-retrieval.spec.ts
- packages/orbit-core/src/execution/knowledge-retrieval.ts
- prod/app/apps/api/src/execution/context-builder.ts
- prod/app/apps/api/src/execution/context-runtime.ts
- prod/app/apps/api/src/execution/execution.service.ts
- prod/app/apps/api/src/execution/knowledge-host.spec.ts
- prod/app/apps/api/src/execution/knowledge-host.ts
- prod/app/apps/api/src/execution/knowledge-lexical-loader.ts
- prod/app/apps/api/src/execution/knowledge-lexical.d.ts
- prod/app/apps/api/src/execution/knowledge-lexical.js
- prod/app/apps/api/src/execution/knowledge-retrieval.spec.ts
- prod/app/apps/api/src/execution/knowledge-retrieval.ts
- prod/app/apps/api/src/orbit-architecture.ts
- prod/app/apps/api/src/plugins/ai/prompt-sessions.ts
- prod/app/orbit.shared-lock.json
- safdoulas/app/apps/api/src/execution/context-builder.ts
- safdoulas/app/apps/api/src/execution/context-runtime.ts
- safdoulas/app/apps/api/src/execution/execution.service.ts
- safdoulas/app/apps/api/src/execution/knowledge-host.spec.ts
- safdoulas/app/apps/api/src/execution/knowledge-host.ts
- safdoulas/app/apps/api/src/execution/knowledge-lexical-loader.ts
- safdoulas/app/apps/api/src/execution/knowledge-lexical.d.ts
- safdoulas/app/apps/api/src/execution/knowledge-lexical.js
- safdoulas/app/apps/api/src/execution/knowledge-retrieval.spec.ts
- safdoulas/app/apps/api/src/execution/knowledge-retrieval.ts
- safdoulas/app/apps/api/src/orbit-architecture.ts
- safdoulas/app/apps/api/src/plugins/ai/prompt-sessions.ts
- safdoulas/app/orbit.shared-lock.json
- suinda/app/apps/api/src/execution/context-builder.ts
- suinda/app/apps/api/src/execution/context-runtime.ts
- suinda/app/apps/api/src/execution/execution.service.ts
- suinda/app/apps/api/src/execution/knowledge-host.spec.ts
- suinda/app/apps/api/src/execution/knowledge-host.ts
- suinda/app/apps/api/src/execution/knowledge-lexical-loader.ts
- suinda/app/apps/api/src/execution/knowledge-lexical.d.ts
- suinda/app/apps/api/src/execution/knowledge-lexical.js
- suinda/app/apps/api/src/execution/knowledge-retrieval.spec.ts
- suinda/app/apps/api/src/execution/knowledge-retrieval.ts
- suinda/app/apps/api/src/orbit-architecture.ts
- suinda/app/apps/api/src/plugins/ai/prompt-sessions.ts
- suinda/app/orbit.shared-lock.json
- tools/orbit/context-workers.test.mjs
- tools/orbit/knowledge-lexical.test.mjs
- tools/orbit/knowledge-retrieval-workers.test.mjs
- tools/orbit/knowledge.mjs

Baseline/status/hashes em /tmp/orbit07a-audit. Não há remoção de arquivo preexistente. Migrations, broker/Bridge/MCP/UDS, providers nativos, supervisor/coordinator/checkout, consumidor vetorial de Suindá, docs anteriores e UI foram preservados por hash fora do escopo listado. main/HEAD permanecem; sem stage/commit/push/tag.

## 28. Limitações e riscos

1. Lexical BM25 não é RAG semântico nem prova de verdade/completude/dependências.
2. Catálogo inicial contém documentos .orbit e arquivos exatos; cards relacionados continuam na composição existente, sem índice lexical novo; não há decisões/agentes ingeridos automaticamente.
3. Projeto usa autorização owner_id existente. Ampliação para vários atores requer contrato real de acesso, não troca de actorId no retriever.
4. Cache em memória retém termos derivados privados e pode consumir memória até64 escopos; não é persistente/distribuído nem fonte da verdade.
5. Revalidação de todo corpus é necessária para atualidade; não promete eliminar custo de FS/DB. Não há benchmark de ganho.
6. Chunker não entende AST/regra semântica. Blocos grandes podem ser omitidos; corpus/maxchunks excedidos falham.
7. FS/DB/revisão/contexto não são transação única. Duas preparações/revalidação/hash reduzem races, sem sandbox universal.
8. Pontuações/contagens só são seguras no recurso autorizado; não criar endpoint público/sugestões a partir do cache.
9. Frontmatter/permissões/config controlam catálogo sob host; conteúdo recuperado continua dado não confiável.
10. Distribuição dist sem src precisa copiar knowledge-lexical.js como asset; resolver suporta layout atual dist/src. Não foi homologado bundle standalone sem fontes.
11. Não houve validação funcional de UI/produção ou chamadas externas; testes por marco são isolados.
12. MCP/Codex real continuam bloqueados pela06C; isso não impede a capacidade Core07A e não foi usado como fallback.
13. Política atual tem limites fixos host; não há ajuste livre por prompt/projeto nem API de pesquisa nova.

## 29. Pendências de ativação

Default ORBIT_KNOWLEDGE_RETRIEVAL_ENABLED ausente/0; só1 habilita. Context Compiler deve estar ligado e verificável; precondição falha impede executar modo solicitado. Não editar .env automaticamente.

Para homologação futura autorizada: revisar catálogo explícito por projeto, permissões de cada documento/arquivo e relevância real; verificar schema160 e políticas de retenção, sem migration nova07A; validar UI/API por perfis; testar orçamento/compiler com corpus real aprovado; definir proteção/retenção do cache/processo e asset JS no pacote de execução. Ativar separadamente por runtime com bancos isolados, somente após autorização.

Não é necessário nem autorizado desbloquear MCP/CLI para usar07A no Core. Flag1 não habilita embeddings ou recuperação vetorial.

## 30. Relação com Context Bridge

Nenhuma sexta ferramenta ou nova capability foi criada. As cinco ferramentas06B/06C, auditoria207, UDS e guards permanecem intactos. Recuperação07A é pré-contexto, não busca dinâmica.

Uma futura exposição pelo broker deverá vincular run/turno/manifesto/política de candidatos capturada, reautorizar fontes, reservar volume no orçamento Bridge, limitar resposta, registrar proveniência/auditoria e revogar com lease/binding. IDs/fingerprint do índice não autenticam. Resultados dinâmicos não reescrevem material do manifesto nem alteram significado de response_emitted/model usage. Não implementado antecipadamente.

## 31. Preparação da próxima implementação

| Capacidade futura | Ponto disponível e condição |
|---|---|
| Recuperação sob demanda | Retriever/catálogo versionados; falta contrato de query dinâmica autorizada. |
| Consulta lexical pelo Bridge | Orçamento/queries06 e evidência07A; definir capability futura sem contornar guard. |
| Memória de descobertas | Proveniência/fingerprints ajudam, mas falta retenção/aprovação/política; nada escrito por agentes. |
| Vetorial opcional | Consumer Suindá permanece isolado; integração global exige contrato/modelo/quota próprios. |
| Knowledge Reconciliation | Evidência de divergência disponível; nenhuma reconciliação/verdade automática implementada. |
| Project Consistency Engine | Projeto/corpus e versões podem ser insumos; ranking não é estado desejado. |
| Integration Gate | Sucesso/contexto/integração seguem separados; não há merge/aprovação automática. |
| Desired State Reconciler | Ausente; consulta não modifica intenção nem recursos. |

Nenhum desses componentes nem07B foi iniciado.

## 32. Handoff técnico

Entradas principais: knowledge-lexical.js/.d.ts, knowledge-retrieval.ts, knowledge-host.ts, context-builder.ts e collectContext dos quatro prompt-sessions. Política: orbit-lexical-retrieval/1; engine orbit-bm25-lexical/1; chunks orbit-structural-chunks/1.

Limites default:60candidatos,65536bytes/documento,1048576bytes/corpus,6000bytes/chunk,256chunks,6resultados,2/documento. Não são tokens reais. Consulta máximo65536bytes; campos title/description e termos explícitos opcionais limitados. Source IDs nunca são autorização.

Fluxo seguro: autorizar card/projeto→policycapturada→catálogo explícito→retriever authorize→revalidar corpus→knowledgeCompileInputs→compileContext→knowledgeRetrievalMetadata com decisões→manifesto→comparação antes de executar→receipt/final observation. Repetir preparação gera run novo; não atualizar registro antigo.

Flags host e configuração exemplo§7/29; controles por cartão não escolhem permissões/binários/cache nem habilitam modo. Consultas sem resultados são controladas; fonte ausente/mudada/sem hash/escopo/policy incompatível interrompe. Q&A policy409 conserva oldturn.

Comandos read-only: node tools/orbit/cli.mjs preflight --format json; node tools/orbit/cli.mjs shared check. Testes§23/24. Publicação nova sempre exige plano/precondições/atribuição explícita; não repetir release sem mudança. Nenhum comando autoriza Git/deploy/restart/migration/ativação.

## 33. Resultado final

**CONCLUÍDA em código e testes isolados da07A.**

| Dimensão | Estado |
|---|---|
| Código/contratos | Core compartilhado, BM25 reutilizado, catálogo autorizado e cache derivado. |
| Recuperação lexical | Testada; sem semântica/modelo/embeddings. |
| Contexto compilado | Integrado com fontes, decisões, corpus/seleção/hash e manifesto imutável. |
| Duas filas | Preparação/worker/delivery/final, idempotência, Q&A e checkout de fixture exercitados. |
| Banco descartável | Regressões160/207/revisões/coordinator; nenhuma tabela nova07A. |
| Distribuição | Core1.10.6/220 em quatro runtimes; UI histórica preservada. |
| Ativação/homologação operacional | Não executadas; exigem autorização futura. |
| MCP/Codex real | Continua BLOCKED conforme06C, fora do escopo07A. |

Não avançar automaticamente para07B.
