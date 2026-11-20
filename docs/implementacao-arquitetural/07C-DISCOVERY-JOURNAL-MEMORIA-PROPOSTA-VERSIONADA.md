# Implementação 07C — Discovery Journal: propostas versionadas de descobertas

Data: 2026-11-16. Implementação incremental e validação isolada; não constitui ativação operacional ou homologação do Codex nativo.

## 1. Resumo executivo

O Core recebe um DiscoveryJournal determinístico que captura envelopes explícitos de propostas, vincula a origem ao run/turno/revisão/manifesto fornecidos pelo host, observa referências autorizadas e persiste registros append-only. As duas filas usam seus próprios outputs; não há armazenamento paralelo da conversa, manifesto ou resultado integral.

A classificação inicial é sempre `proposed`, a verificação editorial `review_required` e a aprovação semântica `false`. Compatibilidade histórica, observação da evidência, persistência e resultado técnico são dimensões distintas. Não há ingestão no BM25, injeção em outros cards, aprovação, escrita MCP ou alteração de cards.

Resultado e contagens finais: **CONCLUÍDA no escopo de código e testes isolados:499 testes aprovados,0falhos/ignorados/cancelados nas rodadas finais**, quatro APIs TypeScript aprovadas. Distribuição de fontes: 1.12.4/230 mappings; APIs Core1.0.0/Plugin1 preservadas. A migration209 existe em arquivos e foi testada exclusivamente em PostgreSQL descartável. MCP/Codex nativo continua bloqueado. Flags operacionais não foram ativadas.

## 2. Base documental

Referências: sondagens00–20 em docs/sondagem-arquitetural e implementações01,02,03A,03B,04,05,06,06B,06C,07A e07B. As referências já examinadas nas etapas anteriores foram confrontadas nos pontos alterados; seus resultados históricos não são provas de implantação. A referência principal07B declara1.11.5/224,439 testes,208 em arquivos, cinco capacidades legadas e knowledge.search opcional. Esses contratos foram confirmados no código, workspace e baseline desta etapa.

Também consultados: AGENTS, skills orbit-environment e orbit-development do DEV, experiência de produto, aceleração, PluginDefinition/PluginRegistry, armazenamento de outputs, registries, coordenação, worktrees e publicação selecionada. A revisão focal de reutilização/risco encontra-se em /tmp/orbit07c-review.md; as decisões necessárias estão reproduzidas neste relatório.

## 3. Estado inicial

Branch `main`, HEAD `d9307b8e6a54316f802acbd7bcb96baa26116f16`, sem alteração de versionamento. A árvore já continha desenvolvimento não commitado01–07B e diferenças de produto. O baseline da07C é /tmp/orbit07c-audit/before.json, com3434 arquivos existentes, mais status-before.txt; inventário desta etapa compara esse snapshot, não o diff global contra HEAD.

Core fonte1.11.5,224 mappings, UI1.1.3/74, APIs Core1.0.0/Plugin1. Preflight inicial BLOCK:18 findings históricos correspondentes às nove variantes UI; nenhum drift Core ou lock pendente. Maior número global de migration208 confirmado antes de reservar209. Migrations157–160/207/208 e consumidor vetorial Suindá não foram alterados.

## 4. Arquitetura anterior

ExecutionResult genérico possui summary e outputs tipados; RunRepository.finish persiste card_runs.output/card_outputs. PromptSessions recebe output textual do provider e persiste pergunta ou resumo/output; Q&A mantém run e cria manifesto filho por turno, podendo sobrescrever o output atual. Não existe contrato anterior equivalente a um Journal de propostas imutáveis.

ContextManifestRepository04 conserva identidade, fontes, configuração, material, fingerprints, Git e checkout; Compiler05 distingue seleção/inclusão/entrega; Bridge06/07B é leitura autorizada com orçamento, auditoria e grants opcionais. Recuperação07A/B compartilha retriever/BM25/cache. Coordenador03A e manager03B protegem o workspace. O Journal reutiliza esses contratos e não os substitui.

## 5. Decisões técnicas

| Decisão | Motivo e limite |
|---|---|
| Componente Core determinístico | Funciona sem serviço/modelo IA; não importa classes concretas do plugin. |
| Envelope explícito, sem extração de fatos | JSON tipado valida categoria, limites e referências; linguagem natural não vira memória. |
| Captura protegida antes da finalização | Evidências observadas sob lease/root autorizado; erro vira receipt e não reclassifica resultado técnico. |
| Cabeçalho de captura + propostas limitadas | Evita copiar grandes outputs/manifestos; cada corpo é guardado uma vez. |
| Função SQL transacional + constraints | Atomicidade, concorrência, binding histórico e imutabilidade não dependem apenas de mock. |
| Revisão de ingestão por hash do envelope completo/projeto | Não existe classificador determinístico universal de PII; rejeita texto livre sem autorização de privacidade do host. |
| Consulta por run autorizado | Reutiliza autenticação/cardBoard/project owner e impede agregações globais ou acesso por UUID isolado. |
| Sem eventos de aprovação/retirada nesta etapa | Não é necessário alterar corpo/estado original; futura máquina de revisão terá contrato próprio. |

A alternativa de inserir captura no callback falível de RunRepository.finish foi descartada: propagaria falha do Journal à transação do resultado técnico. Também não se reutilizou o expurgo vetorial30dias como política universal de retenção.

## 6. Contratos do Discovery Journal

DiscoveryProposalEnvelope schema1:
```json
{"schemaVersion":1,"kind":"orbit.discovery.proposals","proposals":[{"category":"dependency_candidate","statement":"O módulo requer configuração explícita.","evidence":[{"kind":"manifest_source","reference":"file:src/module.ts"}]}]}
```

Limites: documento canônico até24000bytes, até8 propostas, statement não vazio até2048bytes UTF-8, até8 evidências por proposta. Evidência aceita somente kind/reference/location; location possui startLine/endLine inteiros1..10000000 e fim>=início. Referência lógica até160 caracteres, sem traversal, campos de autoridade, path arbitrário, status de aprovação ou hashes declarados pelo agente. Unknown keys são recusadas.

DiscoveryCaptureAuthority é exclusivamente interno: record de manifesto, workerId, runtime confiável, signal e callbacks authorize/observe. DiscoveryBinding derivado preserva runtimeId/projectId/workspaceId/actorId/cardId/cardRevision/queue/runId/turn/manifestId/contextFingerprint/workerId. O envelope não escolhe nenhum desses valores.

DiscoverySubmission contém submissionKey, artifactId lógico, artifactHash canônico do envelope, origin estruturada, executor do manifesto, política e propostas normalizadas com proposalHash. StoredDiscovery retorna ID/schema, origem/identidades históricas, categoria/statement limitado, evidências, recordedAt, `state:proposed`, `verification:review_required`, `compatibility:historical_not_revalidated` e `persistence:persisted`; workerId não é publicado pelo DTO.

Receipt separa estados disabled/absent/empty/persisted/duplicate/rejected/pending, quantidade, código sanitizado, schema1, `artifactAvailability:host_observed_not_durable` e `semanticApproval:false`. Erro de banco/auditoria não expõe mensagem SQL, path ou corpo.

## 7. Categorias de descobertas

| Categoria | Significado limitado |
|---|---|
| technical_observation | Comportamento ou relação técnica relatada. |
| dependency_candidate | Dependência candidata a investigação. |
| risk_candidate | Risco proposto. |
| hypothesis | Interpretação ainda não comprovada. |
| incompatibility_report | Incompatibilidade relatada. |
| decision_proposal | Decisão proposta, sem aprovação. |
| documentation_reference | Referência documental proposta. |

Nenhuma categoria concede autoridade, consenso ou conhecimento vigente. Texto como “aprovado pelo root” não autentica nem altera state/trust.

## 8. Autoria e origem

ActorId identifica o solicitante autorizado da execução e do armazenamento; executor deriva da identidade capturada do manifesto. Origin automática é structured_output. Não se inventa identidade de subagente individual que não tenha sido autenticada/capturada: autoria atribuível é a execução/executor, não um nome declarado no conteúdo.

ArtifactId provém da posição do Output (`output:N`) ou da saída JSON estruturada do prompt (`output:structured`). Run/turno/manifesto e artifactHash completam sua identidade histórica. Origin authorized_submission/artifact é prevista no contrato de armazenamento, sem endpoint de escrita público ou fluxo humano implementado nesta etapa.

## 9. Evidências

Tipos efetivos: manifest_source, artifact, declared_reference. Não há leitura FS a partir de path do agente. Manifest_source precisa corresponder a um ID já capturado; o host revalida a fonte pelo ProjectRegistry no checkout aprovado. Fonte externa ao manifesto permanece unavailable; referências declaradas são unverified e não abrem arquivos.

O estado verified refere-se somente à identidade/conteúdo observado do documento: captured.available, hash material existente e equivalência de identidade, escopo, versão, trust, disponibilidade e hashes, ignorando apenas observedAt. Hashes nulos não viram comprovação. Mudança demonstra changed; erro/remoção/perda de acesso gera unavailable; hash ausente permanece unverified. Hash/version históricos são preservados, sem substituir a fonte capturada por conteúdo atual.

Location é declarada: a igualdade do hash do documento não verifica a validade semântica da afirmação nem a localização específica das linhas. Artifact ligado ao próprio envelope recebe historical_reference e hash canônico observado; não se afirma persistência ou disponibilidade durável do output. Um artifact desconhecido fica unavailable.

Na consulta, todas as evidências são apresentadas como referência histórica, com recordedState separado e availability:not_revalidated. Não se tenta consultar índice lexical atual para falsificar história.

## 10. Captura estruturada

Fila genérica reconhece Output.type `orbit.discovery.proposals` e valida o seu value. Apenas um envelope por resultado; múltiplos envelopes explícitos são recusados para limitar a captura por run/turno. Saídas ordinárias permanecem válidas e não geram registros vazios.

Fila prompt reconhece somente um documento JSON inteiro com kind exato. Fences, prefixos, frases “descobri”, citações e respostas normais não são varridas ou extraídas como fatos. JSON válido mas envelope inválido gera recusa; texto sem envelope é ausência de propostas. Essa restrição é intencional e não altera o provider nativo para produzir formatos novos.

A ingestão exige revisão de privacidade do envelope completo, não só do statement. Sem autorização, retorna discovery_ingestion_review_required, preserva o resultado e não armazena o texto proposto. Não há retry automático infinito. Uma nova tentativa host-autorizada usa o mesmo contrato de idempotência; não existe API de retry público para agentes.

## 11. Integração com card_runs

preparedContextManifest captura discoveryJournal no configuration somente quando a política host está habilitada para o projeto. Construções/revalidações seguintes preservam o grant capturado e detectam mudança da política; legado não ganha grant retroativo.

Após executor, integrações, file scope/checks obrigatórios e observação final do contexto, captureExecutionDiscoveries roda sob lease antes de completedResult/finalização. O output original continua no caminho existente. Um Journal pending/rejected não lança falha técnica, não modifica summary/outputs nem aprova integração.

Receipt seguro fica em card_runs.metadata.discovery_capture com manifesto/turno. A gravação é condicional a worker/status running, tratada separadamente; falha gera diagnóstico sanitizado. Descoberta pode existir mesmo se a execução posteriormente falhar ou for cancelada: sua existência relata uma proposta capturada, não sucesso ou integração. A consulta mantém esse limite explícito.

## 12. Integração com card_ai_runs

promptConfiguration captura o mesmo profile, incluindo modo sem Compiler/IA lexical. Retomadas preservam manifesto pai e grant; um grant novo não é aplicado a um manifesto legado por alteração de flag. A captura usa output bruto estruturado antes da transformação de resumo e antes de sair do lease.

O projeto é remapeado ao checkout aprovado em worktree; não se lê evidência do projeto original como fallback. CardBoard é revalidado pelo callback, além dos checks DB/ProjectRegistry. Exceptions locais de preparação/captura são contidas; finalização técnica/Q&A/quota/session/multiagent permanecem nos caminhos existentes.

A pergunta ordinária não é envelope e produz absent. Resposta estruturada em novo turno gera nova submissão vinculada ao manifesto filho. Não há reatribuição retroativa. O campo discovery_capture da209 guarda somente o receipt observável do último turno; propostas históricas e seus turnos ficam no Journal. SessionId/conversa completa não são duplicados.

## 13. Persistência

Migration nova209_discovery_journal.sql, aditiva, sem modificar157–160/207/208. Tabelas discovery_journal_captures e discovery_journal_entries guardam cabeçalho e propostas individuais. A captura referencia manifesto160; o cabeçalho submission exclui proposals para não duplicar corpos. Propostas possuem schema/categoria/hash/estado/revisão e timestamp imutáveis.

A função orbit_discovery_capture verifica schema/hash canônico da submissão, usa advisory transaction lock por runtime/fila/run/turno/chave e faz a batch em uma transação. Trigger confere manifesto/runtime/projeto/workspace/ator/card/revisão/run/turno/fingerprint, latestturn, execução running/worker/cancel e revisão atual do card. A ordem é runFORUPDATE → mesmo pg_advisory_xact_lock(hashtext(context-manifest:queue:runId)) do writerCore → verificação do latestturn. O teste PG de corrida segura a continuação em outra transação e prova recusa do pai após commit do filho; escritores externos que ignorem a autoridade Core continuam fora da garantia. Constraints diferidas verificam quantidade, completude e hash final, barrando inserts diretos parciais.

UPDATE/DELETE/TRUNCATE das tabelas são barrados por guards imutáveis existentes; não se alega resistência contra administrador que pode desativar triggers/alterar o schema. A função e o repository são componentes internos, não substituem autorização de usuário do host nem constituem RLS universal.

A209 acrescenta card_ai_runs.discovery_capture JSONB com default{}, objeto limitado a2000bytes para último receipt. Esse campo de observabilidade não é o corpo histórico de uma descoberta e pode ser atualizado por novo turno. Nenhum schema foi aplicado em banco de produto.

## 14. Versionamento

Schema de envelope, política e registros =1. Chave de submissão inclui fila/run/turno/manifesto/artifactId/schema; artifactHash identifica envelope canônico, não output completo nem prova de armazenamento externo. Cada proposta tem hash canônico de categoria/statement/evidência normalizada; sem deduplicação semântica.

Reenvio idêntico retorna duplicate; mesma chave e conteúdo divergente é conflito e não altera original. Novo run, turno, revisão/manifesto ou posição forma outra identidade. Revisões não são incrementadas manualmente. Estado observado da evidência faz parte do hash da proposta: retry após mudança comprovada da fonte pode conflitar, em vez de sobrescrever sua observação histórica.

O SQL permite retornar um registro idêntico já existente mesmo se o run agora for terminal; isso não cria escrita nova e não dispensa autorização host. A captura automática exige running antes de chegar à função; não há callback tardio de agente autorizado a inserir após cancelamento/terminal.

## 15. Segurança e privacidade

Opt-in exige ORBIT_DISCOVERY_JOURNAL_ENABLED=1, ORBIT_DISCOVERY_JOURNAL_TEXT_POLICY=review_required e projeto explicitamente listado em ORBIT_DISCOVERY_JOURNAL_PROJECTS. A política fica no manifesto. Para ingerir texto livre exige também um par projectUUID:SHA256(envelope canônico) em ORBIT_DISCOVERY_JOURNAL_REVIEWED_ENVELOPES, com até256 entradas de formato limitado. A revisão se aplica a corpo e referências; é autorização de privacidade/ingestão, nunca aprovação semântica.

Filtros containsSecretText, controles, padrões evidentes de PII/paths e referências reservadas rejeitam conteúdo óbvio mesmo com hash autorizado. Eles são filtros limitados, não classificação universal. Sem revisão segura comprovável a ingestão é recusada; não se cria regra automática que declare PII removida. Esse requisito impede prometer captura arbitrária de texto livre sem intervenção/configuração confiável. Uma extensão futura com templates host fixos pode reduzir revisão por proposta, sem inventar classificador.

Retenção policy explicit_admin_policy: sem expurgo destrutivo automático, sem reutilizar o job vetorial do Suindá, sem garantia de criptografia específica nova. Produtos/projetos precisam definir retenção/expurgo e controles de backup antes de ativar. Limites de quantidade/tamanho são aplicados em JS e SQL. Nem outputs existentes nem logs históricos passam a ser globalmente seguros por causa do Journal.

## 16. Consulta autorizada

GET `/execution/discoveries/:queue/:id` é uma extensão localizada de CardExecutionController. Queue somente card_runs/card_ai_runs; UUID não autentica. CardExecutionService valida usuário atual, run.user_id, cardBoard/cofre, projeto pelo owner existente, runtime/project/card/workspace/actor do manifesto.

Filtros permitidos: category, limit1..100, offset0..10000; campos desconhecidos são recusados. O run da rota e seu card são filtros obrigatórios internos, sem busca global. Repository reaplica todos os predicados de scope, incluindo cardId. Sem grant capturado retorna disabled_or_legacy e não consulta209.

Os corpos só são devolvidos se a autorização de ingestão por hash/projeto ainda estiver presente; fora disso statement=null e indicação de revisão pendente. Não há acesso a conteúdo restrito de fonte por meio do texto da evidência. Os registros têm stateproposed, semanticApprovalfalse, compatibilityhistorical_not_revalidated. Contagens por categoria são exclusivamente da página retornada; hasMore significa página cheia, não prova uma contagem global ou outra página existente. GET não altera descobertas nem dispara leitura arbitrária de arquivos.

## 17. Isolamento entre projetos

Runtime vem de orbitContextRuntime do host; não é argumento do envelope. Projeto/banco/ator/workspace vêm do run e manifesto capturados, e as consultas não aceitam troca de escopo pelo agente. ProjectRegistry verifica owner e root autorizado; membership/cardBoard é revalidado na captura e leitura. Root do projeto é fixado fisicamente e checado antes/depois da observação.

Worktree exige currentIsolatedExecution correto, lease ALS vigente/cobertura e bindActiveIsolatedCheckout do manager03B; verifica identidade/run/pin/owner físico e ledger. Não usa checkout original para ler evidência. O helper não é sandbox universal e não concede autoridade standalone. SQL reforça relações, mas não tenta transformar workspaceId/workerId/runId em credenciais.

## 18. Relação com ContextManifest

Guarda referência manifesto/fingerprint/turno/revisão; não replica o manifesto, Compiler, receipts de material, corpus ou checkout completos. Esses dados continuam consultáveis pelo contrato04 no escopo autorizado. A proposta é evidência posterior à preparação, sem mutar manifest.sources, materialHash ou corpus.

O estado de revisão é independente da compatibilidade. A captura pode registrar fonte changed/unavailable como proposta não comprovada; a consulta não afirma vigência. Comparações de hash não provam que afirmação é correta ou que o modelo usou a fonte. Saída bem-sucedida não prova integração ao projeto.

## 19. Relação com RAG07A/07B

Nenhuma alteração no motor BM25, tokenização/chunking/ranking/cache, CLI lexical ou catálogo capturado. O Journal não é fonte automática de ProjectKnowledgeRetriever/ContextCompiler, nem amplia corpus antigo ou memória de outros cards. Busca e persistência de proposta têm autoridades diferentes.

Uma etapa posterior poderá avaliar/propor promoção versionada com revisão e política próprias. Esta implementação não reconcilia semanticamente, não adota afirmações repetidas como consenso e não gera embeddings.

## 20. Relação com Bridge/MCP

Bridge permanece read-only; catálogo legado de cinco ferramentas e knowledge.search opcional não mudaram. Não há ferramenta de escrita, leitura automática do Journal por MCP, novo registry, endpoint público de submissão ou relaxamento de sandbox/UDS.

CodexExecutor/CodexAiService mantêm guards da06C. Futuras consultas/submissões MCP exigirão capabilities e autorização específicas; o transporte simulado não é homologação nativa.

## 21. Plugins

Journal reside no Core e não depende da ativação do plugin ai. Um executor autorizado genérico pode fornecer envelope sem modelo. O plugin IA só fornece output explícito; não aprova propostas, não define escopo nem substitui identidade host. PluginRegistry, PluginDefinition, dependências, actions, RBAC e APIs preservados. Consumidor vetorial Suindá e suas configurações não foram alterados.

As novas instruções persistentes de propostas/privacidade/histórico foram sincronizadas em AGENTS, docs/product-experience e orbitArchitecturePrompt dos quatro runtimes. O painel Codex/cartões recebe a mesma regra; documentos recuperados não viram instrução privilegiada.

## 22. Observabilidade

Receipts distinguem captura, persistência e resultado técnico. Persisted/duplicate contam a batch retornada; rejected possui motivo seguro (inclusive conflito/revisão de ingestão/schema/segredo); pending aponta persistência/autoridade não comprovável sem inventar sucesso. Absent/empty não fabricam registros.

Genérico guarda metadata.discovery_capture; prompt guarda discovery_capture da209 e emite progresso sanitizado. A consulta autorizada inclui latestCapture com receipt do último turno, schema/estado/contagem/código estritamente projetados; não é histórico global nem substitui as batches imutáveis. Se também falhar a gravação do receipt, há diagnóstico sanitizado e não se declara confirmação durável; interrupção de DB não pode garantir auditoria em DB indisponível. Não há retry infinito nem mensagem de erro contendo corpo/path/SQL.

Consulta retorna contagens de categoria restritas à página e estados de evidências históricos. Não há métrica global de qualidade, consenso, verdade, custo/modelo ou canal MCP ativo.

## 23. Implementação arquivo por arquivo

| Arquivo/família | Alteração, finalidade e consumidor | Compatibilidade e risco |
|---|---|---|
| packages/orbit-core/src/execution/discovery-journal.ts | Schema, política, validação, hashes, envelope, DiscoveryJournal e receipts; usado pelos hosts das duas filas. | Core puro, sem provider/FS; free-text sem revisão recusado; estado proposto. |
| packages/orbit-core/src/execution/discovery-journal.spec.ts |23 testes diretos de schema/autoria/evidência/privacidade/turnos/legado. | Fake store não prova constraints SQL. |
| packages/orbit-core/src/execution/discovery-journal-host.ts | Reautorização, lease/root/manager, captura/receipt e DTO seguro de consulta. | Sem fallback de checkout; erros contidos; evidência sempre histórica no GET. |
| packages/orbit-core/src/execution/discovery-journal-repository.ts | Captura SQL atômica, tipagem e leitura com scope completo. | Sem autenticação standalone; hash não comprova verdade; não publica workerId. |
| packages/orbit-core/src/execution/discovery-journal-repository.spec.ts |5 testes de fronteira/schema/binding/query/erros. | Complementados por PG real descartável. |
| packages/orbit-core/sql/migrations/209_discovery_journal.sql | Captures/entries, função canônica/atômica, triggers/constraints/locks e receipt prompt. | Aditiva;13 testes PG; sem aplicação real; revisão de turno serializada com Core. |
| packages/orbit-core/src/execution/execution.service.ts | Captura profile em manifesto, hook protegido e discoveryDetail. | Resultado técnico e revisão não são reclassificados por falha Journal; card/project/RBAC existentes. |
| packages/orbit-core/src/execution/execution.controller.ts | GET restrito discoveries por queue/run. | Nenhuma escrita pública ou MCP; filtros limitados. |
| dev/prod/safdoulas/suinda/app/apps/api/src/plugins/ai/prompt-sessions.ts | Profile capturado, captura local sob lease, progresso seguro e isolamento de exceções. | Alterações localizadas preservam variantes; Q&A/quota/session/resultado permanecem próprios. |
| AGENTS.md,docs/product-experience.md e quatro orbit-architecture.ts | Regra07C consistente em IDE/painel/cartões. | Recuperação não vira instrução privilegiada; default off. |
| tools/orbit/context-workers.test.mjs | Modo07C, fake SQL e8 cenários novos integrados; modos anteriores preservados. | Efeito só fixture, sem produto/Codex; Q&A cleanup restrito ao modo novo. |
| tools/orbit/discovery-journal-workers.test.mjs | Wrapper ambiente allowlist;18 filhos. | Não é prova SQL; conta wrapper e filhos separadamente. |
| tools/orbit/discovery-journal.postgres.test.mjs | PG16 próprio Unix-only,13 testes com concorrência/turnos/atomicidade/immutabilidade. | Prova data_directory/owner/marker antes DDL; não usa produto; precisa execução serial com suites de markers. |
| orbit.workspace.json,packages/orbit-core/package.json e4 orbit.shared-lock.json |6 mappings novos/release selecionada por ferramenta. | API/Pluginversion intactas; hashes não editados manualmente; UI não sincronizada. |
| Quatro projeções por fonte nova/modificada e este relatório | Distribuição gerada + documentação revisável. | Arquivos individuais e contagem constam§28; fontes canônicas mandam. |

## 24. Testes J1–J26

| ID / critério | Estado | Arquivos/comando/evidência | Resultado real | Limitação |
|---|---|---|---|---|
| J1 Schema | PASS | unit-final.log / comando U | Envelope1 e7categorias aceitos;23unitários cobrem contrato. | Não aprova conteúdo. |
| J2 Estrutura inválida | PASS | unit-final.log / comando U;journal-workers.log / comando W | Unknownkeys,category/bytes/count/location recusados. | Parser só JSON inteiro. |
| J3 Autoria | PASS | unit-final.log / comando U | Envelope não fornece runtime/ator/approved_by; binding host derivado. | Identidade de subagente não inventada. |
| J4 Proveniência | PASS | unit-final.log / comando U;journal-postgres.log / comando P;journal-workers.log / comando W | Run/card/rev/manifest/turn vinculados e mismatch recusado. | Hash não autentica usuário. |
| J5 Evidência válida | PASS | unit-final.log / comando U;journal-workers.log / comando W | Fonte capturada com identidade/hash compatíveis observada. | Verified refere-se a documento, não linhas/semântica. |
| J6 Evidência ausente | PASS | unit-final.log / comando U | Missing/null/declared/artifact desconhecido não fabricam prova. | Refs não abrem FS arbitrário. |
| J7 Estado inicial | PASS | unit-final.log / comando U;journal-postgres.log / comando P | Proposed/review_required e mutationapproved recusada. | Sem workflow de aprovação. |
| J8 Idempotência | PASS | unit-final.log / comando U;journal-postgres.log / comando P | Retry exato e duas submissões concorrentes geram um registro. | Sem dedupe semântico. |
| J9 Conflito | PASS | unit-final.log / comando U;journal-postgres.log / comando P | Mesmo identificador/conteúdo diferente mantém original. | Observação nova pode conflitar, não sobrescrever. |
| J10 Nova revisão | PASS | unit-final.log / comando U;journal-postgres.log / comando P | Nova identidade/revisão preserva anterior; currentrev mismatch recusa. | Cardrevision não fingerprint completo. |
| J11 Novo turno | PASS | unit-final.log / comando U;journal-workers.log / comando W;journal-postgres.log / comando P | Q&A filho distinto e corrida real latestturn recusando antigo. | Não injeta proposta pai como memória. |
| J12 Cancelamento | PASS | unit-final.log / comando U;journal-postgres.log / comando P | Abort/ownership/cancel/terminal negam inserção tardia. | Retry histórico SQL idêntico não cria escrita e exige authhost. |
| J13 Resultado técnico | PASS | unit-final.log / comando U;journal-workers.log / comando W;journal-postgres.log / comando P | Storefail preserva success/output; falha parcial SQL faz rollback e retry. | DB indisponível pode impedir receipt durável. |
| J14 Captura ausente | PASS | unit-final.log / comando U;journal-workers.log / comando W | Naturaltext/empty/no-output não criam registro. | Sem extração por LLM. |
| J15 Isolamento | PASS | unit-final.log / comando U;journal-postgres.log / comando P;journal-workers.log / comando W | Mismatches runtime/project/workspace/actor/run/card recusados/filtrados. | Escopo de projeto segue owner existente. |
| J16 RBAC | PASS | unit-final.log / comando U;journal-workers.log / comando W;journal-postgres.log / comando P | Wrongactor/cardBoard/projectowner e scopes impedem consulta/gravação. | SQL interno não substitui autorização host. |
| J17 Conteúdo sensível | PASS | unit-final.log / comando U;journal-workers.log / comando W | Segredos/PII óbvios/pathreservado/hashreview ausente/symlink externo recusados ou unavailable. | Review do envelope inteiro necessário; não regex universal. |
| J18 Retenção/limites | PASS | unit-final.log / comando U;journal-postgres.log / comando P | Caps JS/SQL e policyexplicit_admin_policy preservados. | Nenhum expurgo real ou política de prazo universal inventada. |
| J19 Imutabilidade | PASS | unit-final.log / comando U;journal-postgres.log / comando P | Manifesto intacto; UPDATE/DELETE/TRUNCATE e headerparcial recusados. | Administrador privilegiado fora da garantia. |
| J20 Consulta | PASS | journal-workers.log / comando W;journal-postgres.log / comando P | Endpoint real com limite/offset/categoria/scope, wrongactor e filtros inválidos. | Counts somente página; metadata não prova corpoatual. |
| J21 Contexto alterado | PASS | unit-final.log / comando U;journal-workers.log / comando W | Version/hash/scope/trust/null/changedfile e symlink não viram verifiedatual. | API reclassifica como histórico sem resolver fonte nova. |
| J22 card_runs | PASS | journal-workers.log / comando W | Serviço real + executor fake persiste proposta e receipt. | DBfake não provaSQL;PG separado. |
| J23 card_ai_runs | PASS | journal-workers.log / comando W | Prompt real + provider fake, pergunta/answer e turnos preservados. | Não executa Codex nativo. |
| J24 Worktree | PASS | journal-workers.log / comando W | Manager03B real nas duas filas, roots aprovados, hashes e symlinkexterno. | Core/in-process; não sandbox MCP universal. |
| J25 Plugins | PASS | unit-final.log / comando U;journal-workers.log / comando W | Contrato puro sem IA; executor genérico autorizado produz envelope. | Não autoriza provider/ação de plugin desligado. |
| J26 Regressão/segurança | PASS | §25 | Bateria dirigida01–07B e cadeias sintéticas aprovadas. | Operação real/Codex nativo não executados. |


U: `node --import ./forge/app/node_modules/tsx/dist/loader.mjs --test forge/app/apps/api/src/execution/discovery-journal.spec.ts forge/app/apps/api/src/execution/discovery-journal-repository.spec.ts` (incluídos na bateria unit247).
W: `node --test tools/orbit/discovery-journal-workers.test.mjs`; fixture real `tools/orbit/context-workers.test.mjs`, sem DB/provider reais.
P: `node --test tools/orbit/discovery-journal.postgres.test.mjs`, PG16 temporário próprio;13 testes agregados pelo runner.
Todos executados com ambiente allowlist descrito§25; Node24.20.0, dependências locais existentes e caminho TSX_TSCONFIG_PATH absoluto do DEV. Logs finais locais em /tmp/orbit07c-audit.

J1–J26 são critérios transversais, não26 testes extras. Mock de SQL não foi contado como prova de constraints; PG descartável é listado separadamente. Wrappers e filhos são separados para evitar duplicação.

## 25. Regressões

| Suíte (log local homônimo) | Testes agregados pelo runner | Resultado |
|---|---:|---|
| unit-final | 247 | PASS |
| bridge-workers | 1 | PASS |
| bridge-adapter | 1 | PASS |
| bridge-provider | 1 | PASS |
| bridge-postgres | 9 | PASS |
| context-workers | 10 | PASS |
| context-compiler-workers | 1 | PASS |
| context-compiler-provider | 1 | PASS |
| regressions | 75 | PASS |
| context-postgres | 10 | PASS |
| isolation-regressions | 18 | PASS |
| lexical-cli | 22 | PASS |
| mcp-process | 1 | PASS |
| chain-final | 6 | PASS |
| knowledge-workers | 1 | PASS |
| dynamic-workers | 1 | PASS |
| journal-postgres | 13 | PASS |
| journal-workers | 1 | PASS |

Total das contagens Node nas suítes de topo:419. Somam-se80 filhos de subprocessos que os wrappers informam separadamente: Bridge12,Compiler17,Knowledge07A15,Dynamic07B18,Journal07C18. Total **499 testes distintos aprovados**,0falhos/cancelados/ignorados nos runs finais. A contagem incluiu wrappers de orquestração explicitamente; não soma novamente labelsJ/D/R nem reexecuções. Mesmos cenários em modos legados/opt-in têm configuração/binding diferentes e são informados como variantes. A07B tinha439; os60 adicionais desta etapa são28 unitários (23Journal+5repository),13PG209 e19(wrapper+18filhos) no modo07C.

Quatro APIs TypeScript:PASS. `git diff --check` e sintaxe dos novos testes:PASS. Preflight global:**BLOCK**, mesmos18findings de9variantes UI históricas, não gate globalaprovado. MCP/Codexnativo:**BLOCKED** conforme06C; não conta como teste executado. Ativação operacional/migrations reais/browser:**NOT_RUN** por escopo.

Execuções intermediárias e correções: detector inicial deixou passar file:.env por delimitador lógico ':' (corrigido, teste de recusa passou); TypeScript não estreitou campos unknown após helperarrownever (helperdeclaration corrigiu sem mudar schema); fixture07C herdou waiting_answer antigo e bloqueou novos prompts (cleanup só modoJournal, mantendo assert original); PostgreSQL inicial corrigiu outputparameter position reservado/fixturechild incorreta. Duas tentativas PG falharam somente na asserção de baselineglobalmarkers porque outros harnesses próprios ainda criavam/removiam markers; os guards foram preservados e nada foi apagado. A rodada final completa foi serial e passou. Os logs iniciais /tmp/orbit07c-audit/validation-initial-run.log e bridge-postgres-initial.log, /tmp/orbit07c-journal-workers-initial.log, /tmp/orbit07c-discovery-unit.log e /tmp/orbit07c-repository-pg-final.log preservam essas evidências. Nenhum desses fracassos é apresentado como homologação.

Ambiente de reprodução: criar HOME/CODEX_HOME temporários sem autenticação; CODEX_BIN aponta executável inexistente; PATH=/usr/bin:/bin; TSX_DISABLE_CACHE=1; TSX_TSCONFIG_PATH absoluto forge/app/apps/api/tsconfig.json; ORBIT_CONTEXT_COMPILER_ENABLED=0,ORBIT_CONTEXT_BRIDGE_ENABLED=0 no processo pai; wrappers opt-in fornecem suas flags próprias. Não herdar DATABASE_URL,PG*,OPENAI*,CODEX* ou credenciais. Git de fixture: GIT_CONFIG_NOSYSTEM=1,GIT_CONFIG_GLOBAL=/dev/null,core.hooksPath=/dev/null,core.fsmonitor=false e template temporário. PG16 sem TCP, socket privado,data_directory/owner/listener/marker verificados antes DDL. Suites que conferem markersglobais devem rodar em sequência, nunca simultâneas a workers de workspace. Não repetir esses comandos em banco/serviço de produto.

Lista exata da bateria unitária, prefixo forge/app/apps/api/src/, passada a Node com loader tsx:
```text
execution/discovery-journal.spec.ts
execution/discovery-journal-repository.spec.ts
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

Suites adicionais executadas com `node --test`, em sequência:
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
tools/orbit/knowledge-lexical.test.mjs
tools/orbit/knowledge.test.mjs
tools/orbit/context-bridge-mcp.test.mjs
tools/orbit/context-bridge-mcp-supervised.test.mjs
tools/orbit/knowledge-retrieval-workers.test.mjs
tools/orbit/knowledge-bridge-workers.test.mjs
tools/orbit/discovery-journal.postgres.test.mjs
tools/orbit/discovery-journal-workers.test.mjs
```
TypeScript por runtime, cwd `<runtime>/app/apps/api`: `node ../../node_modules/typescript/bin/tsc --noEmit --pretty false`. Logs/JSON de execução em /tmp/orbit07c-audit são evidência local temporária, não prometida como storage durável.


## 26. Monorepo

Core fonte final **1.12.4**,230mappings, integridade SHA-256 `e65252acc4ea7244f631ff8ea04a9290fbf77b19e840a36333db5e88b894dfc2`. As920 projeções Core coincidem byte/hash com canônico e lock; locks sem pendência. UI1.1.3/74 e296 projeções preservam exatamente hashes/classificações do baseline;9variantes/18findings históricos continuam BLOCK. sharedcheckglobalnãoPASS por essas variantes, não por drift novo do Core.

Releases selecionadas:1.12.0 feature e6mappings;1.12.1 estreitamento de tipos sem relaxar validação;1.12.2 snapshot da autoridade e evidência sem hash como unverified;1.12.3 consulta segura do receipt;1.12.4 serialização latestturn com writerCore. Planos e applies em /tmp/orbit07c-audit/plan*.json/release*.json. Mappings registrados nos manifests workspace/pacote; versões/hashes/projeções produzidos por shared reconcile selecionado, sem edição manual de hashes ou sincronização UI global.

Cada runtime mantém seus arquivos locais de prompt-session e sua identidade orbitContextRuntime. Não foi copiado DEV integralmente sobre os produtos. Distribuição em arquivos não significa commit/push/deploy/ativação ou compatibilidade operacional homologada.

## 27. Segurança operacional

Somente arquivos/outputs temporários, fake quotas/providers/executores, HOME/CODEX_HOME sintéticos e binários CLI inexistentes, Git de fixture e PostgreSQL próprio descartável. Harnesses foram revisados antes do uso; não se iniciou bootstrap da API nem job de retenção vetorial.

Nenhum Codex real, inferência paga, resumo/classificação por LLM, embedding, DB operacional, migration real, deploy/restart, Docker, alteração em .env/configglobalCodex, Git mutável original, commit/push/tag ou limpeza de worktree/quarentena operacional. Alterações negativas de fixtures são limitadas aos próprios diretórios temporários. Nenhuma autorização de Git/deploy é inferida da publicação de projeções.

## 28. Inventário Git

Snapshot pré07C:3434 arquivos regulares e1link Git preexistente (suinda/SUINDA.md) verificado pelo blob do índice. Nesta etapa:**27 arquivos existentes modificados,33novos,0removidos**. Todos os outros arquivos regulares do baseline continuam com SHA-256 idêntico. O link não foi seguido para compor o baseline nem contado indevidamente como arquivo novo.

Modificados nesta etapa:
```text
AGENTS.md
forge/app/apps/api/src/execution/execution.controller.ts
forge/app/apps/api/src/execution/execution.service.ts
forge/app/apps/api/src/orbit-architecture.ts
forge/app/apps/api/src/plugins/ai/prompt-sessions.ts
forge/app/orbit.shared-lock.json
docs/product-experience.md
orbit.workspace.json
packages/orbit-core/package.json
packages/orbit-core/src/execution/execution.controller.ts
packages/orbit-core/src/execution/execution.service.ts
workspace/app/apps/api/src/execution/execution.controller.ts
workspace/app/apps/api/src/execution/execution.service.ts
workspace/app/apps/api/src/orbit-architecture.ts
workspace/app/apps/api/src/plugins/ai/prompt-sessions.ts
workspace/app/orbit.shared-lock.json
safdoulas/app/apps/api/src/execution/execution.controller.ts
safdoulas/app/apps/api/src/execution/execution.service.ts
safdoulas/app/apps/api/src/orbit-architecture.ts
safdoulas/app/apps/api/src/plugins/ai/prompt-sessions.ts
safdoulas/app/orbit.shared-lock.json
suinda/app/apps/api/src/execution/execution.controller.ts
suinda/app/apps/api/src/execution/execution.service.ts
suinda/app/apps/api/src/orbit-architecture.ts
suinda/app/apps/api/src/plugins/ai/prompt-sessions.ts
suinda/app/orbit.shared-lock.json
tools/orbit/context-workers.test.mjs
```

Novos nesta etapa:
```text
forge/app/apps/api/sql/migrations/209_discovery_journal.sql
forge/app/apps/api/src/execution/discovery-journal-host.ts
forge/app/apps/api/src/execution/discovery-journal-repository.spec.ts
forge/app/apps/api/src/execution/discovery-journal-repository.ts
forge/app/apps/api/src/execution/discovery-journal.spec.ts
forge/app/apps/api/src/execution/discovery-journal.ts
docs/implementacao-arquitetural/07C-DISCOVERY-JOURNAL-MEMORIA-PROPOSTA-VERSIONADA.md
packages/orbit-core/sql/migrations/209_discovery_journal.sql
packages/orbit-core/src/execution/discovery-journal-host.ts
packages/orbit-core/src/execution/discovery-journal-repository.spec.ts
packages/orbit-core/src/execution/discovery-journal-repository.ts
packages/orbit-core/src/execution/discovery-journal.spec.ts
packages/orbit-core/src/execution/discovery-journal.ts
workspace/app/apps/api/sql/migrations/209_discovery_journal.sql
workspace/app/apps/api/src/execution/discovery-journal-host.ts
workspace/app/apps/api/src/execution/discovery-journal-repository.spec.ts
workspace/app/apps/api/src/execution/discovery-journal-repository.ts
workspace/app/apps/api/src/execution/discovery-journal.spec.ts
workspace/app/apps/api/src/execution/discovery-journal.ts
safdoulas/app/apps/api/sql/migrations/209_discovery_journal.sql
safdoulas/app/apps/api/src/execution/discovery-journal-host.ts
safdoulas/app/apps/api/src/execution/discovery-journal-repository.spec.ts
safdoulas/app/apps/api/src/execution/discovery-journal-repository.ts
safdoulas/app/apps/api/src/execution/discovery-journal.spec.ts
safdoulas/app/apps/api/src/execution/discovery-journal.ts
suinda/app/apps/api/sql/migrations/209_discovery_journal.sql
suinda/app/apps/api/src/execution/discovery-journal-host.ts
suinda/app/apps/api/src/execution/discovery-journal-repository.spec.ts
suinda/app/apps/api/src/execution/discovery-journal-repository.ts
suinda/app/apps/api/src/execution/discovery-journal.spec.ts
suinda/app/apps/api/src/execution/discovery-journal.ts
tools/orbit/discovery-journal-workers.test.mjs
tools/orbit/discovery-journal.postgres.test.mjs
```

O status global já continha alterações01–07B; não atribuir todo diffcontraHEAD à07C. Engine/CLIlexical, manifestos/Compiler/Bridge/guards nativos, migrations157–160/207/208, coordenador/manager, consumidor vetorial, UI e relatórios anteriores permanecem por hash fora do escopo acima. Main/HEAD não mudaram; nenhum stage/commit/push/tag. Evidências de inventário/status em /tmp/orbit07c-audit.


## 29. Limitações e riscos

- A revisão do envelope é de ingestão/privacidade, não revisão editorial de verdade. Sem ela texto livre é recusado; não se promete segurança universal por regex.
- Propostas podem sobreviver a falha/cancelamento técnico posterior; não são prova de sucesso, integração ou aprovação.
- Identidade de executor/run é capturada; autoria individual de subagente não é inventada. ArtifactHash é canônico do envelope, não hash dos bytes de toda conversa/output.
- Q&A/outputs existentes podem ser transformados/sobrescritos/removidos. Referência e hash não garantem disponibilidade futura; não se duplicam outputs para contornar isso.
- A observação de FS/DB/ACL não é snapshot atômico global. Lease/manager/hashes/CAS reduzem races nos caminhos integrados, sem proteger contra todo escritor externo/administrador.
- Verified de documento não comprova linhas declaradas, afirmação, uso pelo modelo ou vigência posterior. Leitura API sempre rotula referência histórica.
- SQL protege integridade contra escrita normal; proprietário privilegiado pode alterar triggers/schema. Host ainda autoriza cada operação; não é RLS universal.
- Retenção/backup/expurgo de texto requer política explícita por produto/projeto. Não foi criado job destrutivo ou cifragem específica nova.
- Receipts finais são observabilidade corrente; batches históricas imutáveis não são workflow de aprovação/retirada. DB indisponível pode impedir confirmação da própria falha.
- Parser prompt exige JSON inteiro; não captura propostas embutidas em resposta natural/fence. Não há novo formato imposto ao Codex real.
- Sem homologação funcional operacional, browser, MCP/Codex nativo ou ativação dos bancos/flags. Preflight UI histórico continua bloqueado.

## 30. Pendências de ativação

Autorização operacional separada deverá conferir/aplicar209 sobre160/207/208 por banco, revisar limites/ACL/retention/backups, fornecer flag e lista de projetos e aprovar a política de privacidade. Default ausente/0 permanece desligado e não exige209 no caminho legado.

Flags: ORBIT_DISCOVERY_JOURNAL_ENABLED, ORBIT_DISCOVERY_JOURNAL_TEXT_POLICY, ORBIT_DISCOVERY_JOURNAL_PROJECTS e ORBIT_DISCOVERY_JOURNAL_REVIEWED_ENVELOPES. A última usa projectUUID:hash canônico do envelope, sem wildcard; não armazenar esses grants em prompts do agente como prova autoatribuída. Remover grant impede nova ingestão/exibição de texto, preservando metadata histórica autorizada.

Cada produto/banco permanece isolado. Ativar Journal não ativa IA, Compiler/Bridge, MCP, UDS ou modelos. Testar por runtime com usuário/projeto próprios, captura ausente/rejeitada/pending, ownership/cancel/Q&A e consulta paginada antes de declarar homologação.

## 31. Preparação da próxima etapa

Interfaces disponíveis: registros imutáveis com autoria/proveniência/hashes e estado proposed, referência a manifesto/turno/revisão, consulta por recurso e política de ingestão. Futura revisão editorial precisará distinguir decisão de privacidade, avaliação semântica, retirada, validade, eventos e permissão de promoção.

Knowledge Reconciliation/promoção devem criar versões/contratos próprios, sem modificar propostas originais. Possíveis futuras ferramentas MCP exigirão grants de leitura/submissão separados e homologação nativa. Integração automática, memória compartilhada confiável, Integration Gate e Desired State Reconciler não foram implementados. Não iniciar07D automaticamente.

## 32. Handoff técnico

Arquivos centrais: packages/orbit-core/src/execution/discovery-journal.ts, discovery-journal-host.ts, discovery-journal-repository.ts;209 no diretório sql/migrations. DiscoveryJournal.capture recebe autoridade interna e artefato observado; captureExecutionDiscoveries fornece reautorização/lease/root/manager; discoveryDetail expõe leitura restrita. Projeções nos quatro apps são geradas pelos mappings, não editadas individualmente.

Caminhos de captura: genérico Output.type/value; prompt JSON inteiro. Não abrir arquivo indicado por agente, não usar retorno do Bridge como autorização de escrita e não inserir dentro de callback falível de finalização técnica. Receipt errors são contidos e não apagam outputs.

Exemplo seguro de revisão de ingestão: calcular hashContextValue(validateDiscoveryEnvelope(envelope)) em processo confiável, revisar conteúdo completo e associar o hash ao projeto na configuração do host. Isso não aprova semanticamente a descoberta nem altera proposed. Não executar esse procedimento operacional como consequência automática deste relatório.

Comandos de leitura: `node tools/orbit/cli.mjs preflight --format json` e `node tools/orbit/cli.mjs shared check`. Os comandos de teste seguros e arquivos aparecem em§24/25. Publicação selecionada usa plano/precondições/release e atribui todos os arquivos alterados; não editar hashes manualmente nem sincronizar UI para resolver variantes históricas.

## 33. Resultado final

**CONCLUÍDA em código e testes isolados da07C**, com os limites de ingestão, autoria e disponibilidade histórica descritos neste relatório.

| Dimensão | Estado |
|---|---|
| Código/contratos | DiscoveryJournal schema1 no Core; sete categorias, sem aprovação automática. |
| Captura estruturada | Duas filas; opt-in capturado e revisão de ingestão por envelope/projeto. |
| Persistência |209 aditiva em arquivos, batches/entries append-only e idempotência concorrente. |
| Testes isolados |499PASS,0FAIL/skip/cancel finais; quatro APIs TypeScriptPASS. |
| Consulta |GETautorizado por run/card/project/actor/runtime/workspace, paginação/metadata segura. |
| Evidência |Hash/proveniência histórica e observação limitada; sem prova de verdade ou consumo. |
| Aprovação semântica/memória reutilizável |Não implementada; propostas não alimentam07A/B/Compiler/outroscards. |
| Operação/migrations reais |NOT_RUN, nenhum banco/serviço alterado; configuração/retention/homologação pendentes. |
| Codex/MCPnativo |BLOCKED da06C; guards preservados, nenhuma ferramenta MCP escrita. |
| Distribuição |Core1.12.4/230,920projeções sincronizadas;9variantesUIhistóricas preservadas. |


Não houve avanço para07D.
